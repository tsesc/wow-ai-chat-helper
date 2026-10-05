// Addon UI (spec 4): annotation lines, [回覆] picker -> chat edit box, translate target
// rule, detail, glossary search + learned terms, status frame, fonts, /tr alias.
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { boot, ackStrip, deliver, publish, sample, FONT } = require('./helpers/addon');

// Whisper/party line -> request -> result delivered. Returns { vm, id }.
function explained(ev = 'WHISPER', sender = 'Bob', text = 'LF1M tank HC DM, inv', opts = {}, result = {}) {
  const vm = opts.vm || boot();
  vm.receiveChat(ev, text, sender, opts.chat || {});
  vm.advance(0.6);
  const id = vm.decodeStrip().records.at(-1).id;
  ackStrip(vm);
  deliver(vm, id, [sample.x(id, result)]);
  return { vm, id };
}

test('slot load -> annotation lines with [回覆] / [詳細] links and a terms line', () => {
  const { vm, id } = explained();
  const lines = vm.chatText('ChatFrame1');
  const i = lines.findIndex(t => t.includes('[譯]|r 徵 1 名坦克'));
  assert.ok(i > 0);
  assert.ok(lines[i - 1].includes('LF1M tank HC DM, inv'), 'printed right after the original line');
  assert.deepEqual(vm.links(lines[i]), [{ link: `wch:r:${id}`, text: '[回覆]' }, { link: `wch:d:${id}`, text: '[詳細]' }]);
  assert.equal(lines[i + 1], '|cff9a9a9a   LF1M=還缺一人 · HC=英雄難度|r');
  assert.deepEqual(vm.sent(), []);
});

test('[回覆] opens the picker; a candidate fills the edit box as /w <sender> (never sends)', () => {
  const { vm, id } = explained('WHISPER', 'Bob-Stormrage');
  vm.clickLink(`wch:r:${id}`);
  assert.equal(vm.str('tostring(WCHPicker:IsShown())'), 'true');
  assert.equal(vm.str('WCHPickerButton1.en:GetText()'), 'inv pls, tank here');
  assert.match(vm.str('WCHPickerButton2.gloss:GetText()'), /嗨，我可以坦.*禮貌/);
  assert.equal(vm.str('tostring(WCHPickerButton3:IsShown())'), 'true');
  vm.run('WCHPickerButton2:Click()');
  const calls = vm.openChatCalls();
  assert.equal(calls.length, 1);
  const { line, text, chatType, tellTarget } = calls[0];
  assert.deepEqual({ line, text, chatType, tellTarget }, {
    line: '/w Bob-Stormrage Hi! I can tank, could I get an invite?', text: 'Hi! I can tank, could I get an invite?',
    chatType: 'WHISPER', tellTarget: 'Bob-Stormrage',
  });
  assert.equal(vm.str('ChatFrame1EditBox:GetText()'), 'Hi! I can tank, could I get an invite?');
  assert.equal(vm.str('tostring(WCHPicker:IsShown())'), 'false');
  assert.deepEqual(vm.sent(), [], 'nothing sent');
});

test('picker target follows the channel: party -> PARTY, trade -> /2, Esc closes', () => {
  const { vm, id } = explained('PARTY', 'Ann', 'can u tank?');
  vm.clickLink(`wch:r:${id}`);
  vm.run('WCHPickerButton1:Click()');
  assert.equal(vm.openChatCalls().at(-1).chatType, 'PARTY');
  assert.equal(vm.openChatCalls().at(-1).text, 'inv pls, tank here');

  vm.receiveChat('CHANNEL', 'LFM BRD need tank', 'Lead', { channel: 'Trade - City', channelIndex: 2 });
  const q = vm.links(vm.chatText().find(t => t.includes('LFM BRD'))).find(l => l.text === '[?]');
  vm.clickLink(q.link);
  vm.advance(0.6);
  const id2 = vm.decodeStrip().records.at(-1).id;
  ackStrip(vm);
  deliver(vm, id2, [sample.x(id2)]);
  vm.clickLink(`wch:r:${id2}`);
  vm.run('WCHPickerButton3:Click()');
  const c = vm.openChatCalls().at(-1);
  assert.equal(c.chatType, 'CHANNEL');
  assert.equal(c.channelTarget, 2);
  assert.equal(c.text, 'tank lf inv');

  vm.clickLink(`wch:r:${id2}`);
  assert.equal(vm.str('tostring(WCHPicker:IsShown())'), 'true');
  vm.escape();
  assert.equal(vm.str('tostring(WCHPicker:IsShown())'), 'false');
  assert.deepEqual(vm.sent(), []);
});

