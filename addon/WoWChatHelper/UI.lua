-- WoWChatHelper UI (spec 4): annotation lines in the chat frames, the [回覆] / [詳細] /
-- [重試] / [?] hyperlinks, the reply picker (fills the chat edit box; never sends),
-- /tr translate, detail output, the glossary panel, the status frame and fonts.

local _, ns = ...
if type(ns) ~= "table" then ns = WCH end
local UI = {}
ns.UI = UI

local FONT = ns.FONT
local P = ns.C_PREFIX
local DIM = ns.C_DIM
local MAX_GLOSSARY_ROWS = 400

local BACKDROP = {
	bgFile = "Interface\\Tooltips\\UI-Tooltip-Background",
	edgeFile = "Interface\\Tooltips\\UI-Tooltip-Border",
	tile = true, tileSize = 16, edgeSize = 16,
	insets = { left = 4, right = 4, top = 4, bottom = 4 },
}

-- offline[k] = chat line explained from the phrase table (links use id "o<k>")
local run = { offline = {}, offSeq = 0, origFonts = {}, origEditFonts = {} }
UI.run = run

local function T() return ns.Transport end
local function Chat() return ns.Chat end

---------------------------------------------------------------------------
-- Helpers
---------------------------------------------------------------------------

-- Text from the AI or the glossary shown in a chat line: "|" would start an escape
-- sequence, "||" renders as one pipe.
local function Esc(s) return (tostring(s or ""):gsub("|", "||"):gsub("[\r\n]+", " ")) end

local function Link(kind, arg, label)
	return ns.C_LINK .. "|Hwch:" .. kind .. ":" .. tostring(arg) .. "|h[" .. label .. "]|h|r"
end
UI.Link = Link

-- Our own FontStrings use the bundled CJK font; fall back to a client font object.
function UI.Font(fs, size, flags)
	local ok = fs:SetFont(FONT, size or 12, flags or "")
	if ok == false then
		if GameFontHighlight then fs:SetFontObject(GameFontHighlight) end
	end
	return fs
end

local function NewText(parent, size, layer)
	local fs = parent:CreateFontString(nil, layer or "OVERLAY")
	UI.Font(fs, size)
	fs:SetJustifyH("LEFT")
	return fs
end

local function NewWindow(name, w, h, title)
	local f = CreateFrame("Frame", name, UIParent, "BackdropTemplate")
	f:SetSize(w, h)
	f:SetFrameStrata("DIALOG")
	f:SetMovable(true)
	f:EnableMouse(true)
	f:SetClampedToScreen(true)
	f:RegisterForDrag("LeftButton")
	f:SetScript("OnDragStart", function(self) self:StartMoving() end)
	f:SetScript("OnDragStop", function(self) self:StopMovingOrSizing() end)
	if f.SetBackdrop then
		f:SetBackdrop(BACKDROP)
		f:SetBackdropColor(0.05, 0.06, 0.09, 0.92)
	end
	f.title = NewText(f, 13)
	f.title:SetPoint("TOPLEFT", f, "TOPLEFT", 12, -10)
	f.title:SetText(title or "")
	f.close = CreateFrame("Button", name .. "Close", f, "UIPanelCloseButton")
	f.close:SetPoint("TOPRIGHT", f, "TOPRIGHT", -2, -2)
	f.close:SetScript("OnClick", function() f:Hide() end)
	f:Hide()
	table.insert(UISpecialFrames, name) -- Esc closes it
	return f
end

-- Chat frames that showed the original line (else the default one).
local function FramesFor(rec)
	local m = rec and rec.meta or {}
	if m.frames and #m.frames > 0 then return m.frames end
	if m.line and m.line.frames and #m.line.frames > 0 then return m.line.frames end
	if m.frame then return { m.frame } end
	return { DEFAULT_CHAT_FRAME }
end
UI.FramesFor = FramesFor

