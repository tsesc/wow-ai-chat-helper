// Diagnostic report (copy window): Transport.run.events ring, UI.BuildReport text,
// the WCHReport window (/wch report, status-window button). fengari VM.
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { boot, ackStrip, deliver, sample } = require('./helpers/addon');

const HL = 'STUB.Methods.HighlightText = function(self) self.highlighted = true end';
const reportLines = (vm) => vm.str('WCH.UI.BuildReport()').split('\n');

test('/wch report: a focused, highlighted multi-line edit box with the report; hint printed; Esc closes', () => {
  const vm = boot({ before: HL });
  vm.receiveChat('WHISPER', 'LF1M tank HC DM, inv', 'Bob');
  vm.advance(0.6);
  const id = vm.decodeStrip().records.at(-1).id;
  ackStrip(vm);
  vm.clearChat();
  vm.slash('/wch report');
  assert.equal(vm.str('tostring(WCHReport:IsShown())'), 'true');
  assert.equal(vm.str('tostring(WCHReportEdit:IsMultiLine())'), 'true');
  assert.equal(vm.str('tostring(STUB.focus == WCHReportEdit)'), 'true', 'focused');
  assert.equal(vm.str('tostring(WCHReportEdit.highlighted)'), 'true', 'all text selected');
  assert.equal(vm.str('WCHReportScroll:GetScrollChild():GetName()'), 'WCHReportEdit');
  assert.ok(vm.chatText().some(t => t.includes('按 Ctrl+C 複製，Esc 關閉')), vm.chatText().join('\n'));
  const text = vm.str('WCHReportEdit:GetText()');
  const lines = text.split('\n');
  const has = (re) => assert.ok(lines.some(l => re.test(l)), `${re} in\n${text}`);
  has(/^addon: 0\.1\.0$/);
  has(/^client: 1\.60\.1 build 69913 toc 16001 locale enUS$/);
  has(/^player: Testchar-TestRealm$/);
  has(/^lang: zhTW \(auto\)$/);
  has(/^signals: ok$/);
  has(/^selftest: ok \(passed\)$/);
  has(/^bridge: (ok|unknown)/);
  has(/^slots: 200\/200/);
  has(/^pending: 1$/);
  has(new RegExp(`^  #${id} x status=sent acked=true tries=1 age=\\d+s$`));
  has(/^events \(\d+\):$/);
  has(/ hello #\d+$/);
  has(new RegExp(` request #${id} kind=x$`));
  has(new RegExp(` ack #${id} via=signal$`));
  has(/ selftest ok \(passed\)$/);
  assert.ok(!text.includes('LF1M tank'), 'no chat text in the report');
  assert.ok(!text.includes('Bob'), 'no sender names in the report');
  assert.ok(text.length <= 4000);
  // Typing does not change it (read-only style).
  vm.run('local e = WCHReportEdit; e.text = "x"; STUB.RunScript(e, "OnTextChanged", true)');
  assert.equal(vm.str('WCHReportEdit:GetText()'), text);
  // Esc inside the focused box closes the window.
  vm.run('STUB.RunScript(WCHReportEdit, "OnEscapePressed")');
  assert.equal(vm.str('tostring(WCHReport:IsShown())'), 'false');
  assert.deepEqual(vm.sent(), []);
});

test('status window has a 複製回報 button that opens the report; results, polls and failures are logged', () => {
  const vm = boot();
  vm.receiveChat('WHISPER', 'secret words here', 'Bob');
  vm.advance(0.6);
  const id = vm.decodeStrip().records.at(-1).id;
  ackStrip(vm);
  deliver(vm, id, [sample.x(id)]);
  vm.receiveChat('WHISPER', 'another one', 'Bob');
  vm.advance(0.6);
  const id2 = vm.decodeStrip().records.at(-1).id;
  ackStrip(vm);
  deliver(vm, id2, [{ id: id2, kind: 'x', status: 'error', err: 'timeout' }]);
  vm.slash('/wch');
  assert.equal(vm.str('WCHStatusReport:GetText()'), '複製回報');
  vm.run('WCHStatusReport:Click()');
  assert.equal(vm.str('tostring(WCHReport:IsShown())'), 'true');
  const text = vm.str('WCHReportEdit:GetText()');
  assert.match(text, /signal ready #\d+/);
  assert.match(text, /poll WoWChatHelper_S001 why=signal/);
  assert.match(text, new RegExp(`result #${id} done`));
  assert.match(text, new RegExp(`result #${id2} error`));
  assert.match(text, new RegExp(`failed #${id2} kind=x: timeout`));
  assert.match(text, /^pending: 0$/m);
  assert.ok(!text.includes('secret words'));
});

test('events: a ring of 30; pcall errors are logged; the report stays under 4000 chars by dropping the oldest events', () => {
  const vm = boot();
  vm.run('WCH.Try(function() error("kaboom") end)');
  assert.match(vm.str('WCH.UI.BuildReport()'), /error .*kaboom/);
  for (let i = 1; i <= 40; i++) vm.run(`WCH.Transport.Event("test", "e${i} " .. string.rep("x", 150))`);
  assert.equal(vm.num('#WCH.Transport.run.events'), 30);
  assert.match(vm.str('WCH.Transport.run.events[1].msg'), /^e11 /);
  const text = vm.str('WCH.UI.BuildReport()');
  assert.ok(text.length <= 4000, `length ${text.length}`);
  assert.match(text, /e40 x/, 'newest kept');
  assert.ok(!/e11 x/.test(text), 'oldest dropped');
  const ev = reportLines(vm).filter(l => / test e\d+ /.test(l)).map(l => Number(l.match(/ e(\d+) /)[1]));
  assert.deepEqual(ev, [...ev].sort((a, b) => a - b), 'oldest first');
  assert.equal(ev.at(-1), 40);
  assert.match(text, /^events \(\d+ of 30, oldest dropped\):$/m);
});

test('a bridge error quoting chat text: only its code goes into the events, "|" never reaches the report', () => {
  const vm = boot();
  vm.receiveChat('WHISPER', 'meet me at the bank', 'Bob');
  vm.advance(0.6);
  const id = vm.decodeStrip().records.at(-1).id;
  ackStrip(vm);
  const err = 'codex exit 1: stdout said "Bob: meet me at the bank |cffff0000x|r"';
  deliver(vm, id, [{ id, kind: 'x', status: 'error', err }]);
  assert.ok(vm.chatText().some(t => t.includes('codex exit 1')), 'the chat frame still shows the full error');
  vm.run('WCH.Transport.Event("test|kind", "a|b")');
  const text = vm.str('WCH.UI.BuildReport()');
  assert.match(text, new RegExp(`failed #${id} kind=x: codex exit 1$`, 'm'));
  assert.ok(!text.includes('meet me') && !text.includes('Bob') && !text.includes('stdout'), text);
  assert.ok(!text.includes('|'), 'no pipe in the report');
  assert.match(text, /test¦kind a¦b$/m);
  // ErrCode edge cases.
  assert.equal(vm.str('WCH.Transport.ErrCode(": only text after")'), 'error');
  assert.equal(vm.str('WCH.Transport.ErrCode(nil)'), 'error');
  assert.equal(vm.str('WCH.Transport.ErrCode("timeout")'), 'timeout');
  assert.equal(vm.str('WCH.Transport.ErrCode("a_very_long-error code that keeps going: x")'), 'averylong-error code tha');
});

test('/wch report takes the focus back next frame if the chat box grabbed it', () => {
  const vm = boot({ before: HL });
  vm.slash('/wch report');
  vm.run('WCHReportEdit.highlighted = nil; ChatFrame1EditBox:SetFocus()');
  vm.advance(0.1);
  assert.equal(vm.str('tostring(STUB.focus == WCHReportEdit)'), 'true');
  assert.equal(vm.str('tostring(WCHReportEdit.highlighted)'), 'true');
});
