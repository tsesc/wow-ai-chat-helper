-- WoWChatHelper core: saved data, settings, shared helpers, slash commands, login order.
--
-- Every file of the addon shares one namespace table (the `...` the client passes);
-- it is also the global WCH so tests and /dump can reach it. The modules hang off it:
--   WCH.Codec (Codec.lua), WCH.Transport, WCH.Chat, WCH.UI. The offline glossary is
--   the global WCH_Glossary (Glossary.lua).
-- Spec: docs/superpowers/specs/2026-10-05-wow-ai-chat-helper-design.md (sections 3, 4).

local ADDON, ns = ...
if type(ns) ~= "table" then ns = {} end
WCH = ns
ns.ADDON = ADDON or "WoWChatHelper"
ns.VERSION = "0.1.0"
ns.ROOT = "Interface\\AddOns\\WoWChatHelper\\"
ns.FONT = ns.ROOT .. "Fonts\\WCH-CJK.ttf"
ns.Codec = ns.Codec or WCH_Codec

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
-- Saved data
---------------------------------------------------------------------------

ns.AUTO_GROUPS = { "whisper", "party", "raid", "guild" }

local function InitDB()
	if type(WCH_DB) ~= "table" then WCH_DB = {} end
	local db = WCH_DB
	ns.db = db
	db.lastId = tonumber(db.lastId) or 0
	-- Identifies this counter's lifetime: if the saved data is reset, the bridge can
	-- tell "request #1 again" from "request #1, already handled" (dedup on session+id).
	if type(db.session) ~= "string" or db.session == "" then
		db.session = string.format("%x%04x%04x", time() % 0xFFFFFF, math.random(0, 0xFFFF), math.random(0, 0xFFFF))
		db.lastId = 0
	end
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
	if db.chatFont == nil then db.chatFont = true end
	if db.stripCorner == nil then db.stripCorner = s.stripCorner end
	if db.stripCorner ~= "TOPLEFT" and db.stripCorner ~= "TOPRIGHT" then db.stripCorner = "TOPLEFT" end
	s.chatFont, s.stripCorner = nil, nil
	db.learned = type(db.learned) == "table" and db.learned or {}
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

local HELP = {
	"/wch — 狀態視窗（橋接燈號、slot、開關）",
	"/wch tr <中文> — 翻成英文候選句（/tr 也可以，除非別的插件用掉了）",
	"/wch g [關鍵字] — 術語表",
	"/wch auto <whisper|party|raid|guild> on|off — 自動解釋的頻道",
	"/wch font on|off — 聊天框使用內建中文字型",
	"/wch corner TOPLEFT|TOPRIGHT — strip 位置（要和 bridge config 的 capture.corner 一樣）",
	"/wch hello — 重新連線橋接程式",
}

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
			ns.Print("用法：/wch auto <whisper|party|raid|guild> on|off")
		else
			ns.db.settings.auto[group] = on
			ns.Print("自動解釋 " .. group .. "：" .. (on and "開" or "關"))
			if UI then UI.UpdateStatus() end
		end
	elseif cmd == "font" then
		local on = OnOff(rest)
		if on == nil then on = not ns.db.chatFont end
		if UI then UI.SetChatFont(on) end
		ns.Print("聊天框中文字型：" .. (on and "開" or "關"))
	elseif cmd == "corner" then
		local c = rest:upper()
		if c == "TOPLEFT" or c == "TOPRIGHT" then
			ns.db.stripCorner = c
			if T then T.PlaceStrip() end
			ns.Print("strip 位置：" .. c .. "（bridge config 的 capture.corner 也要改成 " .. c .. "）")
		else
			ns.Print("strip 位置：" .. tostring(ns.db.stripCorner) .. "；用法：/wch corner TOPLEFT|TOPRIGHT")
		end
	elseif cmd == "hello" or cmd == "connect" then
		if T then T.SayHello(true) end
	elseif cmd == "status" then
		if T then
			local _, _, _, _, tip = T.BridgeState()
			ns.Print(tip .. "；slot 剩 " .. T.SlotsLeft() .. "；等待中 " .. T.PendingCount())
		end
	else
		for _, l in ipairs(HELP) do ns.Print(l) end
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

local function RegisterTr()
	if ns.trRegistered then return end
	if ns.SlashTaken("/tr") then
		ns.trBlocked = true
		return
	end
	SLASH_WCHTR1 = "/tr"
	SlashCmdList.WCHTR = function(msg) if ns.UI then ns.UI.Translate(msg) end end
	ns.trRegistered = true
end
ns.RegisterTr = RegisterTr

---------------------------------------------------------------------------
-- Login order: InitDB on ADDON_LOADED, then each module's Start at PLAYER_LOGIN
-- in file order (Transport, Chat, UI).
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
		RegisterTr()
		for _, fn in ipairs(ns.starters) do fn() end
	end
end)
