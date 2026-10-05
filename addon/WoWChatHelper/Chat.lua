-- WoWChatHelper chat side: watches incoming chat, keeps per-conversation context,
-- sends explain requests (auto channels) or adds a [?] link (manual channels), and
-- answers fixed phrases offline from the built-in glossary (spec 3.5, 4).
--
-- Never sends chat: replies only ever go into the edit box (UI.FillChat).

local _, ns = ...
if type(ns) ~= "table" then ns = WCH end
local C = {}
ns.Chat = C

local CTX_LINES = 4
local MAX_LINES = 400        -- lines remembered for [?] clicks
local WHISPER_FRESH = 120    -- /tr goes to the last whisper partner within 2 minutes

-- channel: wire name (spec 3.1); group: auto-explain toggle, nil = manual channel.
local EVENTS = {
	CHAT_MSG_WHISPER = { channel = "WHISPER", group = "whisper" },
	CHAT_MSG_BN_WHISPER = { channel = "BN", group = "whisper" },
	CHAT_MSG_PARTY = { channel = "PARTY", group = "party" },
	CHAT_MSG_PARTY_LEADER = { channel = "PARTY", group = "party" },
	CHAT_MSG_INSTANCE_CHAT = { channel = "INSTANCE", group = "party" },
	CHAT_MSG_INSTANCE_CHAT_LEADER = { channel = "INSTANCE", group = "party" },
	CHAT_MSG_RAID = { channel = "RAID", group = "raid" },
	CHAT_MSG_RAID_LEADER = { channel = "RAID", group = "raid" },
	CHAT_MSG_RAID_WARNING = { channel = "RAID", group = "raid" },
	CHAT_MSG_GUILD = { channel = "GUILD", group = "guild" },
	CHAT_MSG_OFFICER = { channel = "OFFICER", group = "guild" },
	CHAT_MSG_SAY = { channel = "SAY" },
	CHAT_MSG_YELL = { channel = "YELL" },
	CHAT_MSG_CHANNEL = { channel = "CHANNEL" },
}
-- The player's own whispers: context only.
local OUTGOING = {
	CHAT_MSG_WHISPER_INFORM = "WHISPER",
	CHAT_MSG_BN_WHISPER_INFORM = "BN",
}
C.EVENTS = EVENTS

-- run.lines[key] = { key, event, channel, sender, text, ctx, chanIndex, frames = {list}, frameSet }
local run = { lines = {}, order = {}, history = {}, seq = 0 }
C.run = run

---------------------------------------------------------------------------
-- Helpers
---------------------------------------------------------------------------

local function Ambig(name, ctx)
	if type(Ambiguate) == "function" then
		local ok, r = pcall(Ambiguate, name, ctx)
		if ok and r then return r end
	end
	return name
end

-- Sender as sent on the wire: with realm only if cross-realm.
local function WireSender(sender)
	return Ambig(tostring(sender or ""), "none")
end

local function ShortName(sender)
	return (tostring(Ambig(tostring(sender or ""), "short")):gsub("%-.*$", ""))
end

local function IsSelf(sender)
	local me = UnitName and UnitName("player")
	return me ~= nil and ShortName(sender) == me
end

-- Links become [Name]; color codes, textures and atlases are dropped (spec 3.1 text).
function C.ExpandLinks(text)
	local s = tostring(text or "")
	s = s:gsub("|c%x%x%x%x%x%x%x%x|H[^|]*|h(%[[^%]]*%])|h|r", "%1")
	s = s:gsub("|H[^|]*|h(%[[^%]]*%])|h", "%1")
	s = s:gsub("|H[^|]*|h([^|]*)|h", "%1")
	s = s:gsub("|c%x%x%x%x%x%x%x%x", ""):gsub("|cn[^:|]*:", ""):gsub("|r", "")
	s = s:gsub("|T[^|]*|t", ""):gsub("|A[^|]*|a", "")
	return s
end

local function ConvKey(channel, sender, baseName)
	if channel == "WHISPER" or channel == "BN" then return channel .. ":" .. ShortName(sender):lower() end
	if channel == "CHANNEL" then return "CHANNEL:" .. tostring(baseName or "") end
	return channel
end

