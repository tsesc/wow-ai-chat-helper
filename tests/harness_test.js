// The Lua test harness itself (tests/helpers/lua.js + tests/wow_stub.lua), so later
// tracks can rely on it.
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { createVM, parseToc } = require('./helpers/lua');
const P = require('../bridge/protocol');

const tmpDirs = [];
test.after(() => { for (const d of tmpDirs) fs.rmSync(d, { recursive: true, force: true }); });

function tmpLua(src) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wch-harness-'));
  tmpDirs.push(dir);
  const file = path.join(dir, 'T.lua');
  fs.writeFileSync(file, src);
  return file;
}

test('loads the addon TOC, passes name and namespace, reads SavedVariables names', () => {
  const toc = parseToc(path.join(__dirname, '..', 'addon', 'WoWChatHelper', 'WoWChatHelper.toc'));
  assert.deepEqual(toc.savedVariables, ['WCH_DB']);
  assert.equal(toc.metadata.Interface, '16001');
  const vm = createVM();
  assert.equal(vm.addonName, 'WoWChatHelper');
  assert.equal(vm.str('type(WCH_Codec)'), 'table');
  assert.equal(vm.str('C_AddOns.IsAddOnLoaded("WoWChatHelper")'), 'true');
  assert.equal(vm.str('C_AddOns.GetAddOnMetadata("WoWChatHelper", "Interface")'), '16001');
});

test('sandbox: no io/os/require; Lua 5.2+ syntax is rejected', () => {
  const vm = createVM({ files: [] });
  assert.deepEqual(['io', 'os', 'require', 'package', 'dofile', 'loadfile'].map(n => vm.str(`type(${n})`)), Array(6).fill('nil'));
  assert.equal(vm.str('type(strsplit) .. type(wipe) .. type(unpack)'), 'functionfunctionfunction');
  assert.equal(vm.str('select(2, strsplit(":", "wch:r:12"))'), 'r');
  assert.throws(() => createVM({ files: [tmpLua('local x = 7 // 2')] }), /not valid Lua 5\.1/);
  assert.throws(() => createVM({ files: [tmpLua('goto done ::done::')] }), /not valid Lua 5\.1/);
});

test('saved variables are applied after the files run and survive reload', () => {
  const file = tmpLua('local ADDON = ...\nWCH_DB = WCH_DB or { fresh = true }\nlocal f = CreateFrame("Frame")\nf:RegisterEvent("ADDON_LOADED")\nf:SetScript("OnEvent", function(_, ev, name) if name == ADDON then WCH_DB.loads = (WCH_DB.loads or 0) + 1 end end)');
  const vm = createVM({ files: [file], savedVariableNames: ['WCH_DB'], saved: { WCH_DB: { learned: { lf1m: { term: 'LF1M', t: 5 } } } } });
  vm.login();
  assert.deepEqual(vm.savedVariables(), { WCH_DB: { learned: { lf1m: { term: 'LF1M', t: 5 } }, loads: 1 } });
  vm.run('WCH_DB.learned.hc = { term = "HC", zh = "英雄" }');
  const vm2 = vm.reload().login();
  assert.equal(vm2.eval('WCH_DB.learned.hc.zh'), '英雄');
  assert.equal(vm2.eval('WCH_DB.loads'), 2);
});

test('timers: After / NewTimer / NewTicker and OnUpdate follow the clock', () => {
  const vm = createVM({ files: [] });
  vm.run(`LOG = {}
    C_Timer.After(3, function() table.insert(LOG, "after3@" .. math.floor(GetTime())) end)
    local t = C_Timer.NewTimer(5, function() table.insert(LOG, "timer5") end)
    C_Timer.NewTicker(2, function() table.insert(LOG, "tick") end, 2)
    CANCEL_ME = C_Timer.NewTimer(4, function() table.insert(LOG, "cancelled!") end)
    UPD = 0
    local f = CreateFrame("Frame"); f:SetScript("OnUpdate", function(_, e) UPD = UPD + e end)`);
  vm.run('CANCEL_ME:Cancel()');
  vm.advance(2.5);
  assert.deepEqual(vm.eval('LOG'), ['tick']);
  vm.advance(10);
  assert.deepEqual(vm.eval('LOG'), ['tick', 'after3@1003', 'tick', 'timer5']);
  assert.ok(Math.abs(vm.num('UPD') - 12.5) < 1e-6);
});