test('translate: last whisper partner within 2 min, else the edit box chat type, default SAY', () => {
  const vm = boot();
  // Default: SAY.
  vm.slash('/wch tr 大家好');
  vm.advance(0.6);
  let r = vm.decodeStrip().records.at(-1);
  assert.deepEqual([r.kind, r.channel, r.sender, r.text], ['t', 'SAY', '', '大家好']);
  ackStrip(vm);
  // A whisper came in: /tr goes back to that person.
  vm.receiveChat('WHISPER', 'where r u?', 'Bob');
  vm.advance(0.6);
  ackStrip(vm);
  vm.advance(60);
  assert.equal(vm.slash('/tr 我五分鐘後到'), true, '/tr alias is registered');
  vm.advance(0.6);
  r = vm.decodeStrip().records.at(-1);
  assert.deepEqual([r.kind, r.channel, r.sender, r.text], ['t', 'WHISPER', 'Bob', '我五分鐘後到']);
  assert.equal(r.ctx, 'Bob: where r u?');
  const tid = r.id;
  ackStrip(vm);
  // Result opens the picker; a pick fills /w Bob.
  deliver(vm, tid, [sample.t(tid)]);
  assert.equal(vm.str('tostring(WCHPicker:IsShown())'), 'true');
  assert.match(vm.str('WCHPicker.title:GetText()'), /密語 Bob/);
  vm.run('WCHPickerButton1:Click()');
  assert.deepEqual([vm.openChatCalls().at(-1).chatType, vm.openChatCalls().at(-1).tellTarget, vm.openChatCalls().at(-1).text], ['WHISPER', 'Bob', 'omw, 5 min']);
  // More than 2 minutes later: the edit box's chat type (guild here).
  vm.advance(130);
  vm.run('ChatFrame1EditBox:SetAttribute("chatType", "GUILD")');
  vm.slash('/tr 謝謝大家');
  vm.advance(0.6);
  r = vm.decodeStrip().records.at(-1);
  assert.deepEqual([r.channel, r.sender], ['GUILD', '']);
  assert.deepEqual(vm.sent(), []);
});

test('/tr is not taken over when another addon registered it; /wch tr still works', () => {
  const vm = boot({ before: 'SLASH_OTHERTR1 = "/tr"; SlashCmdList.OTHERTR = function(m) OTHER_GOT = m end' });
  assert.equal(vm.str('tostring(WCH.trRegistered)'), 'nil');
  assert.equal(vm.str('tostring(WCH.trBlocked)'), 'true');
  vm.slash('/tr hello');
  assert.equal(vm.str('OTHER_GOT'), 'hello');
  vm.slash('/chathelper tr 你好');
  vm.advance(0.6);
  assert.equal(vm.decodeStrip().records.at(-1).text, '你好');
});

test('[詳細] sends a d request with the original text and ctx; the result prints [詳細] lines', () => {
  const vm = boot();
  vm.receiveChat('WHISPER', 'u there?', 'Bob');
  const { id } = explained('WHISPER', 'Bob', 'r u even geared for this', { vm });
  vm.clickLink(`wch:d:${id}`);
  vm.advance(0.6);
  const d = vm.decodeStrip().records.at(-1);
  assert.deepEqual([d.kind, d.channel, d.sender, d.model, d.text, d.ctx], ['d', 'WHISPER', 'Bob', '', 'r u even geared for this', 'Bob: u there?']);
  ackStrip(vm);
  deliver(vm, d.id, [{ id: d.id, kind: 'd', status: 'done', detail: '語氣：有點不耐煩\n情境：他懷疑你的裝備\n建議：禮貌說明裝等' }]);
  const lines = vm.chatText().filter(t => t.includes('[詳細]|r'));
  assert.deepEqual(lines.slice(-3), ['|cff8fa9c8[詳細]|r 語氣：有點不耐煩', '|cff8fa9c8[詳細]|r 情境：他懷疑你的裝備', '|cff8fa9c8[詳細]|r 建議：禮貌說明裝等']);
});

test('bridge error result prints 失敗 (<err>) with [重試]', () => {
  const vm = boot();
  vm.receiveChat('WHISPER', 'boom', 'Bob');
  vm.advance(0.6);
  const id = vm.decodeStrip().records.at(-1).id;
  ackStrip(vm);
  deliver(vm, id, [{ id, kind: 'x', status: 'error', err: 'timeout' }]);
  const fail = vm.chatText().find(t => t.includes('失敗'));
  assert.match(fail, /\[譯\]\|r \|cffff7070失敗 \(timeout\)/);
  assert.equal(vm.links(fail)[0].link, `wch:retry:${id}`);
});

test('[回覆] on an offline line asks the AI for candidates and opens the picker', () => {
  const vm = boot();
  vm.receiveChat('WHISPER', 'ty', 'Bob');
  const off = vm.chatText().find(t => t.includes('[譯·離線]'));
  const r = vm.links(off).find(l => l.text === '[回覆]');
  vm.clickLink(r.link);
  vm.advance(0.6);
  const rec = vm.decodeStrip().records.at(-1);
  assert.deepEqual([rec.kind, rec.text, rec.channel], ['x', 'ty', 'WHISPER']);
  ackStrip(vm);
  deliver(vm, rec.id, [sample.x(rec.id, { zh: '謝謝' })]);
  assert.equal(vm.str('tostring(WCHPicker:IsShown())'), 'true');
});

