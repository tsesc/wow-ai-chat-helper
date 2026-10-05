-- Adapted from wow-ai (MIT) by chelinho139: tests/wow_stub.lua
--
-- A stand-in for the WoW: Forever (12.x API) addon environment, enough to load and
-- drive the WoWChatHelper addon in fengari (see tests/helpers/lua.js, which documents
-- the JS side). Frames are plain tables: capitalized method names that aren't defined
-- below resolve to a no-op, so any SetFoo/EnableBar call is accepted; lowercase names
-- are ordinary fields the tests can read.
--
-- STUB collects what the addon did. Fields tests commonly read:
--   STUB.frames        every CreateFrame result, in creation order
--   STUB.chat          every chat-frame AddMessage: { frame = name, text, r, g, b, id, print = bool }
--   STUB.prints        print() output (also echoed to DEFAULT_CHAT_FRAME, as in game)
--   STUB.openChat      ChatFrame_OpenChat / ChatFrameUtil.OpenChat calls: { text, chatType, tellTarget, channelTarget, line }
--   STUB.sent          SendChatMessage calls (the addon must never send: tests assert this stays empty)
--   STUB.sounds        path (normalized) -> true when PlaySoundFile should report playable
--   STUB.soundCalls    every PlaySoundFile call: { path, channel, ok }
--   STUB.loadLog       every C_AddOns.LoadAddOn call: { name, ok, reason }
--   STUB.itemRefs      every SetItemRef call reaching the stub's own handler
--   STUB.texts         every SetText value (any widget)
--   STUB.now           GetTime(); STUB.epoch + floor(now) is time()
--   STUB.locale        what GetLocale() returns (default "enUS")
--   STUB.lodAddons     name -> Lua source of another load-on-demand addon (e.g. the
--                      WoWChatHelper_Glossary_<lang> addons); LoadAddOn runs it once
--
-- Extend freely: later tracks add whatever API their code touches.

STUB = {
	frames = {}, texts = {}, timers = {}, tickers = {}, prints = {}, chat = {}, bindings = {},
	now = 1000, epoch = 1790000000, sounds = {}, soundCalls = {}, loaded = {}, loadLog = {},
	slotFiles = {}, slotSource = nil, slotCount = 200, slotPrefix = "WoWChatHelper_S",
	missingAddons = {}, addonMetadata = {}, namespaces = {}, lodAddons = {}, locale = "enUS",
	openChat = {}, sent = {}, itemRefs = {}, filters = {}, badFonts = {},
	reloaded = false, focus = nil, lineID = 0, timerSeq = 0, soundHandle = 0,
	group = { party = false, raid = false, guild = true },
	player = { name = "Testchar", realm = "Test Realm", class = "HUNTER", level = 60 },
}

local noop = function() end
local osdate = os and os.date

-- ---------------------------------------------------------------------------
-- Lua 5.1 / WoW globals that fengari's Lua 5.3 lacks or names differently
-- ---------------------------------------------------------------------------

unpack = unpack or table.unpack
loadstring = loadstring or function(src, name) return load(src, name) end
math.pow = math.pow or function(a, b) return a ^ b end
table.getn = table.getn or function(t) return #t end
tinsert, tremove = table.insert, table.remove
strlen, strsub, strfind, strmatch, gmatch = string.len, string.sub, string.find, string.match, string.gmatch
strlower, strupper, strrep, strbyte, strchar = string.lower, string.upper, string.rep, string.byte, string.char
gsub, format = string.gsub, string.format
floor, ceil, abs, min, max, mod = math.floor, math.ceil, math.abs, math.min, math.max, math.fmod
function wipe(t) for k in pairs(t) do t[k] = nil end return t end
function tContains(t, v) for _, x in ipairs(t) do if x == v then return true end end return false end
function CopyTable(t)
	local c = {}
	for k, v in pairs(t) do c[k] = type(v) == "table" and CopyTable(v) or v end
	return c
end
function strtrim(s, chars)
	chars = chars or " \t\r\n"
	local set = "[" .. chars:gsub("[%]%^%-%%]", "%%%0") .. "]"
	return (s:gsub("^" .. set .. "+", ""):gsub(set .. "+$", ""))
