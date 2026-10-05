-- WoWChatHelper core: saved data, settings, shared helpers, slash commands, login order.
--
-- Every file of the addon shares one namespace table (the `...` the client passes);
-- it is also the global WCH so tests and /dump can reach it. The modules hang off it:
--   WCH.Codec (Codec.lua), WCH.Locales / WCH.L (Locales.lua), WCH.Transport, WCH.Chat,
--   WCH.UI. The offline glossary is the global WCH_Glossary, defined by the
--   load-on-demand addon WoWChatHelper_Glossary_<lang> for the active language.
-- Spec: docs/superpowers/specs/2026-10-05-wow-ai-chat-helper-design.md (sections 3, 4).

local ADDON, ns = ...
if type(ns) ~= "table" then ns = WCH or {} end
WCH = ns
ns.ADDON = ADDON or "WoWChatHelper"
ns.VERSION = "0.1.0"
ns.ROOT = "Interface\\AddOns\\WoWChatHelper\\"
ns.FONT = ns.ROOT .. "Fonts\\WCH-CJK.ttf" -- Traditional Chinese subset (the zhTW font)
ns.Codec = ns.Codec or WCH_Codec
local L, F = ns.L, ns.F

-- Colors used in chat output (gray-blue prefix, light-blue links).
ns.C_PREFIX = "|cff8fa9c8"
ns.C_LINK = "|cff4fc3f7"
ns.C_DIM = "|cff9a9a9a"

---------------------------------------------------------------------------
-- Helpers
---------------------------------------------------------------------------

function ns.Trim(s)
	return (tostring(s or ""):gsub("^%s+", ""):gsub("%s+$", ""))
end

-- Record fields use \30 / \31 as separators: keep them out of field values.
function ns.Wire(s)
	return (tostring(s or ""):gsub("[\30\31]", " "))
end

-- Phrase-table key (spec 3.5 / glossary contract): lowercase, trimmed, collapsed
-- spaces, trailing punctuation stripped. `all` strips every trailing %p character;
-- the default strips only sentence punctuation so keys like "o/" survive.
function ns.Normalize(s, all)
	local t = ns.Trim(tostring(s or ""):lower()):gsub("%s+", " ")
	if all then
		t = t:gsub("%p+$", "")
	else
		t = t:gsub("[%.,!%?~;:]+$", "")
	end
	return ns.Trim(t)
end

-- Cut a UTF-8 string to at most `n` bytes without splitting a character.
function ns.Utf8Truncate(s, n)
	if #s <= n then return s end
	if n <= 0 then return "" end
	local cut = n
	-- Back off while the byte after the cut is a continuation byte (10xxxxxx).
	while cut > 0 do
		local b = s:byte(cut + 1)
		if not b or b < 0x80 or b >= 0xC0 then break end
		cut = cut - 1
	end
	return s:sub(1, cut)
end

function ns.FmtDur(sec)
	sec = math.floor(sec or 0)
	if sec < 60 then return sec .. "s" end
	if sec < 3600 then return math.floor(sec / 60) .. "m" .. string.format("%02d", sec % 60) .. "s" end
	return math.floor(sec / 3600) .. "h" .. string.format("%02d", math.floor(sec / 60) % 60) .. "m"
end

-- Status / help output from the addon itself.
function ns.Print(msg)
	local f = DEFAULT_CHAT_FRAME or ChatFrame1
	if f then f:AddMessage(ns.C_PREFIX .. "[ChatHelper]|r " .. tostring(msg)) end
end

-- Call fn if it exists, swallowing errors (optional client APIs).
function ns.Try(fn, ...)
	if type(fn) ~= "function" then return end
	local r = { pcall(fn, ...) }
	if r[1] then return unpack(r, 2) end
end

-- 12.x names first, the old globals as fallback.
function ns.OpenChat(text, frame)
	local fn = (ChatFrameUtil and ChatFrameUtil.OpenChat) or ChatFrame_OpenChat
	if fn then return fn(text, frame) end