local function Out(frames, text)
	for _, f in ipairs(frames) do
		if f and f.AddMessage then f:AddMessage(text, 0.85, 0.9, 1) end
	end
end

local CHANNEL_LABEL = {
	WHISPER = "密語", BN = "Battle.net 密語", PARTY = "隊伍", RAID = "團隊", GUILD = "公會",
	OFFICER = "幹部", INSTANCE = "副本", SAY = "說", YELL = "大喊",
}
function UI.TargetLabel(t)
	local ch = t and t.channel or "SAY"
	local base = ch:match("^CHANNEL:(.*)$")
	if base then return "頻道 " .. base end
	local l = CHANNEL_LABEL[ch] or ch
	if (ch == "WHISPER" or ch == "BN") and t.sender and t.sender ~= "" then l = l .. " " .. t.sender end
	return l
end

---------------------------------------------------------------------------
-- Glossary data: built-in (WCH_Glossary.terms) + learned (WCH_DB.learned)
---------------------------------------------------------------------------

local builtinIndex
local function Builtin()
	if builtinIndex then return builtinIndex end
	builtinIndex = {}
	local g = WCH_Glossary
	for _, e in ipairs(type(g) == "table" and type(g.terms) == "table" and g.terms or {}) do
		if type(e) == "table" and e.term then builtinIndex[tostring(e.term):lower()] = e end
	end
	return builtinIndex
end

-- Store AI-explained terms that aren't built in, with their first-seen time.
function UI.Learn(terms)
	if type(terms) ~= "table" or not ns.db then return 0 end
	local idx, learned, n = Builtin(), ns.db.learned, 0
	for _, t in ipairs(terms) do
		if type(t) == "table" and type(t.term) == "string" and ns.Trim(t.term) ~= "" then
			local k = ns.Trim(t.term):lower()
			if not idx[k] and not learned[k] then
				learned[k] = { term = ns.Trim(t.term), expansion = t.expansion and tostring(t.expansion) or "", zh = t.zh and tostring(t.zh) or "", t = time() }
				n = n + 1
			end
		end
	end
	return n
end