test('chat: filters run per frame, lines are captured, events reach addon frames', () => {
  const vm = createVM({ files: [] });
  vm.run(`SEEN = {}
    ChatFrameUtil.AddMessageEventFilter("CHAT_MSG_CHANNEL", function(frame, ev, msg, sender, ...)
      local lineID = select(9, ...)
      return false, msg .. " |Hwch:x:" .. lineID .. "|h[?]|h", sender, ...
    end)
    ChatFrame_AddMessageEventFilter("CHAT_MSG_SAY", function() return true end)
    local f = CreateFrame("Frame"); f:RegisterEvent("CHAT_MSG_WHISPER")
    f:SetScript("OnEvent", function(_, ev, msg, sender, ...) table.insert(SEEN, ev .. "|" .. msg .. "|" .. sender .. "|" .. select(9, ...)) end)`);
  const id = vm.receiveChat('WHISPER', 'inv pls', 'Bob-Stormrage');
  vm.receiveChat('SAY', 'hidden', 'Spammer');
  const trade = vm.receiveChat('CHANNEL', 'WTS stuff', 'Al', { channel: 'Trade - City', channelIndex: 2 });
  assert.deepEqual(vm.eval('SEEN'), [`CHAT_MSG_WHISPER|inv pls|Bob-Stormrage|${id}`]);
  assert.deepEqual(vm.chatText('ChatFrame1'), ['[Bob-Stormrage] whispers: inv pls', `[2. Trade - City] [Al]: WTS stuff |Hwch:x:${trade}|h[?]|h`]);
  assert.deepEqual(vm.links(vm.chatText()[1]), [{ link: `wch:x:${trade}`, text: '[?]' }]);
  vm.run('print("hello", 1)');
  assert.deepEqual(vm.prints(), ['hello 1']);
  assert.equal(vm.chat().at(-1).print, true);
  vm.clearChat();
  assert.deepEqual(vm.chat(), []);
});

test('hyperlink clicks reach hooksecurefunc("SetItemRef") hooks', () => {
  const vm = createVM({ files: [] });
  vm.run('CLICKS = {}; hooksecurefunc("SetItemRef", function(link, text, button) table.insert(CLICKS, link .. " " .. text .. " " .. button) end)');
  vm.clickLink('|Hwch:r:12|h[回覆]|h');
  vm.clickLink('wch:d:12', '[詳細]', 'RightButton');
  assert.deepEqual(vm.eval('CLICKS'), ['wch:r:12 [回覆] LeftButton', 'wch:d:12 [詳細] RightButton']);
});

test('OpenChat records the line and parses the target like the client', () => {
  const vm = createVM({ files: [] });
  vm.run('ChatFrame_OpenChat("/w Bob-Stormrage omw, 5 min")');
  vm.run('ChatFrameUtil.OpenChat("/p inv pls")');
  vm.run('ChatFrameUtil.OpenChat("no prefix")');
  const calls = vm.openChatCalls();
  assert.deepEqual(calls.map(c => [c.chatType, c.tellTarget ?? null, c.text]), [
    ['WHISPER', 'Bob-Stormrage', 'omw, 5 min'], ['PARTY', 'Bob-Stormrage', 'inv pls'], ['PARTY', 'Bob-Stormrage', 'no prefix'],
  ]);
  assert.equal(vm.str('ChatFrame1EditBox:GetText()'), 'no prefix');
  assert.equal(vm.str('ChatFrame1EditBox:HasFocus()'), 'true');
  assert.deepEqual(vm.sent(), []);
});

test('slot addons execute the given slot source once; missing ones fail', () => {
  const vm = createVM({ files: [] });
  vm.setSlotSource(P.renderSlotFile({ now: 1790000001, session: 'S', results: [{ id: 3, kind: 't', status: 'done', replies: [{ en: 'omw', zh: '在路上', tone: 'short' }] }] }));
  vm.run('OK1 = C_AddOns.LoadAddOn("WoWChatHelper_S001")');
  assert.equal(vm.eval('WCH_SlotData.results[1].replies[1].zh'), '在路上');
  vm.run('WCH_SlotData = nil; OK2 = C_AddOns.LoadAddOn("WoWChatHelper_S001")');
  assert.equal(vm.eval('WCH_SlotData'), null, 'a loaded slot is not read again');
  vm.run('OK3, WHY = C_AddOns.LoadAddOn("WoWChatHelper_S201")');
  assert.deepEqual([vm.eval('OK1'), vm.eval('OK3'), vm.eval('WHY')], [true, false, 'MISSING']);
  vm.setSlotFile('WoWChatHelper_S002', 'WCH_SlotData = { v = 1, now = 2, session = "S", results = {} }');
  vm.run('C_AddOns.LoadAddOn("WoWChatHelper_S002")');
  assert.equal(vm.eval('WCH_SlotData.now'), 2);
  assert.deepEqual(vm.loadLog().map(e => e.ok), [true, true, false, true]);
});

