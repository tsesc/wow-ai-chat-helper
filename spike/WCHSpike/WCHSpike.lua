-- WCHSpike: throwaway diagnostics addon for wow-ai-chat-helper (spec section 7).
-- Type /wchspike in game. Every check is wrapped in pcall so one missing API cannot
-- break the others. Lua 5.1 / WoW sandbox only (no io, os, require).
local ADDON = ...
local BUNDLED_FONT = "Interface\\AddOns\\WCHSpike\\WCH-CJK.ttf"
local CJK = "\228\184\173\230\150\135\230\184\172\232\169\166 \231\185\129\233\171\148" -- 中文測試 繁體
local SMALL = "\228\184\173\230\150\135" -- 中文

local FONTS = {
	{ "ARHei.ttf",   "Fonts\\ARHei.ttf" },
	{ "ARKai_T.ttf", "Fonts\\ARKai_T.ttf" },
	{ "bHEI00M.ttf", "Fonts\\bHEI00M.ttf" },
	{ "bLEI00D.ttf", "Fonts\\bLEI00D.ttf" },
	{ "blei00d.TTF", "Fonts\\blei00d.TTF" },
	{ "bundled WCH-CJK.ttf", BUNDLED_FONT },
}

-- (name, getter-expression-as-function, how to describe). Each is a global/field path.
local APIS = {
	{ "ChatFrame_AddMessageEventFilter", function() return ChatFrame_AddMessageEventFilter end },
	{ "ChatFrameUtil.AddMessageEventFilter", function() return ChatFrameUtil.AddMessageEventFilter end },
	{ "ChatFrame_OpenChat", function() return ChatFrame_OpenChat end },
	{ "ChatFrameUtil.OpenChat", function() return ChatFrameUtil.OpenChat end },
	{ "SetItemRef", function() return SetItemRef end },
	{ "hooksecurefunc", function() return hooksecurefunc end },
	{ "issecretvalue", function() return issecretvalue end },
	{ "C_AddOns.LoadAddOn", function() return C_AddOns.LoadAddOn end },
	{ "LoadAddOn", function() return LoadAddOn end },
	{ "C_AddOns.GetAddOnMetadata", function() return C_AddOns.GetAddOnMetadata end },
	{ "PlaySoundFile", function() return PlaySoundFile end },
	{ "C_Timer.After", function() return C_Timer.After end },
	{ "GetPhysicalScreenSize", function() return GetPhysicalScreenSize end },
	{ "GetCVar", function() return GetCVar end },
	{ "ChatEdit_GetActiveWindow", function() return ChatEdit_GetActiveWindow end },
	{ "ChatFrameUtil.GetActiveWindow", function() return ChatFrameUtil.GetActiveWindow end },
}

local report = {}
WCHSpike_Report = report -- exposed for tests
local reportBox
local linkClicks = 0
local linkLine -- index of the live link-click line in `report`
local imeLine -- index of the live IME line

