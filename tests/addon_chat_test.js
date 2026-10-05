// Addon chat side (spec 3.5 offline short-circuit, 4 manual trigger, secret values):
// event hooks, message filter [?] links, offline phrases, context. fengari VM.
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { boot, ackStrip, deliver, sample, FILES } = require('./helpers/addon');

const xRecords = (vm) => { const f = vm.decodeStrip(); return f ? f.records.filter(r => r.kind === 'x') : []; };

test('offline short-circuit: a known phrase is explained locally, no request', () => {
  const vm = boot();
  const id0 = vm.num('WCH_DB.lastId');
  vm.receiveChat('WHISPER', '  TY!! ', 'Bob');
  vm.receiveChat('PARTY', 'inv   pls', 'Ann');
  vm.receiveChat('GUILD', 'omw.', 'Gil');
  vm.advance(1);
  assert.equal(vm.decodeStrip(), null, 'nothing on the strip');
  assert.equal(vm.num('WCH_DB.lastId'), id0, 'no request id used');
  const lines = vm.chatText('ChatFrame1');
  const ty = lines.findIndex(t => t.includes('[譯·離線]|r 謝謝'));
  assert.ok(ty > 0, 'offline annotation printed');
  assert.match(lines[ty + 1], /ty=謝謝/);
  assert.deepEqual(vm.links(lines[ty]).map(l => l.text), ['[回覆]', '[詳細]']);
  assert.ok(lines.some(t => t.includes('[譯·離線]|r 請邀我')));
  assert.ok(lines.some(t => t.includes('[譯·離線]|r 我在路上了')));
  assert.equal(vm.loadLog().length, 0);
});

test('offline short-circuit with the real Glossary.lua (whole TOC)', { skip: !fs.existsSync(path.join(path.dirname(FILES[0]), 'Glossary.lua')) }, () => {
  const vm = boot({ toc: true });
  vm.receiveChat('WHISPER', 'gg', 'Bob');
  vm.advance(1);
  assert.equal(vm.decodeStrip(), null);
  assert.ok(vm.chatText().some(t => t.includes('[譯·離線]')));
});

test('manual channels get a [?] link and no request until it is clicked', () => {
  const vm = boot();
  vm.receiveChat('CHANNEL', 'WTS [Lionheart Helm] 300g pst', 'Seller', { channel: 'Trade - City', channelIndex: 2 });
  vm.receiveChat('SAY', 'anyone selling linen?', 'Sayer');
  vm.advance(1);
  assert.deepEqual(xRecords(vm), [], 'manual channels never auto-request');
  const lines = vm.chatText('ChatFrame1');
  const trade = lines.find(t => t.includes('WTS'));
  const q = vm.links(trade).find(l => l.text === '[?]');
  assert.ok(q, '[?] appended');
  assert.match(q.link, /^wch:x:\d+$/);
  assert.ok(lines.find(t => t.includes('linen')).includes('[?]'));
  vm.clickLink(q.link);
  vm.advance(0.6);
  const [r] = xRecords(vm);
  assert.equal(r.channel, 'CHANNEL:Trade');
  assert.equal(r.sender, 'Seller');
  assert.equal(r.text, 'WTS [Lionheart Helm] 300g pst', 'the [?] link is not part of the text');
  vm.clickLink(q.link);
  vm.advance(0.6);
  assert.equal(xRecords(vm).length, 1, 'clicking again does not duplicate the request');
});

test('auto-explain per channel group can be turned off', () => {
  const vm = boot();
  vm.slash('/wch auto guild off');
  assert.equal(vm.eval('WCH_DB.settings.auto.guild'), false);
  vm.receiveChat('GUILD', 'anyone up for strat?', 'Gil');
  vm.receiveChat('OFFICER', 'officer stuff', 'Off');
  vm.receiveChat('PARTY', 'need a heal', 'Ann');
  vm.advance(0.6);
  assert.deepEqual(xRecords(vm).map(r => r.channel), ['PARTY']);
  // A disabled auto channel shows no [?] either (only manual channels do).
  assert.ok(!vm.chatText().find(t => t.includes('strat?')).includes('[?]'));
});

test('own messages are not explained; secret values are skipped silently', () => {
  const vm = boot({ before: 'function issecretvalue(v) return v == "SECRET LINE" end' });
  vm.receiveChat('PARTY', 'my own line', 'Testchar');
  vm.receiveChat('RAID', 'SECRET LINE', 'Boss');
  vm.receiveChat('SAY', 'SECRET LINE', 'Boss');
  vm.advance(0.6);
  assert.deepEqual(xRecords(vm), []);
  const say = vm.chat('ChatFrame1').filter(e => e.event === 'CHAT_MSG_SAY');
  assert.equal(say[0].text, '[Boss] says: SECRET LINE', 'filter left the secret line untouched');
  assert.ok(!vm.chatText().some(t => t.includes('[譯')));
});

test('annotations go to the chat frame that showed the original line', () => {
  const vm = boot();
  vm.receiveChat('WHISPER', 'want to duel?', 'Bob', { frames: ['ChatFrame2'] });
  vm.advance(0.6);
  const [r] = xRecords(vm);
  ackStrip(vm);
  deliver(vm, r.id, [sample.x(r.id, { zh: '要決鬥嗎？' })]);
  assert.ok(vm.chatText('ChatFrame2').some(t => t.includes('要決鬥嗎？')));
  assert.ok(!vm.chatText('ChatFrame1').some(t => t.includes('要決鬥嗎？')));
});

test('links and color codes are expanded to [Name] in text and ctx', () => {
  const vm = boot();
  vm.receiveChat('PARTY', 'need |cffa335ee|Hitem:12345::::::::60:::::|h[Thunderfury]|h|r ?', 'Ann');
  vm.receiveChat('PARTY', 'lol |cff00ff00green|r', 'Ann');
  vm.advance(0.6);
  const recs = xRecords(vm);
  assert.equal(recs[0].text, 'need [Thunderfury] ?');
  assert.equal(recs[1].text, 'lol green');
  assert.equal(recs[1].ctx, 'Ann: need [Thunderfury] ?');
});

test('the addon never calls SendChatMessage (static check over its sources)', () => {
  const dir = path.dirname(FILES[0]);
  for (const f of fs.readdirSync(dir).filter(n => n.endsWith('.lua'))) {
    const src = fs.readFileSync(path.join(dir, f), 'utf8');
    assert.ok(!/SendChatMessage\s*\(/.test(src), `${f} must not call SendChatMessage`);
  }
});