test('glossary: search matches term, expansion or Chinese; panel filters as you type', () => {
  const vm = boot();
  const terms = (q) => vm.eval(`WCH.UI.SearchGlossary(${JSON.stringify(q)})`).map(e => e.term);
  assert.deepEqual(terms('hc'), ['HC']);
  assert.deepEqual(terms('heroic'), ['HC']);
  assert.deepEqual(terms('徵人'), ['LFM']);
  assert.deepEqual(terms('looking for'), ['LFM', 'LF1M']);
  assert.equal(terms('').length, 5);
  vm.slash('/wch g tank');
  assert.equal(vm.str('tostring(WCHGlossary:IsShown())'), 'true');
  assert.deepEqual(vm.eval('WCH.UI.GlossaryRows()'), ['tank — damage-absorbing role — 坦克  |cff9a9a9a內建|r']);
  vm.run('WCHGlossarySearch:SetText("邀")');
  assert.deepEqual(vm.eval('WCH.UI.GlossaryRows()').map(r => r.split(' — ')[0]), ['inv']);
  vm.escape();
  assert.equal(vm.str('tostring(WCHGlossary:IsShown())'), 'false');
});

test('learned terms: AI terms not built in are saved with first-seen time and survive /reload', () => {
  const { vm } = explained('WHISPER', 'Bob', 'LF1M DM run', {}, {
    terms: [{ term: 'HC', expansion: 'Heroic', zh: '英雄難度' }, { term: 'DM', expansion: 'Dire Maul', zh: '厄運之槌' }],
  });
  const learned = vm.eval('WCH_DB.learned');
  assert.deepEqual(Object.keys(learned), ['dm']);
  assert.equal(learned.dm.term, 'DM');
  assert.equal(learned.dm.zh, '厄運之槌');
  assert.ok(learned.dm.t >= 1790000000 && learned.dm.t <= vm.num('time()'), 'first-seen time');
  const first = learned.dm.t;
  const vm2 = vm.reload();
  vm2.setPlayable('sig/ctl/valid.wav');
  vm2.login();
  const found = vm2.eval('WCH.UI.SearchGlossary("dire")');
  assert.deepEqual(found.map(e => [e.term, e.source]), [['DM', 'AI']]);
  assert.equal(vm2.eval('WCH_DB.learned.dm.t'), first);
  vm2.slash('/wch g 厄運');
  assert.match(vm2.eval('WCH.UI.GlossaryRows()')[0], /^DM — Dire Maul — 厄運之槌 .*AI/);
});

test('status frame: /wch toggles it; shows slots, pending, toggles write settings', () => {
  const vm = boot();
  vm.slash('/wch');
  assert.equal(vm.str('tostring(WCHStatus:IsShown())'), 'true');
  assert.match(vm.str('WCHStatus.slots:GetText()'), /200 \/ 200/);
  vm.receiveChat('WHISPER', 'pending one', 'Bob');
  vm.advance(0.6);
  assert.match(vm.str('WCHStatus.pending:GetText()'), /1$/);
  vm.run('WCHStatus.checks.raid:SetChecked(false); WCHStatus.checks.raid:Click()');
  assert.equal(vm.eval('WCH_DB.settings.auto.raid'), false);
  vm.slash('/wch');
  assert.equal(vm.str('tostring(WCHStatus:IsShown())'), 'false');
});

test('fonts: chat frames use the bundled CJK font at their size; /wch font off restores', () => {
  const vm = boot();
  assert.deepEqual(vm.eval('ChatFrame1.font'), [FONT, 14, '']);
  assert.deepEqual(vm.eval('ChatFrame1EditBox.font')[0], FONT);
  vm.slash('/wch font off');
  assert.equal(vm.eval('WCH_DB.chatFont'), false);
  assert.equal(vm.eval('ChatFrame1.font')[0], 'Fonts\\ARIALN.TTF');
  // Own FontStrings always use the bundled font.
  vm.slash('/wch');
  assert.equal(vm.eval('WCHStatus.slots.font')[0], FONT);
  // Off stays off after reload.
  const vm2 = vm.reload();
  vm2.login();
  assert.equal(vm2.eval('ChatFrame1.font')[0], 'Fonts\\ARIALN.TTF');
});

test('a missing font file falls back without breaking', () => {
  const vm = boot({ before: `STUB.badFonts[${JSON.stringify(FONT)}] = true` });
  assert.equal(vm.eval('ChatFrame1.font')[0], 'Fonts\\ARIALN.TTF');
  assert.ok(vm.chatText().some(t => t.includes('WCH-CJK.ttf')));
});

test('end to end: nothing the addon does ever calls SendChatMessage', () => {
  const { vm, id } = explained();
  vm.clickLink(`wch:r:${id}`);
  for (let i = 1; i <= 3; i++) vm.run(`WCHPickerButton${i}:Click()`);
  vm.slash('/wch tr 好');
  vm.clickLink(`wch:d:${id}`);
  vm.advance(200);
  publish(vm, []);
  assert.deepEqual(vm.sent(), []);
});