-- Up to the last 4 lines of a conversation, "sender: text", oldest first.
function C.CtxFor(key)
	local h = run.history[key]
	if not h then return "" end
	local from = math.max(1, #h - CTX_LINES + 1)
	local out = {}
	for i = from, #h do out[#out + 1] = h[i] end
	return table.concat(out, "\n")
end

local function Push(key, sender, text)
	local h = run.history[key]
	if not h then
		h = {}
		run.history[key] = h
	end
	h[#h + 1] = ShortName(sender) .. ": " .. text
	while #h > CTX_LINES do table.remove(h, 1) end
end

-- One record per chat line, shared by the per-frame filter calls and the event.
local function GetLine(event, msg, sender, ...)
	local info = EVENTS[event]
	local lineID = select(9, ...)
	local key
	if type(lineID) == "number" and lineID > 0 then
		key = tostring(lineID)
	else
		-- No line id (synthetic event): same text+sender at the same moment = same line.
		local sig = tostring(GetTime()) .. "\31" .. tostring(sender) .. "\31" .. tostring(msg)
		run.synth = run.synth or {}
		if run.synthAt ~= GetTime() then run.synth, run.synthAt = {}, GetTime() end
		key = run.synth[sig]
		if not key then
			run.seq = run.seq + 1
			key = "s" .. run.seq
			run.synth[sig] = key
		end
	end
	local line = run.lines[key]
	if line then return line end
	local channel = info.channel
	local baseName = select(7, ...)
	local chanIndex = select(6, ...)
	if channel == "CHANNEL" then
		channel = "CHANNEL:" .. tostring(baseName or "")
	end
	local text = C.ExpandLinks(msg)
	local conv = ConvKey(info.channel, sender, baseName)
	run.seq = run.seq + 1
	line = {
		key = key, n = run.seq, event = event, channel = channel, group = info.group,
		sender = WireSender(sender), text = text, ctx = C.CtxFor(conv), conv = conv,
		chanIndex = tonumber(chanIndex), frames = {}, frameSet = {},
	}
	Push(conv, sender, text)
	run.lines[key] = line
	run.order[#run.order + 1] = key
	while #run.order > MAX_LINES do
		run.lines[table.remove(run.order, 1)] = nil
	end
	return line
end

local function NoteFrame(line, frame)
	if frame and not line.frameSet[frame] then
		line.frameSet[frame] = true
		line.frames[#line.frames + 1] = frame
	end
end

function C.GetLine(key) return run.lines[tostring(key)] end

---------------------------------------------------------------------------
-- Offline short-circuit (spec 3.5)
---------------------------------------------------------------------------

function C.OfflineLookup(text)
	local g = WCH_Glossary
	if type(g) ~= "table" or type(g.phrases) ~= "table" then return nil end
	local k = ns.Normalize(text)
	if k == "" then return nil end
	local hit = g.phrases[k]
	if not hit then
		local k2 = ns.Normalize(text, true)
		if k2 ~= "" then hit = g.phrases[k2] end
	end
	if type(hit) == "table" then return hit end
	return nil
end

---------------------------------------------------------------------------
-- Requests
---------------------------------------------------------------------------

-- Explain a line: offline if it is a known phrase, else an `x` request.
-- how: "auto" | "manual". opts.forceAI skips the offline table (for [回覆] on an
-- offline line, which needs AI reply candidates).
function C.Explain(line, how, opts)
	opts = opts or {}
	if not line then return end
	if not opts.forceAI then
		if line.offline then return end
		local hit = C.OfflineLookup(line.text)
		if hit then
			line.offline = true
			if ns.UI then ns.UI.ShowOffline(line, hit) end
			return
		end
	end
	if line.requested then
		local r = ns.Transport.Get(line.requested)
		if r and not r.failed and r.status ~= "error" then
			if opts.wantPicker then r.meta.wantPicker = true end
			return line.requested
		end
	end
	local id = ns.Transport.Request({
		kind = "x", channel = line.channel, sender = line.sender, model = "", ctx = line.ctx, text = line.text,
	}, { line = line, how = how, wantPicker = opts.wantPicker })
	line.requested = id
	return id
end

-- [?] click on a manual-channel line.
function C.ExplainKey(key, frame)
	local line = run.lines[tostring(key)]
	if not line then
		ns.Print("這一行太舊了，找不到原文。")
		return
	end
	NoteFrame(line, frame)
	return C.Explain(line, "manual")
end

---------------------------------------------------------------------------
-- Message filter: remember which chat frames show each line; on manual channels
-- append a [?] link. Must hand every argument back unchanged otherwise.
---------------------------------------------------------------------------

local function Filter(frame, event, msg, sender, ...)
	if ns.IsSecret(msg) or ns.IsSecret(sender) then return false end
	if not ns.db or type(msg) ~= "string" then return false end
	local info = EVENTS[event]
	if not info then return false end
	local line = GetLine(event, msg, sender, ...)
	NoteFrame(line, frame)
	if not info.group and not IsSelf(sender) then
		local link = " " .. ns.C_LINK .. "|Hwch:x:" .. line.key .. "|h[?]|h|r"
		return false, msg .. link, sender, ...
	end
	return false
end
C.Filter = Filter

local function OnEvent(_, event, msg, sender, ...)
	if not ns.db then return end
	if ns.IsSecret(msg) or ns.IsSecret(sender) then return end
	if type(msg) ~= "string" then return end
	local out = OUTGOING[event]
	if out then
		-- The player's own whisper: context for that conversation. `sender` is the target.
		local me = UnitName and UnitName("player") or "me"
		local h = ConvKey(out, sender)
		Push(h, me, C.ExpandLinks(msg))
		return
	end
	local info = EVENTS[event]
	if not info then return end
	local line = GetLine(event, msg, sender, ...)
	if IsSelf(sender) then return end
	-- The last incoming message of any channel (spec 4: /tr goes to the whisper
	-- partner only if the last incoming message was a whisper).
	run.lastIncoming = { channel = info.channel, sender = line.sender, at = GetTime() }
	if info.group and ns.db.settings.auto[info.group] then
		C.Explain(line, "auto")
	end
end

---------------------------------------------------------------------------
-- Translate target (spec 4): the last whisper partner if the last incoming message
-- was a whisper (or Battle.net whisper) within 2 minutes, else the chat type of the edit box (default SAY).
---------------------------------------------------------------------------

local CHATTYPE_CHANNEL = {
	SAY = "SAY", YELL = "YELL", EMOTE = "SAY", PARTY = "PARTY", PARTY_LEADER = "PARTY",
	RAID = "RAID", RAID_LEADER = "RAID", RAID_WARNING = "RAID", GUILD = "GUILD", OFFICER = "OFFICER",
	INSTANCE_CHAT = "INSTANCE", INSTANCE_CHAT_LEADER = "INSTANCE", WHISPER = "WHISPER", BN_WHISPER = "BN",
}

local function EditBox()
	local get = (ChatFrameUtil and ChatFrameUtil.GetActiveWindow) or ChatEdit_GetActiveWindow
	local eb = get and get()
	if not eb then
		eb = (ChatEdit_GetLastActiveWindow and ChatEdit_GetLastActiveWindow()) or LAST_ACTIVE_CHAT_EDIT_BOX
	end
	return eb
end

-- -> { channel (wire), sender, chanIndex, conv }
function C.TranslateTarget()
	local w = run.lastIncoming
	if w and (w.channel == "WHISPER" or w.channel == "BN") and w.sender ~= "" and GetTime() - w.at <= WHISPER_FRESH then
		-- BN keeps its channel so FillChat opens a Battle.net tell, not /w.
		return { channel = w.channel, sender = w.sender, conv = ConvKey(w.channel, w.sender) }
	end
	local eb = EditBox()
	local ct = eb and eb.GetAttribute and eb:GetAttribute("chatType") or "SAY"
	if ct == "WHISPER" then
		local target = eb:GetAttribute("tellTarget")
		if target and target ~= "" then
			return { channel = "WHISPER", sender = WireSender(target), conv = ConvKey("WHISPER", target) }
		end
		ct = "SAY"
	elseif ct == "CHANNEL" then
		local idx = tonumber(eb:GetAttribute("channelTarget"))
		local name = idx and GetChannelName and select(2, GetChannelName(idx))
		if idx and name then
			local base = tostring(name):match("^(.-) %- ") or tostring(name)
			return { channel = "CHANNEL:" .. base, sender = "", chanIndex = idx, conv = "CHANNEL:" .. base }
		end
		ct = "SAY"
	end
	local ch = CHATTYPE_CHANNEL[ct] or "SAY"
	if ch == "BN" or ch == "WHISPER" then ch = "SAY" end
	return { channel = ch, sender = "", conv = ch }
end

---------------------------------------------------------------------------
-- Start
---------------------------------------------------------------------------

ns.OnLogin(function()
	local f = CreateFrame("Frame")
	for ev in pairs(EVENTS) do
		f:RegisterEvent(ev)
		ns.AddMessageEventFilter(ev, Filter)
	end
	for ev in pairs(OUTGOING) do f:RegisterEvent(ev) end
	f:SetScript("OnEvent", OnEvent)
	C.frame = f
end)