test('PlaySoundFile reports playable only for raised signals (Windows-style path match)', () => {
  const vm = createVM({ files: [] });
  vm.raiseSignal('ack', 12);
  vm.setPlayable('sig/ctl/valid.wav');
  const play = (p) => vm.eval(`(PlaySoundFile(${P.luaString(p)}, "Master"))`);
  assert.equal(play('Interface\\AddOns\\WoWChatHelper\\sig\\ack\\012.wav'), true);
  assert.equal(play('interface/addons/wowchathelper/sig/ack/012.wav'), true);
  assert.equal(play('Interface\\AddOns\\WoWChatHelper\\sig\\ack\\013.wav'), false);
  assert.equal(play('Interface\\AddOns\\WoWChatHelper\\sig\\ctl\\valid.wav'), true);
  assert.equal(play('Interface\\AddOns\\WoWChatHelper\\sig\\ctl\\empty.wav'), false);
  assert.equal(vm.soundCalls().length, 5);
});

test('slash commands dispatch through SlashCmdList', () => {
  const vm = createVM({ files: [] });
  vm.run('SLASH_WCH1, SLASH_WCH2 = "/wch", "/chathelper"; SlashCmdList.WCH = function(msg) LAST = msg end');
  assert.equal(vm.slash('/WCH g  tank '), true);
  assert.equal(vm.eval('LAST'), 'g  tank');
  assert.equal(vm.slash('/chathelper'), true);
  assert.equal(vm.eval('LAST'), '');
  assert.equal(vm.slash('/nope x'), false);
});

test('UI basics: scripts, OnShow/OnHide, Esc closes UISpecialFrames, fonts', () => {
  const vm = createVM({ files: [] });
  vm.run(`F = CreateFrame("Frame", "WCHPicker", UIParent); F:Hide(); tinsert(UISpecialFrames, "WCHPicker")
    F:SetScript("OnShow", function() SHOWN = true end)
    B = CreateFrame("Button", nil, F); B:SetScript("OnClick", function(_, btn) CLICK = btn end)
    E = CreateFrame("EditBox", nil, F); E:SetScript("OnTextChanged", function(_, user) TYPED = tostring(user) end)
    FS = F:CreateFontString(nil, "OVERLAY"); OKF = FS:SetFont("Interface\\\\AddOns\\\\WoWChatHelper\\\\Fonts\\\\WCH-CJK.ttf", 13, "")
    STUB.badFonts["Fonts\\\\ARHei.ttf"] = true; BADF = FS:SetFont("Fonts\\\\ARHei.ttf", 13)`);
  vm.run('F:Show(); B:Click(); E:SetText("x")');
  assert.deepEqual([vm.eval('SHOWN'), vm.eval('CLICK'), vm.eval('TYPED'), vm.eval('OKF'), vm.eval('BADF')], [true, 'LeftButton', 'false', true, false]);
  assert.equal(vm.str('select(2, FS:GetFont())'), '13');
  assert.equal(vm.escape(), true);
  assert.equal(vm.eval('F:IsShown()'), false);
  assert.equal(vm.str('select(1, ChatFrame1:GetFont())'), 'Fonts\\ARIALN.TTF');
});

test('stripCells/decodeStrip read a strip drawn with Codec.lua', () => {
  const vm = createVM();
  const payload = P.encodeRecords([{ session: 'S', id: 7, kind: 'x', channel: 'WHISPER', sender: 'Bob', model: '', ctx: '', text: '你好 inv?' }]);
  vm.run(`local payload = ...
    local strip = CreateFrame("Frame", "WCHStrip", UIParent)
    local cells = WCH_Codec.Encode(7, payload)
    for i, v in ipairs(cells) do
      local t = strip:CreateTexture(nil, "OVERLAY")
      local col, row = WCH_Codec.CellPos(i - 1)
      t:SetSize(4, 4); t:SetPoint("TOPLEFT", strip, "TOPLEFT", col * 4, -row * 4)
      t:SetColorTexture(WCH_Codec.CellColor(v))
    end`, payload);
  const f = vm.decodeStrip();
  assert.equal(f.id, 7);
  assert.equal(f.records[0].text, '你好 inv?');
  vm.run('WCHStrip:Hide()');
  assert.equal(vm.decodeStrip(), null);
});