end

function ns.AddMessageEventFilter(ev, fn)
	local add = (ChatFrameUtil and ChatFrameUtil.AddMessageEventFilter) or ChatFrame_AddMessageEventFilter
	if add then add(ev, fn) end
end

function ns.IsSecret(v)
	return type(issecretvalue) == "function" and issecretvalue(v) and true or false
end

---------------------------------------------------------------------------
-- Language (the player's own; explanations, glosses and the addon's text use it,
-- English replies never change)
---------------------------------------------------------------------------

local SUPPORTED = {}
for _, c in ipairs(ns.LANGS) do SUPPORTED[c:lower()] = c end
local ALIAS = { esmx = "esES" }

-- "kokr" / "koKR" / "esMX" -> "koKR" / "esES"; nil if not supported.
function ns.ValidLang(code)
	if type(code) ~= "string" then return nil end
	local k = ns.Trim(code):lower():gsub("[_%-]", "")
	return SUPPORTED[k] or ALIAS[k]
end

-- The client's locale as a supported language, or nil (enUS, enGB, ...).
function ns.ClientLang()
	return ns.ValidLang(GetLocale and GetLocale() or "")
end

-- Bundled fonts for the languages whose script a client of another locale may lack.
ns.LANG_FONT = { zhTW = "WCH-CJK.ttf", zhCN = "WCH-SC.ttf", koKR = "WCH-KR.ttf" }
ns.BUNDLED_FONTS = {}
for _, f in pairs(ns.LANG_FONT) do ns.BUNDLED_FONTS[(ns.ROOT .. "Fonts\\" .. f):lower()] = true end

function ns.IsBundledFont(path)
	return type(path) == "string" and ns.BUNDLED_FONTS[path:lower()] == true
end

-- The bundled font for the active language; for a Latin/Cyrillic language, the one
-- matching the client's own CJK script (keeps names in chat readable), else TC.
function ns.LangFontFile()
	return ns.LANG_FONT[ns.lang] or ns.LANG_FONT[ns.ClientLang() or ""] or ns.LANG_FONT.zhTW
end
function ns.LangFont() return ns.ROOT .. "Fonts\\" .. ns.LangFontFile() end

-- Does the active language need the bundled font? Only a client of the same locale is
-- known to cover it (a zhTW client is not trusted with Simplified, nor any CJK client
-- with Hangul). Latin and Cyrillic languages use the client's fonts.
function ns.NeedsBundledFont()
	return ns.LANG_FONT[ns.lang] ~= nil and ns.ClientLang() ~= ns.lang
end
ns.FontDefault = ns.NeedsBundledFont

-- WCH_DB.chatFont: true/false = the player's choice, nil = automatic.
function ns.ChatFontOn()
	local db = ns.db
	if db and db.chatFont ~= nil then return db.chatFont and true or false end
	return ns.FontDefault()
end

-- Offline glossary: WoWChatHelper_Glossary_<lang> sets WCH_Glossary when it loads.
-- A load-on-demand addon runs once per UI session, so each language's table is kept
-- here and reused when the player switches back.
ns.glossaries = {}
local glossaryWarned = {}

function ns.GlossaryAddon(lang) return "WoWChatHelper_Glossary_" .. tostring(lang) end

function ns.LoadGlossary(lang)
	lang = lang or ns.lang
	local cached = ns.glossaries[lang]
	if cached then
		WCH_Glossary = cached
		ns.glossaryLang = lang
		return true
	end
	local name = ns.GlossaryAddon(lang)
	WCH_Glossary = nil
	local ok, reason = false, "NO_API"
	if C_AddOns and C_AddOns.LoadAddOn then
		local pok, a, b = pcall(C_AddOns.LoadAddOn, name)
		if pok then ok, reason = a, b else reason = tostring(a) end
	end
	local g = WCH_Glossary
	if ok and type(g) == "table" and (g.locale == nil or g.locale == lang) then
		ns.glossaries[lang] = g
		ns.glossaryLang = lang
		return true
	end
	-- Never keep another language's table under this one.
	WCH_Glossary = nil
	ns.glossaryLang = nil
	if ok then reason = "NO_DATA" end
	if not glossaryWarned[lang] then
		glossaryWarned[lang] = true
		ns.Print("|cffffd040" .. F("GLOSSARY_MISSING", name, tostring(reason or "?")) .. "|r")
	end
	return false
