-- Adapted from wow-ai (MIT) by chelinho139: addon/WoWAI/WoWAI.lua
-- (sections "Pixel strip (out)" and "Signals and slots (in)"), slimmed down to what
-- the chat helper needs.
--
-- OUT: pending request records are drawn as a strip of colored squares in a screen
--      corner (spec 3.1) until the bridge acknowledges them (sig/ack/NNN.wav).
-- IN:  the bridge writes every result into a pool of 200 load-on-demand slot addons
--      (WoWChatHelper_S001..S200, spec 3.3); loading a fresh slot reads the file from
--      disk. Each slot is single-use per UI session; /reload frees them all.
-- Signals (spec 3.4): an empty .wav won't play, a valid one will, so PlaySoundFile
--      tells us which files the bridge has filled: ready/NNN, ack/NNN, presence/kkkk.
--
-- Public: Transport.Request(fields, meta) -> id, Transport.Get(id), SayHello(force),
-- SlotsLeft(), PendingCount(), BridgeState(), SignalsWork(), Tick() (tests).

local _, ns = ...
if type(ns) ~= "table" then ns = WCH end
local T = {}
ns.Transport = T

local Codec = ns.Codec or WCH_Codec
local L, F = ns.L, ns.F

local SLOT_COUNT = 200
local SLOT_PREFIX = "WoWChatHelper_S"
local SIG = ns.ROOT .. "sig\\"
local RS, US = "\30", "\31"
local BATCH_BYTES = 3000      -- one frame carries at most this much payload (spec 3.1)
local ACK_WAIT = 30           -- seconds a record stays up waiting for its ack
local MAX_RESHOWS = 3         -- re-shown this many times, then marked failed
local HELLO_WAIT = 20         -- a hello is dropped (never failed) after this long
local MIN_LOAD_INTERVAL = 3   -- never load slots more often than this (spec 3.5)
local BUSY_LOAD_INTERVAL = 8  -- ...and while other requests are still in flight, wait this
                              -- long so their results ride along (each load costs a slot)
local POLL_SCHEDULE = { 4, 8, 14, 22, 34, 50 } -- without signals, after the oldest pending request
local POLL_TAIL = 30          -- ...then every 30 s while anything is pending
local SAFETY_SCHEDULE = { 50 } -- with working signals: one safety poll, then every SAFETY_TAIL
local SAFETY_TAIL = 60
local IDLE_POLL = 600         -- without presence beats: one slot per 10 min for the status light
local WARN_SLOTS = 20
local PRESENCE_MAX = 2000
local TICK_SECONDS = 0.5
local CELL = Codec.CELL or 4
local CELLS_PER_ROW = Codec.CELLS_PER_ROW or 200
local MAX_ROWS = Codec.MAX_ROWS or 48

T.BATCH_BYTES = BATCH_BYTES
T.SLOT_COUNT = SLOT_COUNT

-- run: state of this UI session (never saved). req[id] = request record:
--   { id, kind, channel, sender, model, ctx, text, wire, meta, createdAt,
--     shownAt, tries, acked, ackedAt, failed, final, status, result, readyStale, ackStale }
local run = { req = {}, nextSlot = 1, slotsLeft = SLOT_COUNT, loads = 0 }
T.run = run

local function db() return ns.db end

---------------------------------------------------------------------------
-- Records
---------------------------------------------------------------------------

local function Join(rec)
	local W = ns.Wire
	return table.concat({ W(db().session), tostring(rec.id), rec.kind, W(rec.channel), W(rec.sender),
		W(rec.model), W(rec.ctx), W(rec.text) }, US)
end