end
-- strsplit(delimiters, s, pieces): every character of `delimiters` splits.
function strsplit(delim, s, pieces)
	local out, set = {}, "[" .. delim:gsub("[%]%^%-%%]", "%%%0") .. "]"
	local start = 1
	while true do
		if pieces and #out == pieces - 1 then out[#out + 1] = s:sub(start); break end
		local a, b = s:find(set, start)
		if not a then out[#out + 1] = s:sub(start); break end
		out[#out + 1] = s:sub(start, a - 1)
		start = b + 1
	end
	return unpack(out)
end
function strjoin(sep, ...) return table.concat({ ... }, sep) end
function tostringall(...)
	local t = {}
	for i = 1, select("#", ...) do t[i] = tostring((select(i, ...))) end
	return unpack(t, 1, select("#", ...))
end

-- ---------------------------------------------------------------------------
-- Widgets
-- ---------------------------------------------------------------------------

local Methods = {}
STUB.Methods = Methods -- add methods here from tests: STUB.Methods.SetFoo = function(self, ...) end
local FrameMT = {
	__index = function(t, k)
		if type(k) == "string" and k:match("^%u") then
			return Methods[k] or noop
		end
	end,
}

local function NewObject(kind, name, parent)
	local o = setmetatable({
		kind = kind, name = name, parent = parent, scripts = {}, hooks = {}, events = {},
		shown = true, textures = {}, fontStrings = {}, children = {}, points = {}, attributes = {},
		alpha = 1, scale = 1,
	}, FrameMT)
	if name then _G[name] = o end
	if parent and type(parent) == "table" and parent.children then table.insert(parent.children, o) end
	return o
end
STUB.NewObject = NewObject

-- Run a script handler and its HookScript hooks.
function STUB.RunScript(obj, name, ...)
	local r
	if obj.scripts[name] then r = obj.scripts[name](obj, ...) end
	for _, fn in ipairs(obj.hooks[name] or {}) do fn(obj, ...) end
	return r
end

function Methods.SetScript(self, name, fn) self.scripts[name] = fn end
function Methods.GetScript(self, name) return self.scripts[name] end
function Methods.HasScript(self, name) return true end
function Methods.HookScript(self, name, fn) self.hooks[name] = self.hooks[name] or {}; table.insert(self.hooks[name], fn) end
function Methods.RegisterEvent(self, ev) self.events[ev] = true end
function Methods.RegisterUnitEvent(self, ev) self.events[ev] = true end
function Methods.UnregisterEvent(self, ev) self.events[ev] = nil end
function Methods.UnregisterAllEvents(self) self.events = {} end
function Methods.IsEventRegistered(self, ev) return self.events[ev] == true end
function Methods.Show(self)
	local was = self.shown
	self.shown = true
	if not was then STUB.RunScript(self, "OnShow") end
end
function Methods.Hide(self)
	local was = self.shown
	self.shown = false
	if was then STUB.RunScript(self, "OnHide") end
end
function Methods.SetShown(self, v) if v then self:Show() else self:Hide() end end
function Methods.IsShown(self) return self.shown end
function Methods.IsVisible(self)
	local o = self
	while o do
		if type(o) ~= "table" or not o.shown then return o == nil end
		o = o.parent
	end
	return true
end
function Methods.SetText(self, t)
	self.text = t
	table.insert(STUB.texts, tostring(t))
	if self.kind == "EditBox" then STUB.RunScript(self, "OnTextChanged", false) end
end
function Methods.GetText(self) return self.text or "" end
function Methods.SetFormattedText(self, fmt, ...) self:SetText(string.format(fmt, ...)) end
function Methods.GetNumLetters(self) return #(self.text or "") end
function Methods.Insert(self, t) self.text = (self.text or "") .. tostring(t) end
function Methods.GetName(self) return self.name end
function Methods.GetParent(self) return self.parent end
function Methods.SetParent(self, p) self.parent = p end
function Methods.GetObjectType(self) return self.kind end
function Methods.IsObjectType(self, k) return self.kind == k end
function Methods.GetWidth(self) return self.width or 400 end
function Methods.GetHeight(self) return self.height or 300 end
function Methods.SetSize(self, w, h) self.width, self.height = w, h end
function Methods.SetWidth(self, w) self.width = w end
function Methods.SetHeight(self, h) self.height = h end
function Methods.GetSize(self) return self:GetWidth(), self:GetHeight() end
function Methods.SetScale(self, s) self.scale = s end
function Methods.GetScale(self) return self.scale or 1 end
function Methods.GetEffectiveScale(self)
	local s, o = 1, self
	while type(o) == "table" do s = s * (o.scale or 1); o = o.parent end
	return s
end
function Methods.SetAlpha(self, a) self.alpha = a end
function Methods.GetAlpha(self) return self.alpha or 1 end
function Methods.GetStringHeight(self) return 14 end
function Methods.GetStringWidth(self) return 7 * #(self.text or "") end
function Methods.GetFontString(self) return self.fontString or self end
function Methods.SetFontString(self, fs) self.fontString = fs end
function Methods.GetPoint(self, i)
	local p = self.points[i or 1]
	if p then return p[1], p[2], p[3], p[4], p[5] end
	return "CENTER", nil, "CENTER", 0, 0
end
function Methods.GetNumPoints(self) return #self.points end
-- SetPoint(point [, relativeTo [, relativePoint]] [, x, y]); x/y are kept on the object.
function Methods.SetPoint(self, point, rel, relPoint, x, y)
	if type(rel) == "number" then x, y, rel, relPoint = rel, relPoint, nil, nil
	elseif type(relPoint) == "number" then x, y, relPoint = relPoint, x, nil end
	self.x, self.y = x or 0, y or 0
	table.insert(self.points, { point, rel, relPoint or point, self.x, self.y })
end
function Methods.ClearAllPoints(self) self.points = {} end
function Methods.SetAllPoints(self, rel) self.points = { { "TOPLEFT", rel }, { "BOTTOMRIGHT", rel } }; self.x, self.y = 0, 0 end
function Methods.GetChildren(self) return unpack(self.children) end
function Methods.GetNumChildren(self) return #self.children end
function Methods.GetRegions(self)
	local r = {}
	for _, t in ipairs(self.textures) do r[#r + 1] = t end
	for _, f in ipairs(self.fontStrings) do r[#r + 1] = f end
	return unpack(r)
end
function Methods.SetAttribute(self, k, v) self.attributes[k] = v end
function Methods.GetAttribute(self, k) return self.attributes[k] end
function Methods.SetID(self, id) self.id = id end
function Methods.GetID(self) return self.id or 0 end
function Methods.GetVerticalScrollRange(self) return 0 end
function Methods.GetVerticalScroll(self) return self.vscroll or 0 end
function Methods.SetVerticalScroll(self, v) self.vscroll = v end
function Methods.SetScrollChild(self, c) self.scrollChild = c; if c then c.parent = self end end
function Methods.GetScrollChild(self) return self.scrollChild end
function Methods.SetFrameStrata(self, s) self.strata = s end
function Methods.GetFrameStrata(self) return self.strata or "MEDIUM" end
function Methods.SetFrameLevel(self, l) self.level = l end
function Methods.GetFrameLevel(self) return self.level or 1 end
function Methods.EnableMouse(self, v) self.mouse = v end
function Methods.IsMouseEnabled(self) return self.mouse or false end
function Methods.SetMovable(self, v) self.movable = v end
function Methods.IsMovable(self) return self.movable or false end
function Methods.CreateTexture(self, name, layer)
	local t = NewObject("Texture", name, self)
	t.layer = layer
	table.insert(self.textures, t)
	return t
end
function Methods.CreateFontString(self, name, layer, template)
	local f = NewObject("FontString", name, self)
	f.layer, f.template = layer, template
	table.insert(self.fontStrings, f)
	return f
end
function Methods.CreateAnimationGroup(self) return NewObject("AnimationGroup", nil, self) end
function Methods.CreateAnimation(self) return NewObject("Animation", nil, self) end
function Methods.IsPlaying(self) return self.playing or false end
function Methods.Play(self) self.playing = true end
function Methods.Stop(self) self.playing = false end
function Methods.SetColorTexture(self, r, g, b, a) self.color = { r, g, b, a or 1 }; self.texture = nil end
function Methods.SetVertexColor(self, r, g, b, a) self.vertexColor = { r, g, b, a or 1 } end
function Methods.GetVertexColor(self) local c = self.vertexColor or { 1, 1, 1, 1 }; return c[1], c[2], c[3], c[4] end
function Methods.SetTexture(self, path) self.texture = path; return true end
function Methods.GetTexture(self) return self.texture end
function Methods.SetTextColor(self, r, g, b, a) self.textColor = { r, g, b, a or 1 } end
function Methods.GetTextColor(self) local c = self.textColor or { 1, 1, 1, 1 }; return c[1], c[2], c[3], c[4] end
function Methods.SetBackdrop(self, t)
	-- The real client would silently draw nothing; make it a test failure instead.
	assert(type(t) == "table", "SetBackdrop called with " .. tostring(t) .. " on " .. tostring(self.name or self.kind))
	self.backdrop = t
end
-- Fonts: SetFont returns false for paths in STUB.badFonts (a missing font file).
function Methods.SetFont(self, path, size, flags)
	if STUB.badFonts[path] then return false end
	self.font = { path, size, flags or "" }
	return true
end
function Methods.GetFont(self)
	local f = self.font or (self.fontObject and self.fontObject.font) or { "Fonts\\FRIZQT__.TTF", 14, "" }
	return f[1], f[2], f[3]
end
function Methods.SetFontObject(self, o) self.fontObject = o; if type(o) == "table" and o.font then self.font = o.font end end
function Methods.GetFontObject(self) return self.fontObject end
function Methods.SetFocus(self) STUB.focus = self; STUB.RunScript(self, "OnEditFocusGained") end
function Methods.ClearFocus(self) if STUB.focus == self then STUB.focus = nil; STUB.RunScript(self, "OnEditFocusLost") end end
function Methods.HasFocus(self) return STUB.focus == self end
function Methods.GetEditBox(self) return self.editBox end
function Methods.SetCursorPosition(self, p) self.cursor = p end
function Methods.GetCursorPosition(self) return self.cursor or #(self.text or "") end
function Methods.HighlightText(self) end
-- Buttons
function Methods.Click(self, button) STUB.RunScript(self, "PreClick", button or "LeftButton", true); STUB.RunScript(self, "OnClick", button or "LeftButton", true); STUB.RunScript(self, "PostClick", button or "LeftButton", true) end
function Methods.Enable(self) self.disabled = false end
function Methods.Disable(self) self.disabled = true end
function Methods.IsEnabled(self) return not self.disabled end
function Methods.SetEnabled(self, v) self.disabled = not v end
function Methods.SetChecked(self, v) self.checked = v and true or false end
function Methods.GetChecked(self) return self.checked or false end
-- Sliders / status bars
function Methods.SetValue(self, v) self.value = v; STUB.RunScript(self, "OnValueChanged", v, false) end
function Methods.GetValue(self) return self.value or 0 end
function Methods.SetMinMaxValues(self, a, b) self.minValue, self.maxValue = a, b end
function Methods.GetMinMaxValues(self) return self.minValue or 0, self.maxValue or 0 end
-- Tooltip scanning: SetHyperlink fills <name>TextLeft<i> / TextRight<i> from
-- STUB.tooltips[link], a list of strings or { left, right } pairs.
STUB.tooltips = {}
function Methods.ClearLines(self) self.lines = {} end
function Methods.NumLines(self) return #(self.lines or {}) end
function Methods.AddLine(self, text) self.lines = self.lines or {}; table.insert(self.lines, text) end
function Methods.SetOwner(self, owner) self.owner = owner end
function Methods.SetHyperlink(self, link)
	self.lines = STUB.tooltips[link] or {}
	for i, l in ipairs(self.lines) do
		local left, right = l, nil
		if type(l) == "table" then left, right = l[1], l[2] end
		local L = NewObject("FontString", self.name .. "TextLeft" .. i, self)
		L.text = left
		local R = NewObject("FontString", self.name .. "TextRight" .. i, self)
		R.text = right
		R.shown = right ~= nil
	end
end

function CreateFrame(kind, name, parent, template)
	local f = NewObject(kind, name, parent)
	f.template = template
	table.insert(STUB.frames, f)
	return f
end

function CreateFont(name)
	local o = NewObject("Font", name)
	return o
end

-- ---------------------------------------------------------------------------
-- Events and timers
-- ---------------------------------------------------------------------------

-- Fire an event on every frame that registered for it.
function STUB.FireEvent(ev, ...)
	for _, f in ipairs(STUB.frames) do
		if f.events[ev] and f.scripts.OnEvent then STUB.RunScript(f, "OnEvent", ev, ...) end
	end
end

local function addTimer(delay, fn, ticker)
	STUB.timerSeq = STUB.timerSeq + 1
	local t = { due = STUB.now + (delay or 0), delay = delay or 0, fn = fn, seq = STUB.timerSeq }
	t.Cancel = function(self) t.cancelled = true end
	t.IsCancelled = function(self) return t.cancelled == true end
	return t
end

C_Timer = {
	After = function(delay, fn) table.insert(STUB.timers, addTimer(delay, fn)) end,
	NewTimer = function(delay, fn)
		local t = addTimer(delay, nil)
		t.fn = function() fn(t) end
		table.insert(STUB.timers, t)
		return t
	end,
	NewTicker = function(interval, fn, iterations)
		local t = addTimer(interval, nil)
		t.interval, t.remaining = interval, iterations
		t.fn = function() fn(t) end
		table.insert(STUB.tickers, t)
		return t
	end,
}

-- wow-ai compatibility: run every pending C_Timer.After/NewTimer callback now,
-- regardless of its delay (does not advance the clock).
function STUB.RunTimers()
	local due = STUB.timers
	STUB.timers = {}
	for _, t in ipairs(due) do if not t.cancelled then t.fn() end end
end
-- wow-ai compatibility: run every live ticker once (does not advance the clock).
function STUB.Tick()
	for _, t in ipairs(STUB.tickers) do if not t.cancelled then t.fn() end end
end

-- Run whatever is due at STUB.now: one-shot timers (in due order, including ones
-- scheduled by callbacks that are already due) and tickers (catching up missed beats).
function STUB.RunDue()
	for _ = 1, 10000 do
		local best, bi
		for i, t in ipairs(STUB.timers) do
			if not t.cancelled and t.due <= STUB.now and (not best or t.due < best.due or (t.due == best.due and t.seq < best.seq)) then best, bi = t, i end
		end
		for _, t in ipairs(STUB.tickers) do
			if not t.cancelled and t.due <= STUB.now and (not best or t.due < best.due or (t.due == best.due and t.seq < best.seq)) then best, bi = t, nil end
		end
		if not best then break end
		if bi then
			table.remove(STUB.timers, bi)
			best.fn()
		else
			best.due = best.due + math.max(best.interval, 0.001)
			if best.remaining then
				best.remaining = best.remaining - 1
				if best.remaining <= 0 then best.cancelled = true end
			end
			best.fn()
		end
	end
	for i = #STUB.timers, 1, -1 do if STUB.timers[i].cancelled then table.remove(STUB.timers, i) end end
	for i = #STUB.tickers, 1, -1 do if STUB.tickers[i].cancelled then table.remove(STUB.tickers, i) end end
end

-- Move the clock forward by `seconds` in steps of `step` (default 0.1 s): each step
-- calls OnUpdate(frame, elapsed) on every visible frame that has one, then RunDue().
function STUB.Advance(seconds, step)
	step = step or 0.1
	local left = seconds
	while left > 1e-9 do
		local dt = math.min(step, left)
		STUB.now = STUB.now + dt
		left = left - dt
		for _, f in ipairs(STUB.frames) do
			if f.scripts.OnUpdate and f:IsVisible() then STUB.RunScript(f, "OnUpdate", dt) end
		end
		STUB.RunDue()
	end
end

function GetTime() return STUB.now end
function time() return STUB.epoch + math.floor(STUB.now) end
function GetServerTime() return time() end
-- date() in UTC so tests don't depend on the machine's time zone.
function date(fmt, t)
	if not osdate then return "12:00" end
	fmt = fmt or "%c"
	if fmt:sub(1, 1) ~= "!" then fmt = "!" .. fmt end
	return osdate(fmt, t or time())
end
function debugprofilestop() return STUB.now * 1000 end

-- ---------------------------------------------------------------------------
-- UI globals
-- ---------------------------------------------------------------------------

UIParent = CreateFrame("Frame", "UIParent")
WorldFrame = CreateFrame("Frame", "WorldFrame")
GameTooltip = CreateFrame("GameTooltip", "GameTooltip", UIParent)
ItemRefTooltip = CreateFrame("GameTooltip", "ItemRefTooltip", UIParent)
UIErrorsFrame = CreateFrame("Frame", "UIErrorsFrame")
GameFontNormal = CreateFont("GameFontNormal"); GameFontNormal.font = { "Fonts\\FRIZQT__.TTF", 12, "" }
GameFontHighlight = CreateFont("GameFontHighlight"); GameFontHighlight.font = { "Fonts\\FRIZQT__.TTF", 12, "" }
GameFontHighlightSmall = CreateFont("GameFontHighlightSmall"); GameFontHighlightSmall.font = { "Fonts\\FRIZQT__.TTF", 10, "" }
GameFontNormalLarge = CreateFont("GameFontNormalLarge"); GameFontNormalLarge.font = { "Fonts\\FRIZQT__.TTF", 16, "" }
ChatFontNormal = CreateFont("ChatFontNormal"); ChatFontNormal.font = { "Fonts\\ARIALN.TTF", 14, "" }
STANDARD_TEXT_FONT, UNIT_NAME_FONT, DAMAGE_TEXT_FONT = "Fonts\\FRIZQT__.TTF", "Fonts\\FRIZQT__.TTF", "Fonts\\FRIZQT__.TTF"
OKAY, CANCEL, YES, NO, ACCEPT, CLOSE = "Okay", "Cancel", "Yes", "No", "Accept", "Close"
StaticPopupDialogs = {}
function StaticPopup_Show(which, a, b, data) STUB.popup = { which = which, a = a, b = b, data = data }; return STUB.popup end
function StaticPopup_Hide(which) if STUB.popup and STUB.popup.which == which then STUB.popup = nil end end
SlashCmdList = {}
UISpecialFrames = {}
function GetLocale() return STUB.locale or "enUS" end
function GetPhysicalScreenSize() return 1920, 1080 end
function GetScreenWidth() return 1365 end
function GetScreenHeight() return 768 end
function InCombatLockdown() return false end
function ReloadUI() STUB.reloaded = true end
function IsShiftKeyDown() return STUB.shift or false end
function IsControlKeyDown() return STUB.ctrl or false end
function IsAltKeyDown() return STUB.alt or false end
function SetBinding(key, cmd) STUB.bindings[key] = cmd end
function SaveBindings() end
function GetCurrentBindingSet() return 1 end
function PlaySound() end
function StopSound() end
C_Texture = { GetAtlasExists = function() return true end }
EventRegistry = {
	callbacks = {},
	RegisterCallback = function(self, ev, fn, owner) self.callbacks[ev] = self.callbacks[ev] or {}; table.insert(self.callbacks[ev], { fn = fn, owner = owner }) end,
	UnregisterCallback = function(self, ev, owner)
		for i = #(self.callbacks[ev] or {}), 1, -1 do if self.callbacks[ev][i].owner == owner then table.remove(self.callbacks[ev], i) end end
	end,
	TriggerEvent = function(self, ev, ...)
		for _, c in ipairs(self.callbacks[ev] or {}) do if c.owner ~= nil then c.fn(c.owner, ...) else c.fn(...) end end
	end,
}

-- Esc: hide every shown frame named in UISpecialFrames (what CloseSpecialWindows does).
function CloseSpecialWindows()
	local any = false
	for _, n in ipairs(UISpecialFrames) do
		local f = _G[n]
		if f and f.shown then f:Hide(); any = true end
	end
	return any
end
function STUB.PressEscape() return CloseSpecialWindows() end

-- hooksecurefunc([table,] name, fn): post-hook; works on globals and table fields.
function hooksecurefunc(a, b, c)
	if type(a) == "table" then
		local orig = a[b] or noop
		a[b] = function(...) local r = { orig(...) }; c(...); return unpack(r) end
	else
		local orig = _G[a] or noop
		_G[a] = function(...) local r = { orig(...) }; b(...); return unpack(r) end
	end
end

-- ---------------------------------------------------------------------------
-- Sounds (signals): PlaySoundFile(path) is playable iff STUB.sounds[normalized path]
-- ---------------------------------------------------------------------------

-- Paths compare like on Windows: case-insensitive, / and \ equivalent.
function STUB.NormPath(p) return (tostring(p):gsub("/", "\\"):lower()) end
function STUB.SetPlayable(path, v) STUB.sounds[STUB.NormPath(path)] = (v ~= false) or nil end
function PlaySoundFile(path, channel)
	local ok = type(path) == "string" and STUB.sounds[STUB.NormPath(path)] == true
	table.insert(STUB.soundCalls, { path = path, channel = channel, ok = ok })
	if ok then STUB.soundHandle = STUB.soundHandle + 1; return true, STUB.soundHandle end
	return false
end

-- ---------------------------------------------------------------------------
-- Addons: slot addons execute STUB.slotFiles[name] or else STUB.slotSource
-- ---------------------------------------------------------------------------

function STUB.AddonNamespace(name)
	STUB.namespaces[name] = STUB.namespaces[name] or {}
	return STUB.namespaces[name]
end

local function slotExists(name)
	local n = name:match("^" .. STUB.slotPrefix .. "(%d%d%d)$")
	return n and tonumber(n) >= 1 and tonumber(n) <= STUB.slotCount
end

C_AddOns = {
	IsAddOnLoaded = function(name) return STUB.loaded[name] or false end,
	IsAddOnLoadOnDemand = function(name) return (slotExists(name) or STUB.lodAddons[name]) and true or false end,
	DoesAddOnExist = function(name) return (slotExists(name) or STUB.lodAddons[name] or STUB.loaded[name] or STUB.addonMetadata[name]) and true or false end,
	GetAddOnMetadata = function(name, field) return (STUB.addonMetadata[name] or {})[field] end,
	LoadAddOn = function(name)
		local ok, reason
		if STUB.loaded[name] then
			ok = true -- already loaded: the file is not read again
		elseif STUB.lodAddons[name] and not STUB.missingAddons[name] then
			STUB.loaded[name] = true
			local fn, err = load(STUB.lodAddons[name], "@" .. name)
			if not fn then error(err) end
			fn(name, STUB.AddonNamespace(name))
			STUB.FireEvent("ADDON_LOADED", name)
			ok = true
		elseif STUB.missingAddons[name] or not slotExists(name) then
			ok, reason = false, "MISSING"
		else
			STUB.loaded[name] = true
			local src = STUB.slotFiles[name] or STUB.slotSource
			if src then
				local fn, err = load(src, "@" .. name .. "\\Inbox.lua")
				if not fn then error(err) end
				fn(name, STUB.AddonNamespace(name))
			end
			if STUB.onLoadAddOn then STUB.onLoadAddOn(name) end
			STUB.FireEvent("ADDON_LOADED", name)
			ok = true
		end
		table.insert(STUB.loadLog, { name = name, ok = ok, reason = reason })
		return ok, reason
	end,
}
LoadAddOn, IsAddOnLoaded, GetAddOnMetadata = C_AddOns.LoadAddOn, C_AddOns.IsAddOnLoaded, C_AddOns.GetAddOnMetadata

-- ---------------------------------------------------------------------------
-- Player, realm, group
-- ---------------------------------------------------------------------------

function GetBuildInfo() return "1.60.1", "69913", "Sep 1 2026", 16001 end
function UnitName(unit) if unit == "player" then return STUB.player.name end end
function UnitFullName(unit) if unit == "player" then return STUB.player.name, (STUB.player.realm:gsub("[%s%-]", "")) end end
function UnitGUID(unit) if unit == "player" then return "Player-1-00000001" end end
function UnitLevel(unit) return STUB.player.level end
function UnitClass(unit) return "Hunter", STUB.player.class end
function UnitRace(unit) return "Night Elf", "NightElf" end
function UnitFactionGroup(unit) return "Alliance", "Alliance" end
function UnitExists(unit) return unit == "player" end
function GetRealmName() return STUB.player.realm end
function GetNormalizedRealmName() return (STUB.player.realm:gsub("[%s%-]", "")) end
-- Ambiguate("Name-Realm", context): drops the realm when it is the player's own.
function Ambiguate(full, context)
	local n, r = tostring(full):match("^([^%-]+)%-(.+)$")
	if n and r == GetNormalizedRealmName() then return n end
	return full
end
function IsInGroup() return STUB.group.party or STUB.group.raid end
function IsInRaid() return STUB.group.raid end
function IsInGuild() return STUB.group.guild end
function GetGuildInfo(unit) if STUB.group.guild then return "Test Guild", "Member", 1 end end
function GetZoneText() return "Duskwood" end
function GetSubZoneText() return "Darkshire" end
function GetChannelName(id) if id == 1 then return 1, "General - Duskwood" end return 0, nil end

-- ---------------------------------------------------------------------------
-- Chat frames, message filters, edit box
-- ---------------------------------------------------------------------------

NUM_CHAT_WINDOWS = 3
ChatTypeInfo = {}
for k, c in pairs({
	SAY = { 1, 1, 1 }, YELL = { 1, 0.25, 0.25 }, WHISPER = { 1, 0.5, 1 }, WHISPER_INFORM = { 1, 0.5, 1 },
	PARTY = { 0.67, 0.67, 1 }, PARTY_LEADER = { 0.46, 0.78, 1 }, RAID = { 1, 0.5, 0 }, RAID_LEADER = { 1, 0.28, 0.04 },
	RAID_WARNING = { 1, 0.28, 0 }, GUILD = { 0.25, 1, 0.25 }, OFFICER = { 0.25, 0.75, 0.25 },
	INSTANCE_CHAT = { 1, 0.5, 0 }, INSTANCE_CHAT_LEADER = { 1, 0.28, 0.04 }, CHANNEL = { 1, 0.75, 0.75 },
	BN_WHISPER = { 0, 1, 0.96 }, SYSTEM = { 1, 1, 0 }, EMOTE = { 1, 0.5, 0.25 },
}) do ChatTypeInfo[k] = { r = c[1], g = c[2], b = c[3], id = k } end

STUB.chatFrames = {}
for i = 1, NUM_CHAT_WINDOWS do
	local f = CreateFrame("ScrollingMessageFrame", "ChatFrame" .. i, UIParent)
	f.messages = {}
	f.font = { "Fonts\\ARIALN.TTF", 14, "" }
	f.shown = (i == 1)
	f.showsAll = (i == 1) -- receives every chat event; others only those in f.messageEvents
	f.messageEvents = {}
	local eb = CreateFrame("EditBox", "ChatFrame" .. i .. "EditBox", UIParent)
	eb.shown = false
	eb.chatFrame = f
	eb.attributes.chatType = "SAY"
	eb.attributes.stickyType = "SAY"
	f.editBox = eb
	STUB.chatFrames[i] = f
end
DEFAULT_CHAT_FRAME = ChatFrame1
SELECTED_CHAT_FRAME = ChatFrame1
LAST_ACTIVE_CHAT_EDIT_BOX = ChatFrame1EditBox
function Methods.AddMessage(self, text, r, g, b, id, ...)
	local e = { frame = self.name, text = tostring(text), r = r, g = g, b = b, id = id, print = STUB.printing or false }
	self.messages = self.messages or {}
	table.insert(self.messages, e)
	table.insert(STUB.chat, e)
end
function Methods.GetNumMessages(self) return #(self.messages or {}) end
function Methods.GetMessageInfo(self, i) local e = (self.messages or {})[i]; if e then return e.text, e.r, e.g, e.b end end
function Methods.Clear(self) self.messages = {} end

function print(...)
	local parts = {}
	for i = 1, select("#", ...) do parts[i] = tostring((select(i, ...))) end
	local s = table.concat(parts, " ")
	table.insert(STUB.prints, s)
	STUB.printing = true
	DEFAULT_CHAT_FRAME:AddMessage(s)
	STUB.printing = false
end

-- Message event filters (both the old global and the ChatFrameUtil names share one table).
local function addFilter(ev, fn)
	STUB.filters[ev] = STUB.filters[ev] or {}
	for _, f in ipairs(STUB.filters[ev]) do if f == fn then return end end
	table.insert(STUB.filters[ev], fn)
end
local function removeFilter(ev, fn)
	for i = #(STUB.filters[ev] or {}), 1, -1 do if STUB.filters[ev][i] == fn then table.remove(STUB.filters[ev], i) end end
end
function ChatFrame_AddMessageEventFilter(ev, fn) addFilter(ev, fn) end
function ChatFrame_RemoveMessageEventFilter(ev, fn) removeFilter(ev, fn) end
function ChatFrame_GetMessageEventFilters(ev) return STUB.filters[ev] end

local CHAT_FORMAT = {
	CHAT_MSG_WHISPER = "[%s] whispers: %s", CHAT_MSG_BN_WHISPER = "[%s] whispers: %s",
	CHAT_MSG_WHISPER_INFORM = "To [%s]: %s", CHAT_MSG_SAY = "[%s] says: %s", CHAT_MSG_YELL = "[%s] yells: %s",
	CHAT_MSG_PARTY = "[Party] [%s]: %s", CHAT_MSG_PARTY_LEADER = "[Party Leader] [%s]: %s",
	CHAT_MSG_RAID = "[Raid] [%s]: %s", CHAT_MSG_RAID_LEADER = "[Raid Leader] [%s]: %s",
	CHAT_MSG_GUILD = "[Guild] [%s]: %s", CHAT_MSG_OFFICER = "[Officer] [%s]: %s",
	CHAT_MSG_INSTANCE_CHAT = "[Instance] [%s]: %s", CHAT_MSG_INSTANCE_CHAT_LEADER = "[Instance Leader] [%s]: %s",
}

-- Simulate an incoming chat message. Each chat frame that shows `ev` runs the message
-- filters (filter(frame, ev, ...) -> discard [, new args...]) and, unless discarded,
-- AddMessage's a formatted line; then the event goes to every frame that registered it
-- (chat frames are created by the UI before any addon, so they see it first).
-- `opts` = { channel = "Trade - City", channelIndex = 2, lineID = n, guid = ..., frames = { ChatFrame2 } }.
-- Returns the lineID used.
function STUB.ReceiveChat(ev, text, sender, opts)
	opts = opts or {}
	if not ev:find("^CHAT_MSG_") then ev = "CHAT_MSG_" .. ev end
	STUB.lineID = STUB.lineID + 1
	local lineID = opts.lineID or STUB.lineID
	local chanName = opts.channel or ""
	local chanIndex = opts.channelIndex or 0
	local baseName = chanName:match("^(.-) %- ") or chanName
	local args = { text, sender or "", opts.language or "", chanIndex > 0 and (chanIndex .. ". " .. chanName) or "", opts.target or "",
		opts.flags or "", opts.zoneChannelID or 0, chanIndex, baseName, opts.languageID or 0, lineID,
		opts.guid or "Player-1-0000BEEF", opts.bnSenderID or 0, false, false, false, false }
	local n = 17
	local frames = opts.frames
	if not frames then
		frames = {}
		for _, f in ipairs(STUB.chatFrames) do
			if f.showsAll or f.messageEvents[ev] then frames[#frames + 1] = f end
		end
	end
	for _, f in ipairs(frames) do
		local a = { unpack(args, 1, n) }
		local discard = false
		for _, fn in ipairs(STUB.filters[ev] or {}) do
			local res = { fn(f, ev, unpack(a, 1, n)) }
			if res[1] then discard = true; break end
			if res[2] ~= nil then for i = 2, n + 1 do if res[i] ~= nil then a[i - 1] = res[i] end end end
		end
		if not discard then
			local typ = ev:gsub("^CHAT_MSG_", "")
			local info = ChatTypeInfo[typ] or ChatTypeInfo.SAY
			local fmt = CHAT_FORMAT[ev]
			local line
			if fmt then line = string.format(fmt, a[2], a[1])
			elseif typ == "CHANNEL" then line = string.format("[%s] [%s]: %s", a[4], a[2], a[1])
			else line = string.format("[%s]: %s", a[2], a[1]) end
			f:AddMessage(line, info.r, info.g, info.b, info.id)
			f.messages[#f.messages].event, f.messages[#f.messages].lineID, f.messages[#f.messages].sender = ev, lineID, a[2]
		end
	end
	STUB.FireEvent(ev, unpack(args, 1, n))
	return lineID
end

-- Edit box and chat activation.
function ChatEdit_GetActiveWindow()
	for _, f in ipairs(STUB.chatFrames) do if f.editBox.shown and STUB.focus == f.editBox then return f.editBox end end
end
function ChatEdit_GetLastActiveWindow() return LAST_ACTIVE_CHAT_EDIT_BOX end
function ChatEdit_ChooseBoxForSend(preferred) return (preferred and preferred.editBox) or ChatEdit_GetActiveWindow() or LAST_ACTIVE_CHAT_EDIT_BOX end
function ChatEdit_ActivateChat(eb) eb:Show(); eb:SetFocus(); LAST_ACTIVE_CHAT_EDIT_BOX = eb end
function ChatEdit_DeactivateChat(eb) eb:ClearFocus(); eb:Hide() end
function ChatEdit_UpdateHeader(eb) eb.headerUpdates = (eb.headerUpdates or 0) + 1 end
function ChatEdit_InsertLink(text)
	local eb = ChatEdit_GetActiveWindow()
	if eb then eb:Insert(text); return true end
	return false
end

-- Slash-prefix parsing like ChatEdit_ParseText: "/w Name hi" -> WHISPER to Name, text "hi".
local CHAT_COMMANDS = {
	s = "SAY", say = "SAY", y = "YELL", yell = "YELL", sh = "YELL", p = "PARTY", party = "PARTY",
	ra = "RAID", raid = "RAID", rw = "RAID_WARNING", g = "GUILD", guild = "GUILD", o = "OFFICER", officer = "OFFICER",
	i = "INSTANCE_CHAT", instance = "INSTANCE_CHAT", e = "EMOTE", em = "EMOTE", me = "EMOTE",
	w = "WHISPER", whisper = "WHISPER", t = "WHISPER", tell = "WHISPER", send = "WHISPER",
}
function ChatEdit_ParseText(eb, send)
	local text = eb.text or ""
	local cmd, rest = text:match("^/(%S+)%s*(.*)$")
	if not cmd then return end
	cmd = cmd:lower()
	local typ = CHAT_COMMANDS[cmd]
	if typ == "WHISPER" then
		local target, msg = rest:match("^(%S+)%s*(.*)$")
		if target then
			eb.attributes.chatType, eb.attributes.tellTarget, eb.text = "WHISPER", target, msg
		end
	elseif typ then
		eb.attributes.chatType, eb.text = typ, rest
	elseif cmd:match("^%d$") then
		eb.attributes.chatType, eb.attributes.channelTarget, eb.text = "CHANNEL", tonumber(cmd), rest
	end
	ChatEdit_UpdateHeader(eb)
end

-- ChatFrame_OpenChat(text, chatFrame, cursor): activates the box, sets the text and parses
-- a leading slash command. Each call is recorded in STUB.openChat with the resulting state.
function ChatFrame_OpenChat(text, chatFrame, desiredCursorPosition)
	local eb = ChatEdit_ChooseBoxForSend(chatFrame)
	ChatEdit_ActivateChat(eb)
	eb.text = text or ""
	ChatEdit_ParseText(eb, false)
	eb.cursor = desiredCursorPosition
	table.insert(STUB.openChat, {
		line = text, text = eb.text, chatType = eb.attributes.chatType, tellTarget = eb.attributes.tellTarget,
		channelTarget = eb.attributes.channelTarget, frame = eb.name,
	})
	return eb
end

function SendChatMessage(msg, chatType, language, target)
	table.insert(STUB.sent, { msg = msg, chatType = chatType, language = language, target = target })
end
C_ChatInfo = {
	SendChatMessage = SendChatMessage,
	GetChannelName = GetChannelName,
	IsChatLineCensored = function() return false end,
}

-- The Forever client uses the modern chat code: ChatFrameUtil holds the same functions.
ChatFrameUtil = {
	AddMessageEventFilter = addFilter,
	RemoveMessageEventFilter = removeFilter,
	GetMessageEventFilters = ChatFrame_GetMessageEventFilters,
	OpenChat = function(...) return ChatFrame_OpenChat(...) end,
	InsertLink = function(text) return ChatEdit_InsertLink(text) end,
	GetActiveWindow = function() return ChatEdit_GetActiveWindow() end,
	ChooseBoxForSend = function(...) return ChatEdit_ChooseBoxForSend(...) end,
	ActivateChat = function(eb) return ChatEdit_ActivateChat(eb) end,
}

-- ---------------------------------------------------------------------------
-- Hyperlinks: SetItemRef is the click entry point; hook it with hooksecurefunc.
-- ---------------------------------------------------------------------------

function SetItemRef(link, text, button, chatFrame)
	table.insert(STUB.itemRefs, { link = link, text = text, button = button })
end
-- Click a hyperlink as the player would ("wch:r:12", or a full "|Hwch:r:12|h[回覆]|h").
function STUB.ClickLink(link, text, button, frame)
	local l, t = tostring(link):match("^|H(.-)|h(.-)|h$")
	if l then link, text = l, text or t end
	frame = frame or DEFAULT_CHAT_FRAME
	if frame.scripts.OnHyperlinkClick then
		STUB.RunScript(frame, "OnHyperlinkClick", link, text or "", button or "LeftButton")
	end
	SetItemRef(link, text or "", button or "LeftButton", frame)
end
-- Every |H...|h[...]|h link inside a chat line: { { link = "wch:r:12", text = "[回覆]" }, ... }
function STUB.Links(line)
	local out = {}
	for l, t in tostring(line):gmatch("|H(.-)|h(.-)|h") do out[#out + 1] = { link = l, text = t } end
	return out
end

-- ---------------------------------------------------------------------------
-- Slash commands
-- ---------------------------------------------------------------------------

-- Run "/cmd args" through SlashCmdList the way the chat box does. Returns true if a
-- registered command matched (SLASH_<KEY><n> globals, case-insensitive).
function STUB.Slash(line)
	local cmd, rest = tostring(line):match("^(/%S+)%s*(.-)%s*$")
	if not cmd then return false end
	cmd = cmd:lower()
	for key, fn in pairs(SlashCmdList) do
		for i = 1, 20 do
			local s = _G["SLASH_" .. key .. i]
			if not s then break end
			if s:lower() == cmd then fn(rest, ChatFrame1EditBox); return true end
		end
	end
	return false
end

-- ---------------------------------------------------------------------------
-- Lua value -> JSON, so the JS harness can read tables back (helpers/lua.js eval)
-- ---------------------------------------------------------------------------

local function jsonString(s)
	return '"' .. s:gsub('[%c"\\]', function(c)
		if c == '"' then return '\\"' elseif c == "\\" then return "\\\\"
		elseif c == "\n" then return "\\n" elseif c == "\r" then return "\\r" elseif c == "\t" then return "\\t" end
		return string.format("\\u%04x", c:byte())
	end) .. '"'
end

local function toJSON(v, seen, depth)
	local t = type(v)
	if t == "nil" then return "null"
	elseif t == "boolean" then return v and "true" or "false"
	elseif t == "number" then
		if v ~= v or v == math.huge or v == -math.huge then return "null" end
		if v == math.floor(v) and math.abs(v) < 2 ^ 53 then return string.format("%d", v) end
		return string.format("%.17g", v)
	elseif t == "string" then return jsonString(v)
	elseif t == "table" then
		if seen[v] or depth > 12 then return '"<cycle>"' end
		seen[v] = true
		local n, count = #v, 0
		for _ in pairs(v) do count = count + 1 end
		local out = {}
		if n > 0 and n == count then
			for i = 1, n do out[i] = toJSON(v[i], seen, depth + 1) end
			seen[v] = nil
			return "[" .. table.concat(out, ",") .. "]"
		end
		local keys = {}
		for k in pairs(v) do keys[#keys + 1] = k end
		table.sort(keys, function(a, b) return tostring(a) < tostring(b) end)
		for _, k in ipairs(keys) do
			local kv = v[k]
			if type(kv) ~= "function" then
				out[#out + 1] = jsonString(tostring(k)) .. ":" .. toJSON(kv, seen, depth + 1)
			end
		end
		seen[v] = nil
		return "{" .. table.concat(out, ",") .. "}"
	else
		return jsonString("<" .. t .. ">")
	end
end
function STUB.ToJSON(v) return toJSON(v, {}, 0) end
