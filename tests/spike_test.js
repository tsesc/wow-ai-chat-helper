// Tests for spike/WCHSpike (the throwaway diagnostics addon, spec section 7).
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { createVM, parseToc } = require('./helpers/lua');

const SPIKE = 'spike/WCHSpike/WCHSpike.lua';
const SPIKE_TOC = path.join(__dirname, '..', 'spike', 'WCHSpike', 'WCHSpike.toc');
const opts = (extra = {}) => ({ files: [SPIKE], addonName: 'WCHSpike', ...extra });
const report = (vm) => vm.eval('WCHSpike_Report');

test('TOC: Interface 16001 and the Lua file listed', () => {
  const toc = parseToc(SPIKE_TOC);
  assert.equal(toc.metadata.Interface, '16001');
  assert.equal(toc.files.length, 1);
  assert.ok(fs.existsSync(toc.files[0]));
});

test('/wchspike runs and reports every spec 7.3 API plus fonts, link and IME lines', () => {
  const vm = createVM(opts());
  vm.login();
  assert.equal(vm.slash('/wchspike'), true);
  const lines = report(vm);
  const text = lines.join('\n');
  for (const api of ['ChatFrame_AddMessageEventFilter', 'ChatFrameUtil.AddMessageEventFilter',
    'ChatFrame_OpenChat', 'ChatFrameUtil.OpenChat', 'SetItemRef', 'issecretvalue',
    'C_AddOns.LoadAddOn', 'PlaySoundFile']) {
    assert.ok(text.includes('api ' + api), 'missing report line for ' + api);
  }
  for (const f of ['ARHei.ttf', 'ARKai_T.ttf', 'bHEI00M.ttf', 'bLEI00D.ttf', 'blei00d.TTF', 'bundled WCH-CJK.ttf']) {
    assert.ok(text.includes('font ' + f), 'missing font line for ' + f);
  }
  assert.ok(text.includes('link click'));
  assert.ok(text.includes('ime editbox'));
  assert.ok(lines.every(l => /^(OK|MISS|INFO|ERR) /.test(l) && !l.includes('\n')), 'one compact line per check');
  assert.ok(!text.includes('ERR '), 'no errors on a full stub:\n' + text);
  // CJK test text was printed to the default chat frame
  assert.ok(vm.chatText().some(t => t.includes('中文測試 繁體')));
});

test('the report box holds the full report and the bundled font path is used', () => {
  const vm = createVM(opts());
  vm.login();
  vm.slash('/wchspike');
  assert.equal(vm.str('WCHSpikeReport:GetText()'), report(vm).join('\n'));
  assert.equal(vm.str('select(1, WCHSpikeIME:GetFont())'), 'Interface\\AddOns\\WCHSpike\\WCH-CJK.ttf');
});

test('survives missing APIs: still runs and reports MISS lines', () => {
  const vm = createVM(opts({
    before: `
      issecretvalue = nil; ChatFrameUtil = nil; ChatFrame_OpenChat = nil
      ChatFrame_AddMessageEventFilter = nil; PlaySoundFile = nil; LoadAddOn = nil
      C_AddOns = nil; C_Timer = nil; GetBuildInfo = nil; GetPhysicalScreenSize = nil
      ChatEdit_GetActiveWindow = nil; hooksecurefunc = nil
    `,
  }));
  vm.login();
  assert.equal(vm.slash('/wchspike'), true);
  const lines = report(vm);
  const miss = lines.filter(l => l.startsWith('MISS') && l.includes(' api '));
  assert.ok(miss.length >= 10, 'expected many MISS api lines, got ' + miss.length);
  assert.ok(lines.some(l => l.startsWith('MISS') && l.includes('api ChatFrameUtil.OpenChat')));
  assert.ok(lines.some(l => l.includes('font ARHei.ttf')), 'font lines still produced');
  assert.ok(lines.some(l => l.includes('link click')), 'link line still produced');
  assert.ok(lines.some(l => l.startsWith('ERR') && l.includes('hook SetItemRef')), 'hook failure is reported, not thrown');
});

test('survives bad fonts (SetFont false) and rerunning', () => {
  const vm = createVM(opts());
  vm.login();
  vm.run('STUB.badFonts["Fonts\\\\ARHei.ttf"] = true');
  vm.slash('/wchspike');
  vm.slash('/wchspike');
  const lines = report(vm);
  assert.ok(lines.some(l => l.startsWith('MISS') && l.includes('font ARHei.ttf')));
  assert.ok(lines.some(l => l.startsWith('OK') && l.includes('font ARKai_T.ttf')));
  assert.equal(lines.filter(l => l.includes('font ARHei.ttf')).length, 1, 'rerun resets the report');
});

test('clicking the custom hyperlink updates the report line', () => {
  const vm = createVM(opts());
  vm.login();
  vm.slash('/wchspike');
  assert.ok(report(vm).some(l => l.includes('not clicked yet')));
  const printed = vm.chatText().find(t => t.includes('|Hwchspike:test|h'));
  assert.ok(printed, 'test link printed to chat');
  vm.clickLink('wchspike:test');
  const lines = report(vm);
  assert.ok(lines.some(l => l.startsWith('OK') && l.includes('link click #1')), lines.join('\n'));
  assert.ok(vm.str('WCHSpikeReport:GetText()').includes('link click #1'));
});

test('typing in the IME edit box updates its report line', () => {
  const vm = createVM(opts());
  vm.login();
  vm.slash('/wchspike');
  vm.run('WCHSpikeIME:SetText("中文")');
  vm.run('local s = WCHSpikeIME.scripts.OnTextChanged; if s then s(WCHSpikeIME) end');
  assert.ok(report(vm).some(l => l.includes('typed 6 bytes')), report(vm).join('\n'));
});