local function add(line) report[#report + 1] = line; return #report end

local function refreshBox()
	if reportBox and reportBox.SetText then
		pcall(function() reportBox:SetText(table.concat(report, "\n")) end)
	end
end

-- Run fn; on error record one ERR line and keep going.
local function check(name, fn)
	local ok, err = pcall(fn)
	if not ok then add("ERR   " .. name .. ": " .. tostring(err)) end
	return ok
end

local function present(getter)
	local ok, v = pcall(getter)
	if ok and v ~= nil then return true, type(v) end
	return false, ok and "nil" or "error"
end

local loadErrors = {} -- failures while installing hooks at load time, replayed into every report

local function runChecks()
	for i = #report, 1, -1 do report[i] = nil end
	linkLine, imeLine = nil, nil
	for _, l in ipairs(loadErrors) do add(l) end

	check("header", function()
		local ver, build, _, toc = "?", "?", "?", "?"
		if GetBuildInfo then ver, build, _, toc = GetBuildInfo() end
		add("INFO  wchspike build=" .. tostring(ver) .. " (" .. tostring(build) .. ") toc=" .. tostring(toc))
		local w, h = "?", "?"
		if GetPhysicalScreenSize then w, h = GetPhysicalScreenSize() end
		add("INFO  screen=" .. tostring(w) .. "x" .. tostring(h) .. " uiscale=" .. tostring(UIParent and UIParent.GetEffectiveScale and UIParent:GetEffectiveScale()))
	end)

	-- 7.3 API presence
	for _, a in ipairs(APIS) do
		check("api " .. a[1], function()
			local ok, kind = present(a[2])
			add((ok and "OK    " or "MISS  ") .. "api " .. a[1] .. " (" .. kind .. ")")
		end)
	end

	-- secret-value probe (only if issecretvalue exists)
	check("issecretvalue call", function()
		if issecretvalue then add("INFO  issecretvalue('x')=" .. tostring(issecretvalue("x"))) end
	end)

	-- 7.1 fonts: SetFont return value + measured width. Visual result must be read by eye.
	check("font default", function()
		local f = ChatFrame1 and ChatFrame1.GetFont and { ChatFrame1:GetFont() } or {}
		add("INFO  font default chat frame GetFont=" .. tostring(f[1]) .. " size=" .. tostring(f[2]))
	end)
	local probe
	check("font probe", function()
		probe = UIParent:CreateFontString(nil, "OVERLAY")
	end)
	for _, f in ipairs(FONTS) do
		check("font " .. f[1], function()
			if not probe then add("MISS  font " .. f[1] .. " (no FontString)"); return end
			local ok, ret = pcall(probe.SetFont, probe, f[2], 16, "")
			probe:SetText(CJK)
			local w = probe.GetStringWidth and probe:GetStringWidth() or "?"
			add((ok and ret ~= false and "OK    " or "MISS  ") .. "font " .. f[1] .. " SetFont=" .. tostring(ret) .. " width=" .. tostring(w) .. " (look at the window: glyphs or boxes?)")
		end)
	end

	-- 7.4 hyperlink
	check("hyperlink", function()
		linkLine = add("INFO  link click: not clicked yet (click [wchspike link] in the window or chat)")
	end)
	check("ime", function()
		imeLine = add("INFO  ime editbox: nothing typed yet")
	end)
	refreshBox()
end

-- ---------------------------------------------------------------------------
-- UI
-- ---------------------------------------------------------------------------
local frame

local function onLinkClick(src)
	linkClicks = linkClicks + 1
	local msg = "link click #" .. linkClicks .. " via " .. src
	if linkLine then report[linkLine] = "OK    " .. msg end
	refreshBox()
	if DEFAULT_CHAT_FRAME and DEFAULT_CHAT_FRAME.AddMessage then
		pcall(DEFAULT_CHAT_FRAME.AddMessage, DEFAULT_CHAT_FRAME, "|cff66ccffWCHSpike:|r " .. msg)
	end
end

local function printLink()
	if DEFAULT_CHAT_FRAME and DEFAULT_CHAT_FRAME.AddMessage then
		DEFAULT_CHAT_FRAME:AddMessage("|cff66ccffWCHSpike:|r |Hwchspike:test|h[wchspike link]|h  <- click me")
	end
end

local function buildUI()
	frame = CreateFrame("Frame", "WCHSpikeFrame", UIParent)
	frame:SetSize(700, 640)
	frame:SetPoint("CENTER")
	frame:SetFrameStrata("DIALOG")
	frame:EnableMouse(true)
	frame:SetMovable(true)
	frame:RegisterForDrag("LeftButton")
	frame:SetScript("OnDragStart", frame.StartMoving)
	frame:SetScript("OnDragStop", frame.StopMovingOrSizing)
	local bg = frame:CreateTexture(nil, "BACKGROUND")
	bg:SetAllPoints()
	bg:SetColorTexture(0, 0, 0, 0.85)
	if UISpecialFrames then table.insert(UISpecialFrames, "WCHSpikeFrame") end

	local y = -10
	local function label(text, size, fontPath)
		local fs = frame:CreateFontString(nil, "OVERLAY", "GameFontNormal")
		if fontPath then pcall(fs.SetFont, fs, fontPath, size or 16, "") end
		fs:SetPoint("TOPLEFT", 12, y)
		fs:SetText(text)
		return fs
	end

	label("WCHSpike  (drag to move, Esc to close, /wchspike to rerun)")
	y = y - 24
	label("1. Fonts: does each row show Chinese glyphs, or boxes / question marks?")
	y = y - 20
	-- default font row: GameFontNormal, no override
	local d = frame:CreateFontString(nil, "OVERLAY", "GameFontHighlight")
	d:SetPoint("TOPLEFT", 12, y); d:SetText("default font: " .. CJK)
	y = y - 20
	for _, f in ipairs(FONTS) do
		check("ui font " .. f[1], function()
			local fs = frame:CreateFontString(nil, "OVERLAY", "GameFontHighlight")
			local ok, ret = pcall(fs.SetFont, fs, f[2], 16, "")
			fs:SetPoint("TOPLEFT", 12, y)
			fs:SetText(f[1] .. ": " .. CJK .. (ok and ret ~= false and "" or "   (SetFont failed)"))
		end)
		y = y - 20
	end
	y = y - 6
	label("2. IME: click the box, switch to Windows Chinese IME, type Chinese. Does it show correctly?")
	y = y - 20
	check("ime editbox", function()
		local eb = CreateFrame("EditBox", "WCHSpikeIME", frame)
		eb:SetSize(660, 26)
		eb:SetPoint("TOPLEFT", 12, y)
		eb:SetAutoFocus(false)
		eb:SetMaxLetters(200)
		eb:SetFont(BUNDLED_FONT, 16, "")
		local t = eb:CreateTexture(nil, "BACKGROUND")
		t:SetAllPoints(); t:SetColorTexture(0.15, 0.15, 0.25, 1)
		eb:SetScript("OnEscapePressed", function(self) self:ClearFocus() end)
		eb:SetScript("OnEnterPressed", function(self) self:ClearFocus() end)
		eb:SetScript("OnTextChanged", function(self)
			local txt = self:GetText() or ""
			if imeLine then
				report[imeLine] = "OK    ime editbox: typed " .. #txt .. " bytes, non-ASCII bytes=" .. (select(2, txt:gsub("[\128-\255]", "")))
				refreshBox()
			end
		end)
	end)
	y = y - 34
	label("   (also try the normal chat box: press Enter, type Chinese with the IME)")
	y = y - 24
	label("3. Hyperlink: click the button, or the [wchspike link] line printed in chat")
	y = y - 22
	check("link button", function()
		local b = CreateFrame("Button", "WCHSpikeLinkButton", frame)
		b:SetSize(260, 24)
		b:SetPoint("TOPLEFT", 12, y)
		local bt = b:CreateTexture(nil, "BACKGROUND"); bt:SetAllPoints(); bt:SetColorTexture(0.2, 0.4, 0.2, 1)
		local fs = b:CreateFontString(nil, "OVERLAY", "GameFontHighlight")
		fs:SetPoint("CENTER"); fs:SetText("print test link to chat")
		b:SetScript("OnClick", function() printLink() end)
	end)
	y = y - 34
	label("4. Report (click, Ctrl+A, Ctrl+C, paste back to us):")
	y = y - 20
	check("report box", function()
		reportBox = CreateFrame("EditBox", "WCHSpikeReport", frame)
		reportBox:SetMultiLine(true)
		reportBox:SetSize(676, 250)
		reportBox:SetPoint("TOPLEFT", 12, y)
		reportBox:SetAutoFocus(false)
		reportBox:SetMaxLetters(0)
		reportBox:SetFontObject(ChatFontNormal or GameFontHighlightSmall)
		local t = reportBox:CreateTexture(nil, "BACKGROUND")
		t:SetAllPoints(); t:SetColorTexture(0.1, 0.1, 0.1, 1)
		reportBox:SetScript("OnEscapePressed", function(self) self:ClearFocus() end)
		reportBox:SetScript("OnEditFocusGained", function(self) self:HighlightText() end)
	end)
end

local function show()
	runChecks()
	if not frame then check("buildUI", buildUI) end
	if frame then frame:Show() end
	refreshBox()
	check("print", function()
		-- 7.1: default chat frame font
		DEFAULT_CHAT_FRAME:AddMessage("WCHSpike CJK test (default chat font): " .. CJK)
		printLink()
		for _, l in ipairs(report) do DEFAULT_CHAT_FRAME:AddMessage(l) end
	end)
end

-- Link click detection: SetItemRef hook, with a ChatFrame OnHyperlinkClick fallback.
local function installHooks()
	local function hookCheck(name, fn)
		local ok, err = pcall(fn)
		if not ok then loadErrors[#loadErrors + 1] = "ERR   " .. name .. ": " .. tostring(err) end
	end
	hookCheck("hook SetItemRef", function()
		hooksecurefunc("SetItemRef", function(link)
			if type(link) == "string" and link:find("^wchspike:") then onLinkClick("SetItemRef") end
		end)
	end)
	hookCheck("hook OnHyperlinkClick", function()
		if ChatFrame1 and ChatFrame1.HookScript then
			ChatFrame1:HookScript("OnHyperlinkClick", function(_, link)
				if type(link) == "string" and link:find("^wchspike:") then onLinkClick("OnHyperlinkClick") end
			end)
		end
	end)
end

SLASH_WCHSPIKE1 = "/wchspike"
SlashCmdList["WCHSPIKE"] = function() check("slash", show) end

installHooks()
local ev = CreateFrame("Frame")
ev:RegisterEvent("PLAYER_LOGIN")
ev:SetScript("OnEvent", function()
	check("login", function()
		DEFAULT_CHAT_FRAME:AddMessage("|cff66ccffWCHSpike loaded.|r Type /wchspike. " .. CJK)
	end)
end)