-- Entries matching q in term, expansion or Chinese (case-insensitive substring);
-- built-in first in their own order, then learned sorted by term.
function UI.SearchGlossary(q)
	q = ns.Trim(q or ""):lower()
	local out = {}
	local function Match(e)
		if q == "" then return true end
		for _, f in ipairs({ e.term, e.expansion, e.zh }) do
			if f and tostring(f):lower():find(q, 1, true) then return true end
		end
		return false
	end
	local g = WCH_Glossary
	for _, e in ipairs(type(g) == "table" and type(g.terms) == "table" and g.terms or {}) do
		if type(e) == "table" and e.term and Match(e) then
			out[#out + 1] = { term = e.term, expansion = e.expansion or "", zh = e.zh or "", cat = e.cat, source = "內建" }
		end
	end
	local learned = {}
	for _, e in pairs(ns.db and ns.db.learned or {}) do
		if type(e) == "table" and e.term and Match(e) then
			learned[#learned + 1] = { term = e.term, expansion = e.expansion or "", zh = e.zh or "", t = e.t, source = "AI" }
		end
	end
	table.sort(learned, function(a, b) return a.term:lower() < b.term:lower() end)
	for _, e in ipairs(learned) do out[#out + 1] = e end
	return out
end

---------------------------------------------------------------------------
-- Annotations
---------------------------------------------------------------------------

local function TermsLine(terms)
	if type(terms) ~= "table" then return nil end
	local parts = {}
	for _, t in ipairs(terms) do
		if type(t) == "table" and t.term then
			parts[#parts + 1] = Esc(t.term) .. "=" .. Esc(t.zh or t.expansion or "")
		end
	end
	if #parts == 0 then return nil end
	return "   " .. table.concat(parts, " · ")
end

local function PrintExplain(frames, tag, zh, terms, linkId)
	Out(frames, P .. tag .. "|r " .. Esc(zh) .. "  " .. Link("r", linkId, "回覆") .. " " .. Link("d", linkId, "詳細"))
	local tl = TermsLine(terms)
	if tl then Out(frames, DIM .. tl .. "|r") end
end

-- Offline short-circuit result (phrase table): same layout, tagged [譯·離線].
function UI.ShowOffline(line, hit)
	run.offSeq = run.offSeq + 1
	run.offline[run.offSeq] = line
	local frames = (line.frames and #line.frames > 0) and line.frames or { DEFAULT_CHAT_FRAME }
	PrintExplain(frames, "[譯·離線]", hit.zh or "", hit.terms, "o" .. run.offSeq)
end

local FAIL_TAG = { x = "[譯]", t = "[翻譯]", d = "[詳細]" }

function UI.OnFailed(rec, err)
	if not rec or rec.hello then return end
	local frames = FramesFor(rec)
	Out(frames, P .. (FAIL_TAG[rec.kind] or "[譯]") .. "|r |cffff7070失敗 (" .. Esc(err or "error") .. ")|r " .. Link("retry", rec.id, "重試"))
	UI.UpdateStatus()
end

function UI.OnResult(rec, r)
	if rec.kind == "x" then
		UI.Learn(r.terms)
		PrintExplain(FramesFor(rec), "[譯]", r.zh or "", r.terms, rec.id)
		if rec.meta.wantPicker then UI.OpenPicker(rec.id) end
	elseif rec.kind == "t" then
		Out(FramesFor(rec), P .. "[翻譯]|r " .. Esc(rec.text) .. " → " .. UI.TargetLabel(rec.meta.target) .. "  " .. Link("r", rec.id, "回覆"))
		UI.OpenPicker(rec.id)
	elseif rec.kind == "d" then
		local frames = FramesFor(rec)
		local any = false
		for l in tostring(r.detail or ""):gmatch("[^\r\n]+") do
			if ns.Trim(l) ~= "" then
				Out(frames, P .. "[詳細]|r " .. Esc(l))
				any = true
			end
		end
		if not any then Out(frames, P .. "[詳細]|r " .. DIM .. "（沒有內容）|r") end
	end
	UI.UpdateStatus()
end

---------------------------------------------------------------------------
-- Filling the chat box (never sending)
---------------------------------------------------------------------------

local SLASH = {
	PARTY = "/p ", RAID = "/ra ", GUILD = "/g ", OFFICER = "/o ", INSTANCE = "/i ", SAY = "/s ", YELL = "/y ",
}

-- target = { channel (wire name), sender, chanIndex, frame }
function UI.FillChat(text, target)
	target = target or {}
	local ch = target.channel or "SAY"
	local prefix = ""
	if ch == "WHISPER" and target.sender and target.sender ~= "" then
		prefix = "/w " .. target.sender .. " "
	elseif ch == "BN" then
		local tell = (ChatFrameUtil and ChatFrameUtil.SendBNetTell) or ChatFrame_SendBNetTell
		if tell and target.sender and target.sender ~= "" then
			tell(target.sender)
			local get = (ChatFrameUtil and ChatFrameUtil.GetActiveWindow) or ChatEdit_GetActiveWindow
			local eb = get and get()
			if eb then eb:Insert(text) return eb end
		end
	elseif ch:find("^CHANNEL:") then
		local idx = target.chanIndex
		if not idx and GetChannelName then idx = tonumber((GetChannelName(ch:sub(9)))) end
		if idx and idx > 0 then prefix = "/" .. idx .. " " end
	else
		prefix = SLASH[ch] or ""
	end
	return ns.OpenChat(prefix .. text, target.frame)
end

---------------------------------------------------------------------------
-- Reply picker
---------------------------------------------------------------------------

local picker

local function BuildPicker()
	if picker then return picker end
	picker = NewWindow("WCHPicker", 440, 210, "")
	picker:SetPoint("CENTER", UIParent, "CENTER", 0, 140)
	picker.buttons = {}
	for i = 1, 3 do
		local b = CreateFrame("Button", "WCHPickerButton" .. i, picker)
		b:SetSize(416, 52)
		b:SetPoint("TOPLEFT", picker, "TOPLEFT", 12, -30 - (i - 1) * 56)
		local hl = b:CreateTexture(nil, "HIGHLIGHT")
		hl:SetAllPoints(b)
		hl:SetColorTexture(0.3, 0.5, 0.8, 0.25)
		b.en = NewText(b, 15)
		b.en:SetPoint("TOPLEFT", b, "TOPLEFT", 6, -6)
		b.en:SetWidth(404)
		b.gloss = NewText(b, 11)
		b.gloss:SetPoint("TOPLEFT", b, "TOPLEFT", 6, -30)
		b.gloss:SetWidth(404)
		b.gloss:SetTextColor(0.7, 0.7, 0.7)
		b:SetScript("OnClick", function() UI.Pick(i) end)
		picker.buttons[i] = b
	end
	return picker
end

local TONE = { casual = "輕鬆", polite = "禮貌", short = "簡短" }

-- Open the picker for a result (x or t) by request id.
function UI.OpenPicker(id)
	local rec = T().Get(id)
	if not rec then return end
	if not rec.result then
		ns.Print("這個請求還在處理中，請稍候。")
		return
	end
	local replies = {}
	for _, c in ipairs(type(rec.result.replies) == "table" and rec.result.replies or {}) do
		if type(c) == "table" and type(c.en) == "string" and c.en ~= "" then replies[#replies + 1] = c end
		if #replies == 3 then break end
	end
	if #replies == 0 then
		ns.Print("沒有可用的回覆候選句。")
		return
	end
	local target
	if rec.kind == "t" then
		target = rec.meta.target or { channel = rec.channel, sender = rec.sender }
	else
		local line = rec.meta.line
		target = { channel = rec.channel, sender = rec.sender, chanIndex = line and line.chanIndex,
			frame = line and line.frames and line.frames[1] }
	end
	local p = BuildPicker()
	p.cands, p.target, p.id = replies, target, id
	p.title:SetText("選一句回覆 → " .. UI.TargetLabel(target) .. DIM .. "（點選後填入輸入框，按 Enter 才會送出）|r")
	for i, b in ipairs(p.buttons) do
		local c = replies[i]
		if c then
			b.en:SetText(c.en)
			local gloss = tostring(c.zh or "")
			if c.tone and TONE[c.tone] then gloss = gloss .. "  · " .. TONE[c.tone] end
			b.gloss:SetText(gloss)
			b:Show()
		else
			b:Hide()
		end
	end
	p:SetHeight(40 + #replies * 56)
	p:Show()
	return p
end

function UI.Pick(i)
	if not picker or not picker.cands then return end
	local c = picker.cands[i]
	if not c then return end
	picker:Hide()
	return UI.FillChat(c.en, picker.target)
end

---------------------------------------------------------------------------
-- Translate / detail / retry
---------------------------------------------------------------------------

function UI.Translate(text)
	text = ns.Trim(text)
	if text == "" then
		ns.Print("用法：" .. (ns.trRegistered and "/tr" or "/wch tr") .. " <中文>，例如 /wch tr 我五分鐘後到")
		return
	end
	local target = Chat().TranslateTarget()
	local id = T().Request({
		kind = "t", channel = target.channel, sender = target.sender or "", model = "",
		ctx = Chat().CtxFor(target.conv), text = text,
	}, { target = target, frame = DEFAULT_CHAT_FRAME })
	Out({ DEFAULT_CHAT_FRAME }, P .. "[翻譯]|r " .. DIM .. "已送出，目標：" .. UI.TargetLabel(target) .. "（填入後可在輸入框改頻道）|r")
	return id
end

-- [詳細]: a `d` request (Sonnet) about the original message.
function UI.Detail(arg)
	local base, frames
	local k = tostring(arg):match("^o(%d+)$")
	if k then
		local line = run.offline[tonumber(k)]
		if not line then return end
		base = { channel = line.channel, sender = line.sender, ctx = line.ctx, text = line.text, meta = { line = line } }
	else
		base = T().Get(arg)
		if not base then return end
		if base.detailId then
			local d = T().Get(base.detailId)
			if d and not d.failed and d.status ~= "error" then return base.detailId end
		end
	end
	frames = FramesFor(base)
	local id = T().Request({
		kind = "d", channel = base.channel, sender = base.sender, model = "", ctx = base.ctx, text = base.text,
	}, { frames = frames, parent = arg })
	base.detailId = id
	Out(frames, P .. "[詳細]|r " .. DIM .. "詢問中…|r")
	return id
end

function UI.Retry(id)
	local rec = T().Get(id)
	if not rec or not (rec.failed or rec.status == "error") then return end
	local meta = {}
	for k, v in pairs(rec.meta or {}) do meta[k] = v end
	local nid = T().Request({
		kind = rec.kind, channel = rec.channel, sender = rec.sender, model = rec.model, ctx = rec.ctx, text = rec.text,
	}, meta)
	if meta.line then meta.line.requested = nid end
	return nid
end

---------------------------------------------------------------------------
-- Hyperlinks: |Hwch:<kind>:<arg>|h
---------------------------------------------------------------------------

function UI.HandleLink(link, text, button, frame)
	local kind, arg = tostring(link):match("^wch:(%a+):(.+)$")
	if not kind then return false end
	if kind == "r" then
		local k = arg:match("^o(%d+)$")
		if k then
			local line = run.offline[tonumber(k)]
			if line then
				Chat().Explain(line, "manual", { forceAI = true, wantPicker = true })
				Out(FramesFor({ meta = { line = line } }), P .. "[譯]|r " .. DIM .. "正在產生回覆候選…|r")
			end
		else
			UI.OpenPicker(tonumber(arg))
		end
	elseif kind == "d" then
		UI.Detail(arg)
	elseif kind == "x" then
		Chat().ExplainKey(arg, frame)
	elseif kind == "retry" then
		UI.Retry(tonumber(arg))
	end
	return true
end

---------------------------------------------------------------------------
-- Glossary panel
---------------------------------------------------------------------------

local gloss

local function BuildGlossary()
	if gloss then return gloss end
	gloss = NewWindow("WCHGlossary", 520, 420, "術語表")
	gloss:SetPoint("CENTER", UIParent, "CENTER", 0, 0)
	local search = CreateFrame("EditBox", "WCHGlossarySearch", gloss, "InputBoxTemplate")
	search:SetSize(300, 22)
	search:SetPoint("TOPLEFT", gloss, "TOPLEFT", 18, -32)
	search:SetAutoFocus(false)
	UI.Font(search, 13)
	search:SetScript("OnTextChanged", function() UI.RenderGlossary() end)
	search:SetScript("OnEscapePressed", function(self) self:ClearFocus() end)
	gloss.search = search
	gloss.count = NewText(gloss, 11)
	gloss.count:SetPoint("TOPLEFT", gloss, "TOPLEFT", 330, -36)
	local scroll = CreateFrame("ScrollFrame", "WCHGlossaryScroll", gloss, "UIPanelScrollFrameTemplate")
	scroll:SetPoint("TOPLEFT", gloss, "TOPLEFT", 12, -62)
	scroll:SetPoint("BOTTOMRIGHT", gloss, "BOTTOMRIGHT", -30, 12)
	local content = CreateFrame("Frame", "WCHGlossaryContent", scroll)
	content:SetSize(470, 10)
	scroll:SetScrollChild(content)
	gloss.scroll, gloss.content, gloss.rows = scroll, content, {}
	return gloss
end

function UI.RenderGlossary()
	if not gloss then return end
	local list = UI.SearchGlossary(gloss.search:GetText())
	local shown = math.min(#list, MAX_GLOSSARY_ROWS)
	for i = 1, shown do
		local fs = gloss.rows[i]
		if not fs then
			fs = NewText(gloss.content, 12)
			fs:SetPoint("TOPLEFT", gloss.content, "TOPLEFT", 4, -(i - 1) * 18)
			fs:SetWidth(460)
			gloss.rows[i] = fs
		end
		local e = list[i]
		local tag = e.source == "AI" and "|cff7fd17fAI|r" or (DIM .. "內建|r")
		fs:SetText(Esc(e.term) .. " — " .. Esc(e.expansion) .. " — " .. Esc(e.zh) .. "  " .. tag)
		fs:Show()
	end
	for i = shown + 1, #gloss.rows do gloss.rows[i]:Hide() end
	gloss.content:SetHeight(math.max(10, shown * 18))
	local c = #list .. " 筆"
	if #list > shown then c = c .. "（顯示前 " .. shown .. " 筆）" end
	gloss.count:SetText(c)
	gloss.results = list
end

-- The rows currently shown (tests).
function UI.GlossaryRows()
	local out = {}
	if not gloss then return out end
	for _, fs in ipairs(gloss.rows) do
		if fs:IsShown() then out[#out + 1] = fs:GetText() end
	end
	return out
end

function UI.OpenGlossary(q)
	local g = BuildGlossary()
	g:Show()
	g.search:SetText(ns.Trim(q or ""))
	UI.RenderGlossary()
	return g
end

---------------------------------------------------------------------------
-- Status frame
---------------------------------------------------------------------------

local status
local GROUP_LABEL = { whisper = "密語", party = "隊伍/副本", raid = "團隊", guild = "公會/幹部" }

local function NewCheck(parent, label, x, y, onClick)
	local cb = CreateFrame("CheckButton", nil, parent, "UICheckButtonTemplate")
	cb:SetSize(22, 22)
	cb:SetPoint("TOPLEFT", parent, "TOPLEFT", x, y)
	cb.label = NewText(cb, 12)
	cb.label:SetPoint("LEFT", cb, "RIGHT", 2, 0)
	cb.label:SetText(label)
	cb:SetScript("OnClick", function(self) onClick(self:GetChecked() and true or false) end)
	return cb
end

local function BuildStatus()
	if status then return status end
	status = NewWindow("WCHStatus", 280, 250, "WoW Chat Helper")
	status:SetPoint("TOPRIGHT", UIParent, "TOPRIGHT", -40, -200)
	status.light = status:CreateTexture(nil, "ARTWORK")
	status.light:SetSize(12, 12)
	status.light:SetPoint("TOPLEFT", status, "TOPLEFT", 14, -34)
	status.bridge = NewText(status, 12)
	status.bridge:SetPoint("TOPLEFT", status, "TOPLEFT", 32, -33)
	status.bridge:SetWidth(236)
	status.slots = NewText(status, 12)
	status.slots:SetPoint("TOPLEFT", status, "TOPLEFT", 14, -54)
	status.pending = NewText(status, 12)
	status.pending:SetPoint("TOPLEFT", status, "TOPLEFT", 14, -72)
	status.checks = {}
	local head = NewText(status, 12)
	head:SetPoint("TOPLEFT", status, "TOPLEFT", 14, -96)
	head:SetText("自動解釋：")
	for i, g in ipairs(ns.AUTO_GROUPS) do
		status.checks[g] = NewCheck(status, GROUP_LABEL[g], 14 + ((i - 1) % 2) * 130, -112 - math.floor((i - 1) / 2) * 26, function(on)
			ns.db.settings.auto[g] = on
		end)
	end
	status.fontCheck = NewCheck(status, "聊天框使用內建中文字型", 14, -172, function(on) UI.SetChatFont(on) end)
	status.hint = NewText(status, 11)
	status.hint:SetPoint("TOPLEFT", status, "TOPLEFT", 14, -204)
	status.hint:SetWidth(252)
	status.hint:SetText(DIM .. "/wch g 術語表　/tr 中文翻英文　/wch help|r")
	status:SetScript("OnShow", function() UI.UpdateStatus() end)
	return status
end

function UI.UpdateStatus()
	if not status or not status:IsShown() or not ns.db then return end
	local Tr = T()
	local _, r, g, b, tip = Tr.BridgeState()
	status.light:SetColorTexture(r, g, b, 1)
	local sig = Tr.SignalsWork() and "" or (DIM .. "（訊號不可用，定時檢查）|r")
	status.bridge:SetText(tip .. sig)
	status.slots:SetText("剩餘 slot：" .. Tr.SlotsLeft() .. " / " .. Tr.SLOT_COUNT)
	status.pending:SetText("等待結果：" .. Tr.PendingCount())
	for gname, cb in pairs(status.checks) do cb:SetChecked(ns.db.settings.auto[gname] and true or false) end
	status.fontCheck:SetChecked(ns.db.chatFont and true or false)
end

function UI.ToggleStatus(show)
	local s = BuildStatus()
	if show == nil then show = not s:IsShown() end
	if show then s:Show() UI.UpdateStatus() else s:Hide() end
	return s
end

---------------------------------------------------------------------------
-- Chat-frame font (WCH_DB.chatFont): the bundled CJK font at each frame's size
---------------------------------------------------------------------------

local function SwapFont(obj, store, key, on)
	if not obj or not obj.GetFont or not obj.SetFont then return end
	local path, size, flags = obj:GetFont()
	if on then
		if path ~= FONT then store[key] = path end
		local ok = obj:SetFont(FONT, size or 14, flags or "")
		if ok == false then
			if store[key] then obj:SetFont(store[key], size or 14, flags or "") end
			run.fontMissing = true
		end
	elseif store[key] and path == FONT then
		obj:SetFont(store[key], size or 14, flags or "")
	end
end

function UI.ApplyChatFont(on)
	run.fontMissing = nil
	for i = 1, (NUM_CHAT_WINDOWS or 10) do
		SwapFont(_G["ChatFrame" .. i], run.origFonts, i, on)
		SwapFont(_G["ChatFrame" .. i .. "EditBox"], run.origEditFonts, i, on)
	end
	if run.fontMissing and not run.fontWarned then
		run.fontWarned = true
		ns.Print("找不到內建字型 Fonts\\WCH-CJK.ttf，中文可能顯示成方塊。")
	end
end

function UI.SetChatFont(on)
	ns.db.chatFont = on and true or false
	UI.ApplyChatFont(ns.db.chatFont)
	UI.UpdateStatus()
end

---------------------------------------------------------------------------
-- Start
---------------------------------------------------------------------------

ns.OnLogin(function()
	builtinIndex = nil
	if type(hooksecurefunc) == "function" then
		hooksecurefunc("SetItemRef", function(link, text, button, chatFrame)
			if type(link) == "string" and link:sub(1, 4) == "wch:" then
				UI.HandleLink(link, text, button, chatFrame)
				-- Unknown link types may pop an empty item tooltip; ours never need it.
				if ItemRefTooltip and ItemRefTooltip.Hide then ItemRefTooltip:Hide() end
			end
		end)
		if type(FCF_SetChatWindowFontSize) == "function" then
			-- The chat font size menu resets the font file; put ours back at the new size.
			hooksecurefunc("FCF_SetChatWindowFontSize", function()
				if ns.db and ns.db.chatFont then UI.ApplyChatFont(true) end
			end)
		end
	end
	if ns.db.chatFont then UI.ApplyChatFont(true) end
end)