end

-- "zhTW 繁體中文, zhCN 简体中文, ..."
function ns.LangList()
	local parts = {}
	for _, c in ipairs(ns.LANGS) do parts[#parts + 1] = c .. " " .. ns.Locales[c].LANG_NAME end
	return table.concat(parts, ", ")
end

local function LangLabel(code)
	local t = ns.Locales[code]
	return (t and t.LANG_NAME or code) .. " " .. code
end

-- Make `lang` active: its glossary, the UI's texts and fonts, and a fresh hello so
-- the bridge answers in it.
function ns.SetLang(lang)
	ns.lang = lang
	ns.LoadGlossary(lang)
	if ns.UI and ns.UI.OnLangChanged then ns.UI.OnLangChanged() end
	if ns.Transport and ns.started then ns.Transport.SayHello(true) end
end

local function LangCommand(rest)
	local arg = ns.Trim(rest)
	local low = arg:lower()
	local function Current()
		ns.Print(F("LANG_CURRENT", LangLabel(ns.lang)) .. (ns.db.lang and "" or (" " .. L.LANG_AUTO)))
	end
	if arg == "" then
		Current()
		ns.Print(F("LANG_USAGE", ns.LangList()))
		return
	end
	if low == "list" or low == "help" or low == "?" then
		ns.Print(F("LANG_USAGE", ns.LangList()))
		return
	end
	local new
	if low == "auto" or low == "default" or low == "reset" then
		ns.db.lang = nil
		new = ns.ClientLang() or "zhTW"
	else
		new = ns.ValidLang(arg)
		if not new then
			ns.Print(F("LANG_UNKNOWN", arg))
			ns.Print(F("LANG_USAGE", ns.LangList()))
			return
		end
		ns.db.lang = new
	end
	ns.SetLang(new)
	ns.Print(F("LANG_SET", LangLabel(new)))
end
ns.LangCommand = LangCommand

---------------------------------------------------------------------------
-- Saved data
---------------------------------------------------------------------------

ns.AUTO_GROUPS = { "whisper", "party", "raid", "guild" }

local function InitDB()
	if type(WCH_DB) ~= "table" then WCH_DB = {} end
	local db = WCH_DB
	ns.db = db
	db.lastId = tonumber(db.lastId) or 0
	-- A new session token on every load (login or /reload). The bridge dedups on
	-- (session, id), and SavedVariables are only written on a clean logout or /reload:
	-- after a crash lastId comes back older than ids the bridge already handled, so a
	-- token that outlived the load would make new messages look like handled ones (and
	-- pick up their old results). Requests never outlive the load (run state isn't
	-- saved), so nothing is lost by starting a new session.
	local up = GetTime and math.floor((GetTime() or 0) * 1000) % 0xFFFF or 0
	db.session = string.format("%x%04x%04x%04x", time() % 0xFFFFFF, math.random(0, 0xFFFF), math.random(0, 0xFFFF), up)
	db.settings = type(db.settings) == "table" and db.settings or {}
	local s = db.settings
	s.auto = type(s.auto) == "table" and s.auto or {}
	for _, g in ipairs(ns.AUTO_GROUPS) do
		if s.auto[g] == nil then s.auto[g] = true end
	end
	if s.signal == nil then s.signal = true end
	-- Spec names these at the top level (WCH_DB.chatFont, WCH_DB.stripCorner); migrate
	-- values an earlier build kept under settings.
	if db.chatFont == nil then db.chatFont = s.chatFont end
	-- chatFont nil = automatic (ns.FontDefault). Builds before the language setting
	-- saved true as the default for everyone, so a true from then is not a choice;
	-- false always was.
	if (tonumber(db.fontPolicy) or 0) < 2 then
		if db.chatFont == true then db.chatFont = nil end
		db.fontPolicy = 2
	end
	if db.stripCorner == nil then db.stripCorner = s.stripCorner end
	if db.stripCorner ~= "TOPLEFT" and db.stripCorner ~= "TOPRIGHT" then db.stripCorner = "TOPLEFT" end
	s.chatFont, s.stripCorner = nil, nil
	db.learned = type(db.learned) == "table" and db.learned or {}
	-- Learned terms from before the language setting were Traditional Chinese.
	for _, e in pairs(db.learned) do
		if type(e) == "table" and e.tr == nil and e.zh ~= nil then
			e.tr = e.zh
			e.locale = e.locale or "zhTW"
		end
	end
	if db.lang ~= nil and not ns.ValidLang(db.lang) then db.lang = nil end
	ns.lang = ns.ValidLang(db.lang) or ns.ClientLang() or "zhTW"
	return db
end
ns.InitDB = InitDB

-- Id for a new request: positive, increasing per session (spec 3.1).
function ns.NextId()
	local db = ns.db or InitDB()
	db.lastId = db.lastId + 1
	return db.lastId
end

-- The hello record's settings text: k=v;k=v.
function ns.HelloSettings()
	local s = ns.db.settings
	local name, realm
	if UnitFullName then name, realm = UnitFullName("player") end
	local kv = {
		{ "addon", ns.VERSION },
		{ "corner", ns.db.stripCorner },
		{ "lang", ns.lang or "zhTW" },
		{ "locale", GetLocale and GetLocale() or "" },
		{ "player", tostring(name or (UnitName and UnitName("player")) or "") .. (realm and realm ~= "" and ("-" .. realm) or "") },
		{ "signals", (ns.Transport and ns.Transport.SignalsWork()) and "ok" or "off" },
	}
	local parts = {}
	for _, p in ipairs(kv) do
		parts[#parts + 1] = p[1] .. "=" .. (tostring(p[2]):gsub("[;=\30\31]", " "))
	end
	return table.concat(parts, ";")
end

---------------------------------------------------------------------------
-- Slash commands
---------------------------------------------------------------------------

local HELP = { "H_STATUS", "H_TR", "H_GLOSSARY", "H_LANG", "H_AUTO", "H_FONT", "H_CORNER", "H_HELLO" }

local function OnOff(v)
	v = (v or ""):lower()
	if v == "on" or v == "1" or v == "true" then return true end
	if v == "off" or v == "0" or v == "false" then return false end
end

function ns.HandleSlash(msg)
	msg = ns.Trim(msg)
	local cmd, rest = msg:match("^(%S+)%s*(.-)$")
	cmd = (cmd or ""):lower()
	local UI, T = ns.UI, ns.Transport
	if cmd == "" then
		if UI then UI.ToggleStatus() end
	elseif cmd == "tr" or cmd == "t" then
		if UI then UI.Translate(rest) end
	elseif cmd == "g" or cmd == "glossary" then
		if UI then UI.OpenGlossary(rest) end
	elseif cmd == "auto" then
		local group, v = rest:match("^(%S+)%s*(%S*)$")
		group = (group or ""):lower()
		local on = OnOff(v)
		if ns.db.settings.auto[group] == nil or on == nil then
			ns.Print(L.AUTO_USAGE)
		else
			ns.db.settings.auto[group] = on
			ns.Print(F("AUTO_SET", group, on and L.ON or L.OFF))
			if UI then UI.UpdateStatus() end
		end
	elseif cmd == "font" then
		if rest:lower() == "auto" then
			if UI then UI.SetChatFont(nil) else ns.db.chatFont = nil end
			ns.Print(F("FONT_AUTO", ns.ChatFontOn() and L.ON or L.OFF))
		else
			local on = OnOff(rest)
			if on == nil then on = not ns.ChatFontOn() end
			if UI then UI.SetChatFont(on) else ns.db.chatFont = on end
			ns.Print(F("FONT_STATE", on and L.ON or L.OFF))
		end
	elseif cmd == "lang" or cmd == "language" then
		LangCommand(rest)
	elseif cmd == "corner" then
		local c = rest:upper()
		if c == "TOPLEFT" or c == "TOPRIGHT" then
			ns.db.stripCorner = c
			if T then T.PlaceStrip() end
			ns.Print(F("CORNER_SET", c, c))
		else
			ns.Print(F("CORNER_USAGE", tostring(ns.db.stripCorner)))
		end
	elseif cmd == "hello" or cmd == "connect" then
		if T then T.SayHello(true) end
	elseif cmd == "status" then
		if T then
			local _, _, _, _, tip = T.BridgeState()
			ns.Print(F("STATUS_LINE", tip, T.SlotsLeft(), T.PendingCount()))
		end
	else
		for _, k in ipairs(HELP) do ns.Print(L[k]) end
	end
end

SLASH_WCH1 = "/wch"
SLASH_WCH2 = "/chathelper"
SlashCmdList = SlashCmdList or {}
SlashCmdList.WCH = ns.HandleSlash

-- Is `/cmd` already registered by another addon? (checked at login, after every
-- non-LoD addon has loaded)
function ns.SlashTaken(cmd)
	cmd = cmd:lower()
	for key in pairs(SlashCmdList) do
		if key ~= "WCHTR" then
			for i = 1, 20 do
				local s = _G["SLASH_" .. key .. i]
				if not s then break end
				if type(s) == "string" and s:lower() == cmd then return key end
			end
		end
	end
	if type(hash_SlashCmdList) == "table" and hash_SlashCmdList[cmd:upper()] and not ns.trRegistered then return "?" end
	return nil
end

-- /wtr is always ours (short, unlikely to clash); /tr only when nothing else has it.
local function RegisterTr()
	if ns.trRegistered or ns.trBlocked then return end
	local trFree = not ns.SlashTaken("/tr")
	SLASH_WCHTR1 = "/wtr"
	if trFree then SLASH_WCHTR2 = "/tr" end
	SlashCmdList.WCHTR = function(msg) if ns.UI then ns.UI.Translate(msg) end end
	if trFree then
		ns.trRegistered = true
	else
		ns.trBlocked = true
		ns.Print(L.TR_TAKEN)
	end
end
ns.RegisterTr = RegisterTr

---------------------------------------------------------------------------
-- Login order: InitDB on ADDON_LOADED, then at PLAYER_LOGIN the language's glossary,
-- then each module's Start in file order (Transport, Chat, UI).
---------------------------------------------------------------------------

ns.starters = {}
function ns.OnLogin(fn) table.insert(ns.starters, fn) end

local ev = CreateFrame("Frame")
ev:RegisterEvent("ADDON_LOADED")
ev:RegisterEvent("PLAYER_LOGIN")
ev:SetScript("OnEvent", function(_, event, arg1)
	if event == "ADDON_LOADED" then
		if arg1 == ns.ADDON then InitDB() end
	elseif event == "PLAYER_LOGIN" then
		if not ns.db then InitDB() end
		if ns.started then return end
		ns.started = true
		ns.LoadGlossary(ns.lang)
		if not ns.db.lang and not ns.ClientLang() and not ns.db.langPrompted then
			-- Client locale isn't one we support (e.g. enUS): ask once.
			ns.db.langPrompted = true
			ns.Print(ns.LANG_PROMPT)
		end
		RegisterTr()
		for _, fn in ipairs(ns.starters) do fn() end
	end
end)