-- Build the wire record; if it would not fit one frame, drop the oldest context lines,
-- then truncate the text and append "…" (spec 6).
local function BuildWire(rec)
	local w = Join(rec)
	while #w > BATCH_BYTES and rec.ctx ~= "" do
		local nl = rec.ctx:find("\n", 1, true)
		rec.ctx = nl and rec.ctx:sub(nl + 1) or ""
		w = Join(rec)
	end
	if #w > BATCH_BYTES then
		local room = BATCH_BYTES - (#w - #rec.text) - 3
		rec.text = ns.Utf8Truncate(rec.text, room) .. "…"
		rec.truncated = true
		w = Join(rec)
	end
	return w
end

---------------------------------------------------------------------------
-- Pixel strip (out)
---------------------------------------------------------------------------

local strip
local cellPool = {}

local function EnsureStrip()
	if strip then return strip end
	-- Parented to WorldFrame, not UIParent: Alt+Z (hide UI), cinematics and some
	-- full-screen panels hide UIParent and everything under it.
	strip = CreateFrame("Frame", "WCHStrip", WorldFrame or UIParent)
	strip:SetFrameStrata("TOOLTIP")
	strip:SetFrameLevel(10000)
	-- One UI unit = one physical pixel (see Blizzard's PixelUtil).
	local physH = 1080
	if GetPhysicalScreenSize then
		local _, h = GetPhysicalScreenSize()
		physH = h or physH
	end
	if strip.SetIgnoreParentScale then strip:SetIgnoreParentScale(true) end
	strip:SetScale(768 / physH)
	strip:SetSize(CELLS_PER_ROW * CELL, MAX_ROWS * CELL)
	strip:Hide()
	return strip
end

local function PlaceStrip()
	local s = EnsureStrip()
	local corner = db() and db().stripCorner or "TOPLEFT"
	s:ClearAllPoints()
	s:SetPoint(corner, WorldFrame or UIParent, corner, 0, 0)
end
T.PlaceStrip = PlaceStrip

local function HideStrip()
	if strip then strip:Hide() end
	run.frameIds, run.frameKey = nil, nil
end

local function ShowStrip(id, payload)
	local cells = Codec.Encode(id % 65536, payload)
	local s = EnsureStrip()
	local rows = math.ceil(#cells / CELLS_PER_ROW)
	local total = rows * CELLS_PER_ROW
	for i = 1, total do
		local t = cellPool[i]
		if not t then
			t = s:CreateTexture(nil, "OVERLAY")
			t:SetSize(CELL, CELL)
			local c, r = Codec.CellPos(i - 1)
			t:SetPoint("TOPLEFT", s, "TOPLEFT", c * CELL, -r * CELL)
			cellPool[i] = t
		end
		local cr, cg, cb = Codec.CellColor(cells[i] or 0)
		t:SetColorTexture(cr, cg, cb, 1)
		t:Show()
	end
	for i = total + 1, #cellPool do cellPool[i]:Hide() end
	s:Show()
end

local function Unacked()
	local ids = {}
	for id, r in pairs(run.req) do
		if not r.acked and not r.failed then ids[#ids + 1] = id end
	end
	table.sort(ids)
	return ids
end

-- Draw the oldest unacknowledged records that fit one frame; the rest wait their turn.
local function RefreshStrip()
	local ids = Unacked()
	if #ids == 0 then HideStrip() return end
	local now = GetTime()
	local parts, size, frameIds = {}, 0, {}
	for _, id in ipairs(ids) do
		local r = run.req[id]
		local add = #r.wire + (#parts > 0 and 1 or 0)
		if size + add > BATCH_BYTES then break end
		parts[#parts + 1] = r.wire
		frameIds[#frameIds + 1] = id
		size = size + add
		if not r.shownAt then r.shownAt, r.tries = now, 1 end
	end
	local key = table.concat(frameIds, ",")
	run.frameIds = frameIds
	if key == run.frameKey and strip and strip:IsShown() then return end
	run.frameKey = key
	ShowStrip(frameIds[#frameIds], table.concat(parts, RS))
end
T.RefreshStrip = RefreshStrip

---------------------------------------------------------------------------
-- Signals
---------------------------------------------------------------------------

local signalAvailable = type(PlaySoundFile) == "function"
run.signalStats = { checks = 0, hits = 0 }

local function SoundValid(path)
	if not signalAvailable or not db() or not db().settings.signal then return false end
	local st = run.signalStats
	st.checks = st.checks + 1
	local ok, willPlay, handle = pcall(PlaySoundFile, path, "Master")
	if not ok then
		signalAvailable = false
		st.error = tostring(willPlay)
		return false
	end
	if willPlay and handle and StopSound then pcall(StopSound, handle) end
	if willPlay then st.hits = st.hits + 1 end
	return willPlay and true or false
end

local function SlotNumber(id) return ((id - 1) % SLOT_COUNT) + 1 end
T.SlotNumber = SlotNumber

local function SignalPath(kind, id)
	return string.format("%s%s\\%03d.wav", SIG, kind, SlotNumber(id))
end

local function CheckSignal(kind, id)
	if not run.signalsOk then return false end
	return SoundValid(SignalPath(kind, id))
end

function T.SignalsWork() return run.signalsOk == true end

-- Prove the sound-file trick distinguishes empty from valid files on this client
-- before trusting it. On failure: schedule-only polling (spec 3.5 / 6).
local function SelfTest()
	run.signalsOk = false
	if not signalAvailable then
		run.selftest = "PlaySoundFile missing"
		return
	end
	if not db().settings.signal then
		run.selftest = "turned off"
		return
	end
	local emptyOk = SoundValid(SIG .. "ctl\\empty.wav")
	local validOk = SoundValid(SIG .. "ctl\\valid.wav")
	if emptyOk then
		run.selftest = "an empty file reports as playable"
	elseif not validOk then
		run.selftest = "a valid file reports as unplayable (files not indexed? restart WoW)"
	else
		run.selftest = "passed"
		run.signalsOk = true
	end
end
T.SelfTest = SelfTest

---------------------------------------------------------------------------
-- Presence
---------------------------------------------------------------------------

local function NotedBridge(at)
	at = at or GetTime()
	if not run.bridgeSeen or at > run.bridgeSeen then run.bridgeSeen = at end
end
T.NotedBridge = NotedBridge

local function PresencePath(k) return string.format("%spresence\\%04d.wav", SIG, k) end

-- The bridge keeps the PRESENCE_GAP files after its counter k empty (bridge.js
-- AHEAD_CLEAR); every other file it has written stays valid. Before the counter first
-- wraps the valid files are 1..k; after a wrap they are 1..k and k+51..PRESENCE_MAX, so
-- a plain binary search over 1..PRESENCE_MAX is wrong. Any run of PRESENCE_GAP
-- consecutive numbers holds exactly one multiple of PRESENCE_GAP: probe those, take an
-- empty probe whose previous probe is valid (circularly), and binary-search the head in
-- the PRESENCE_GAP files before it, where valid-then-empty does hold.
local PRESENCE_GAP = 50
local function PresenceAt(i) -- i in 0..PRESENCE_MAX, 0 meaning PRESENCE_MAX
	return SoundValid(PresencePath(i == 0 and PRESENCE_MAX or i))
end

local function FindPresenceHead()
	local n = math.floor(PRESENCE_MAX / PRESENCE_GAP)
	local probe = {}
	for j = 1, n do probe[j] = PresenceAt(j * PRESENCE_GAP) end
	local e
	for j = 1, n do
		if not probe[j] and probe[j == 1 and n or j - 1] then e = j * PRESENCE_GAP break end
	end
	if not e then
		if probe[n] then return PRESENCE_MAX end -- every probe valid: no gap to go by
		e = PRESENCE_GAP -- every probe empty: at most 1..49 (or nothing) is valid
	end
	local lo, hi = e - PRESENCE_GAP, e - 1 -- lo is valid (or 0 = nothing / PRESENCE_MAX)
	while lo < hi do
		local mid = math.ceil((lo + hi) / 2)
		if PresenceAt(mid) then lo = mid else hi = mid - 1 end
	end
	if lo == 0 then return probe[n] and PRESENCE_MAX or 0 end
	return lo
end
T.FindPresenceHead = FindPresenceHead

local function PollPresence()
	if not run.signalsOk then return end
	if not run.presence then run.presence = { last = FindPresenceHead() } end
	local p = run.presence
	for _ = 1, 3 do
		local k = (p.last % PRESENCE_MAX) + 1
		if not SoundValid(PresencePath(k)) then break end
		p.last = k
		NotedBridge()
	end
end

-- "ok" | "stale" | "down" | "unknown", r, g, b, description (as wow-ai's BridgeState).
function T.BridgeState()
	local seen = run.bridgeSeen
	if not seen then return "unknown", 0.6, 0.6, 0.6, L.BRIDGE_UNKNOWN end
	local age = GetTime() - seen
	local okFor, staleFor = 90, 300
	if not run.signalsOk then okFor, staleFor = IDLE_POLL + 120, IDLE_POLL * 2 + 120 end
	if age < okFor then
		return "ok", 0.2, 0.9, 0.3, F("BRIDGE_OK", ns.FmtDur(age))
	elseif age < staleFor then
		return "stale", 0.95, 0.8, 0.2, F("BRIDGE_STALE", ns.FmtDur(age))
	end
	return "down", 0.9, 0.25, 0.25, F("BRIDGE_DOWN", ns.FmtDur(age))
end

---------------------------------------------------------------------------
-- Requests
---------------------------------------------------------------------------

local function IsPending(r)
	return not r.hello and not r.final and not r.failed
end

function T.PendingCount()
	local n = 0
	for _, r in pairs(run.req) do if IsPending(r) then n = n + 1 end end
	return n
end

function T.Get(id) return run.req[tonumber(id)] end

local function Changed()
	if ns.UI and ns.UI.UpdateStatus then ns.UI.UpdateStatus() end
end

-- fields: { kind = "x"|"t"|"d"|"h", channel, sender, model, ctx, text }; meta is kept
-- with the record for the UI (never sent). Returns the new id.
function T.Request(fields, meta)
	-- A lost hello goes first (lower id: the bridge reads it before this request).
	if fields.kind ~= "h" and run.helloLost then T.SayHello(true) end
	local id = ns.NextId()
	local rec = {
		id = id, kind = fields.kind, channel = fields.channel or "", sender = fields.sender or "",
		model = fields.model or "", ctx = fields.ctx or "", text = fields.text or "",
		meta = meta or {}, createdAt = GetTime(), status = "queued", hello = fields.kind == "h",
	}
	rec.meta.lang = rec.meta.lang or ns.lang -- the language the bridge will answer in
	rec.wire = BuildWire(rec)
	run.req[id] = rec
	if run.signalsOk then
		-- The bridge can't have answered a request it hasn't seen: a valid file now
		-- is left over from id-200 (wrap-around) or an earlier session, so don't trust
		-- it for this one. Hellos too: a stale ack would take the hello down before
		-- the bridge read it.
		if not rec.hello and CheckSignal("ready", id) then rec.readyStale = true end
		if CheckSignal("ack", id) then rec.ackStale = true end
	end
	RefreshStrip()
	Changed()
	return id
end

local function MarkAcked(rec)
	if rec.acked then return end
	rec.acked, rec.ackedAt = true, GetTime()
	if rec.status == "queued" then rec.status = "sent" end
end

local function Fail(rec, err)
	rec.failed, rec.status = true, "failed"
	if ns.UI and ns.UI.OnFailed then ns.UI.OnFailed(rec, err) end
end

-- Hello: announces the session and carries the settings (spec 3.1, kind h), among
-- them the player's language. A hello the bridge never read (it expired unacked, e.g.
-- the bridge was not running yet at login or during /wch lang) is sent again before
-- the next request and as soon as the bridge shows up, so the bridge never answers
-- in a language the player left.
function T.SayHello(force)
	if not db() then return end
	local now = GetTime()
	if not force and run.lastHelloAt and now - run.lastHelloAt < 60 then return end
	run.lastHelloAt = now
	run.helloLost = nil
	for id, r in pairs(run.req) do
		if r.hello and not r.acked then run.req[id] = nil end
	end
	return T.Request({ kind = "h", text = ns.HelloSettings() })
end

---------------------------------------------------------------------------
-- Slots (in)
---------------------------------------------------------------------------

local function SlotName(i) return string.format("%s%03d", SLOT_PREFIX, i) end
T.SlotName = SlotName

local function CountFree()
	local n = 0
	for i = run.nextSlot, SLOT_COUNT do
		if not C_AddOns.IsAddOnLoaded(SlotName(i)) then n = n + 1 end
	end
	run.slotsLeft = n
	return n
end

function T.SlotsLeft() return run.slotsLeft end

local function FreeSlot()
	while run.nextSlot <= SLOT_COUNT do
		local name = SlotName(run.nextSlot)
		if not C_AddOns.IsAddOnLoaded(name) then return name end
		run.nextSlot = run.nextSlot + 1
	end
end

local function Exhausted()
	if run.slotsExhausted then return end
	run.slotsExhausted = true
	run.slotsLeft = 0
	ns.Print("|cffff6060" .. L.SLOTS_EXHAUSTED .. "|r")
	Changed()
end

-- Results for this session's pending requests (spec 3.3). Returns the ids resolved.
local function ApplySlotData(data)
	local resolved = {}
	if type(data) ~= "table" then return resolved end
	if type(data.now) == "number" then
		-- The bridge's clock and ours are the same machine; translate to GetTime().
		NotedBridge(GetTime() - (time() - data.now))
	end
	if type(data.session) == "string" and data.session ~= "" and data.session ~= db().session then
		return resolved
	end
	for _, r in ipairs(type(data.results) == "table" and data.results or {}) do
		local rec = type(r) == "table" and run.req[tonumber(r.id) or -1]
		if rec and not rec.hello and not rec.final and (r.kind == nil or r.kind == rec.kind) then
			MarkAcked(rec)
			if r.status == "done" then
				rec.final, rec.status, rec.result = true, "done", r
				resolved[#resolved + 1] = rec.id
				if ns.UI and ns.UI.OnResult then ns.UI.OnResult(rec, r) end
			elseif r.status == "error" then
				rec.final, rec.status = true, "error"
				resolved[#resolved + 1] = rec.id
				if ns.UI and ns.UI.OnFailed then ns.UI.OnFailed(rec, r.err or "error") end
			elseif r.status == "working" then
				rec.status = "working"
			end
			-- Hellos shown before this record (oldest first, same or earlier frame)
			-- were read too; without signals this is their only ack.
			for hid, h in pairs(run.req) do
				if h.hello and not h.acked and hid < rec.id and h.shownAt then MarkAcked(h) end
			end
		end
	end
	return resolved
end
T.ApplySlotData = ApplySlotData

-- Load the next free slot and apply what it holds.
local function TryLoadSlot(why)
	if run.slotsExhausted or run.slotsMissing then return end
	local name = FreeSlot()
	if not name then Exhausted() return end
	run.lastLoadAt = GetTime()
	run.loadWanted = nil
	WCH_SlotData = nil
	local ok, reason = C_AddOns.LoadAddOn(name)
	run.nextSlot = run.nextSlot + 1
	if not ok then
		run.slotError = reason
		if reason == "MISSING" or reason == "DISABLED" or reason == "NOT_INSTALLED" then
			run.slotsMissing = true
			ns.Print("|cffff6060" .. F("SLOT_MISSING", name, tostring(reason)) .. "|r")
		end
		CountFree()
		Changed()
		return
	end
	run.loads = run.loads + 1
	local data = WCH_SlotData
	WCH_SlotData = nil
	local resolved = ApplySlotData(data)
	RefreshStrip() -- results and "working" entries count as acks
	if why == "signal" then
		-- A ready signal whose result isn't in the file is stale (wrap-around):
		-- that request falls back to the poll schedule.
		local done = {}
		for _, id in ipairs(resolved) do done[id] = true end
		for _, id in ipairs(run.signalIds or {}) do
			local r = run.req[id]
			if r and not done[id] and not r.final then r.readyStale = true end
		end
	end
	run.signalIds = nil
	local left = CountFree()
	if left == 0 then
		Exhausted()
	elseif left <= WARN_SLOTS and not run.warnedLow then
		run.warnedLow = true
		ns.Print("|cffffd040" .. F("SLOTS_LOW", left) .. "|r")
	end
	Changed()
end
T.TryLoadSlot = TryLoadSlot

-- When the schedule wants the next slot read for this request.
local function NextPollFor(r)
	local useSafety = run.signalsOk and not r.readyStale
	local sched, tail = POLL_SCHEDULE, POLL_TAIL
	if useSafety then sched, tail = SAFETY_SCHEDULE, SAFETY_TAIL end
	-- With working signals, wait for the ack before counting (the bridge hasn't seen it).
	local base = r.createdAt
	if run.signalsOk and not r.ackStale then
		if not r.acked then return nil end
		base = r.ackedAt or base
	end
	local last = run.lastLoadAt or -1e9
	for _, t in ipairs(sched) do
		if base + t > last then return base + t end
	end
	-- Past the list: every `tail` seconds on this request's grid, but never sooner
	-- than ~`tail` after the last load (whichever request caused it), so a change of
	-- the oldest request can't bunch loads up. 1 s slack absorbs tick jitter.
	local t = sched[#sched]
	local k = math.ceil((last + tail - 1 - base - t) / tail)
	if k < 1 then k = 1 end
	return base + t + k * tail
end

---------------------------------------------------------------------------
-- Tick
---------------------------------------------------------------------------

function T.Tick()
	if not db() then return end
	local now = GetTime()
	PollPresence()

	-- Acks: the bridge acks the highest id of a frame once it has read the frame.
	local changed = false
	local ids = run.frameIds
	if ids and #ids > 0 then
		local top = run.req[ids[#ids]]
		if top and not top.acked and not top.ackStale and CheckSignal("ack", top.id) then
			for _, id in ipairs(ids) do
				local r = run.req[id]
				if r then MarkAcked(r) end
			end
			NotedBridge()
			changed = true
		end
	end
	for id, r in pairs(run.req) do
		if r.hello and r.acked then
			run.req[id] = nil
		elseif not r.acked and not r.failed and r.shownAt then
			if r.hello then
				if now - r.shownAt >= HELLO_WAIT then
					run.req[id] = nil; changed = true
					run.helloLost = now
				end
			elseif now - r.shownAt >= ACK_WAIT then
				if r.tries <= MAX_RESHOWS then
					r.tries = r.tries + 1
					r.shownAt = now
					run.frameKey = nil -- redraw
				else
					Fail(r, L.NO_RESPONSE)
				end
				changed = true
			end
		end
	end
	if changed then RefreshStrip() Changed() end
	-- The bridge is back after a hello expired unread: say hello again.
	-- (Only with signals: without them a hello is never acked on its own, so an expired
	-- one is not proof it went unread; the next request carries a fresh one instead.)
	if run.helloLost and run.signalsOk and run.bridgeSeen and run.bridgeSeen > run.helloLost then T.SayHello(true) end

	if run.slotsExhausted or run.slotsMissing then return end
	local want
	local anyPending = false
	-- One poll schedule for everything pending, anchored to the oldest request that
	-- has one (spec 3.5): one load picks up every result, so per-request schedules
	-- would only interleave and burn slots.
	local oldest
	local inFlight = 0 -- pending requests the bridge has but whose result isn't ready
	for id, r in pairs(run.req) do
		if IsPending(r) then
			anyPending = true
			if run.signalsOk and not r.readyStale and CheckSignal("ready", id) then
				want = "signal"
				run.signalIds = run.signalIds or {}
				table.insert(run.signalIds, id)
			elseif r.acked then
				inFlight = inFlight + 1
			end
			if (not oldest or id < oldest.id) and NextPollFor(r) then oldest = r end
		end
	end
	local nextAt = oldest and NextPollFor(oldest)
	if not want and nextAt and now >= nextAt then want = "schedule" end
	if not want and not anyPending and not run.signalsOk and now - (run.lastIdlePoll or -1e9) >= IDLE_POLL then
		run.lastIdlePoll = now
		want = "idle"
	end
	want = want or run.loadWanted
	if want then
		local gap = MIN_LOAD_INTERVAL
		if want == "signal" and inFlight > 0 then gap = BUSY_LOAD_INTERVAL end
		if now - (run.lastLoadAt or -1e9) >= gap then
			TryLoadSlot(want)
		else
			run.loadWanted = want
		end
	end
end

---------------------------------------------------------------------------
-- Start (PLAYER_LOGIN)
---------------------------------------------------------------------------

ns.OnLogin(function()
	PlaceStrip()
	SelfTest()
	-- Inbox.lua (read at load) is the bridge's last publish: proof of life only.
	if type(WCH_SlotData) == "table" then
		if type(WCH_SlotData.now) == "number" then NotedBridge(GetTime() - (time() - WCH_SlotData.now)) end
		WCH_SlotData = nil
	end
	CountFree()
	-- First idle poll a little after the hello, so the light reflects reality early.
	run.lastIdlePoll = GetTime() - IDLE_POLL + 8
	run.ticker = C_Timer.NewTicker(TICK_SECONDS, T.Tick)
	C_Timer.After(2, function() T.SayHello(true) end)
end)
