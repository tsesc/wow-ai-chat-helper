// Trade chat: the TRADE LINES prompt section, the optional "trade" field of explain
// results (bridge validation, slot file, an addon that does not know the field yet) and
// the shape of the live trade eval set (data/eval/trade*.json, tests/live/eval_trade.js).
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const ai = require('../bridge/ai');
const P = require('../bridge/protocol');
const { createVM } = require('./helpers/lua');
const { boot, ackStrip, deliver, sample } = require('./helpers/addon');

const req = (id, text, kind = 'x', extra = {}) => ({ id, kind, channel: 'CHANNEL:Trade - City', sender: 'S', ctx: '', text, ...extra });
const base = { id: 1, kind: 'x', tr: '他要賣', terms: [], replies: [{ en: 'how much for 5?' }, { en: 'ill take 1', tone: 'short' }] };

test('system prompt: TRADE LINES section, sides, whisper ctx rule, totals, trade field, translate format', () => {
  for (const loc of ai.LOCALES) {
    const p = ai.buildSystemPrompt(loc);
    assert.match(p, /TRADE LINES/, loc);
    for (const side of ['sell', 'buy', 'trade', 'craft-request', 'craft-offer']) assert.ok(p.includes(`"${side}"`), `${loc} side ${side}`);
    assert.match(p, /who has the item now, who pays the gold, who does the work/);
    assert.match(p, /a ctx line whose name is not the sender is the player's own line/);
    assert.match(p, /30 gold each, 240 gold for all 8/);
    assert.match(p, /the player is the OTHER party/);
    assert.match(p, /"wtt \[I1\] \+ 20g for \[I2\]"/);
    assert.match(p, /"trade": \{<only for trade lines/);
  }
  // The trade examples' replies follow the reply style rules.
  const ex = ai.SYSTEM_PROMPT.slice(ai.SYSTEM_PROMPT.indexOf('Trade examples'), ai.SYSTEM_PROMPT.indexOf('\n\nOUTPUT.'));
  const replies = [...ex.matchAll(/; (.*)$/gm)].flatMap(m => [...m[1].matchAll(/"([^"]+)"/g)].map(x => x[1]));
  assert.ok(replies.length >= 10, replies.join(' | '));
  for (const en of replies) assert.ok(en === en.toLowerCase() && !/\.$/.test(en) && !/^(wts|wtb)\b/.test(en), en);
});

test('validTrade: sides, numbers, per; unknown sides and junk dropped', () => {
  assert.deepEqual(ai.validTrade({ side: 'Sell', item: '[I1]', qty: 10, price: 25, per: 'each' }), { side: 'sell', item: '[I1]', qty: 10, price: 25, per: 'each' });
  assert.deepEqual(ai.validTrade({ side: 'buy', item: '', qty: null, price: '1.5', per: 'EACH' }), { side: 'buy', item: '', price: 1.5, per: 'each' });
  assert.deepEqual(ai.validTrade({ side: 'craft-request', qty: -1, price: 'lots', per: 'whenever' }), { side: 'craft-request', item: '' });
  assert.equal(ai.validTrade({ side: 'none' }), null);
  assert.equal(ai.validTrade({ side: 'steal' }), null);
  assert.equal(ai.validTrade(null), null);
  assert.equal(ai.validTrade('sell'), null);
  assert.equal(ai.validTrade([{ side: 'sell' }]), null);
  assert.equal(ai.validTrade({ side: 'sell', item: 'x'.repeat(80) }).item.length, 60);
});

test('validateItem: x keeps a valid trade field, omits a missing or invalid one; t/d never carry it', () => {
  const r = ai.validateItem({ ...base, trade: { side: 'sell', item: '[I1]', qty: 10, price: 25, per: 'each' } }, req(1, ''));
  assert.deepEqual(r.trade, { side: 'sell', item: '[I1]', qty: 10, price: 25, per: 'each' });
  assert.ok(!('trade' in ai.validateItem(base, req(1, ''))), 'no field -> no key (old results unchanged)');
  assert.ok(!('trade' in ai.validateItem({ ...base, trade: { side: 'none' } }, req(1, ''))));
  const t = ai.validateItem({ id: 2, replies: base.replies, trade: { side: 'sell' } }, req(2, '', 't'));
  assert.ok(!('trade' in t));
});

test('matchResults: link tokens in trade.item come back as the real name', () => {
  const r = ai.linkTokens(req(3, 'WTS [Arcanite Bar] x10 25g ea'));
  const reply = JSON.stringify([{ ...base, id: 3, trade: { side: 'sell', item: '[I1]', qty: 10, price: 25, per: 'each' } }]);
  const { done } = ai.matchResults(reply, [r]);
  assert.equal(done.get(3).trade.item, '[Arcanite Bar]');
});

test('slot file: a result with a trade field is valid Lua and round-trips', () => {
  const results = [{ id: 4, kind: 'x', status: 'done', tr: '他要賣', terms: [{ term: 'WTS', expansion: 'Want To Sell', tr: '出售' }], replies: [{ en: 'how much for 5?', tr: '5 個多少？', tone: 'casual' }],
    trade: { side: 'craft-request', item: '[Flask of the Titans]', price: 2.5, per: 'total' } }];
  const src = P.renderSlotFile({ now: 1790000000, session: 'Ab3xK9', results });
  const vm = createVM();
  vm.run(src);
  assert.deepEqual(vm.eval('WCH_SlotData').results, results);
});

test('addon: an explain result with a trade field still prints and opens the picker', () => {
  const vm = boot();
  vm.receiveChat('WHISPER', 'WTS [Arcanite Bar] x10 25g ea', 'Bob');
  vm.advance(0.6);
  const id = vm.decodeStrip().records.at(-1).id;
  ackStrip(vm);
  deliver(vm, id, [sample.x(id, { trade: { side: 'sell', item: '[Arcanite Bar]', qty: 10, price: 25, per: 'each' } })]);
  assert.ok(vm.chatText('ChatFrame1').some(t => t.includes('[譯]|r 徵 1 名坦克')), 'annotation printed');
  vm.clickLink(`wch:r:${id}`);
  assert.equal(vm.str('tostring(WCHPicker:IsShown())'), 'true');
});

test('trade eval set: at least 30 explain cases with expectations, translate cases with valid patterns', () => {
  const dir = path.join(__dirname, '..', 'data', 'eval');
  const read = (f) => JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
  const cases = read('trade.json');
  const hold = read('trade-holdout.json');
  assert.equal(hold.length, 12, 'new holdout: 12 explain lines');
  assert.equal(read('trade-translate-holdout.json').length, 6, 'new holdout: 6 /wtr lines');
  assert.ok(cases.length >= 30, `cases: ${cases.length}`);
  const SIDES = new Set(['sell', 'buy', 'trade', 'craft-request', 'craft-offer', 'none']);
  const ROLES = new Set(['buyer', 'seller', 'crafter', 'customer', 'trader', 'none']);
  for (const c of [...cases, ...hold]) {
    const id = JSON.stringify(c.text);
    for (const s of Array.isArray(c.side) ? c.side : [c.side]) assert.ok(SIDES.has(s), `${id} side ${s}`);
    assert.ok(ROLES.has(c.replyAs), `${id} replyAs`);
    assert.ok(c.price === null || (typeof c.price.gold === 'number' && ['each', 'stack', 'total'].includes(c.price.per)), `${id} price`);
    assert.ok(Array.isArray(c.mustInTr) && c.mustInTr.every(g => Array.isArray(g) && g.length), `${id} mustInTr`);
    assert.ok(Array.isArray(c.mustMention) && c.mustMention.length, `${id} mustMention`);
  }
  assert.ok(cases.filter(c => c.cat === 'dir-tricky').length >= 5, 'five direction traps');
  const tcases = [...read('trade-translate.json'), ...read('trade-translate-holdout.json')];
  assert.ok(tcases.length >= 8);
  for (const c of tcases) for (const r of [...c.must, ...c.mustNot]) assert.doesNotThrow(() => new RegExp(r, 'i'), r);
});

test('buildPrompt: in a whisper, ctx lines not from the sender are marked (player); other channels untouched', () => {
  const list = (r) => JSON.parse(ai.buildPrompt([r]).split('\n').pop());
  const w = list(req(1, 'sent cod 45g', 'x', { channel: 'WHISPER', sender: 'Mailer-Stormrage', ctx: 'Jacky: wtb [I1] x3\nMailer: have 3\nJacky-Area52: ok' }));
  assert.equal(w[0].ctx, 'Jacky (player): wtb [I1] x3\nMailer: have 3\nJacky-Area52 (player): ok');
  const bn = list(req(2, 'k', 'x', { channel: 'BN', sender: 'Pal', ctx: 'Me: hi' }));
  assert.equal(bn[0].ctx, 'Me (player): hi');
  const t = list(req(3, 'hello', 'x', { channel: 'CHANNEL:Trade - City', sender: 'A', ctx: 'B: wts x' }));
  assert.equal(t[0].ctx, 'B: wts x');
  assert.equal(list(req(4, 'x', 'x', { channel: 'WHISPER', sender: '', ctx: 'B: hi' }))[0].ctx, 'B: hi', 'no sender: unchanged');
});

test('addon: a whisper answering the player\'s own Trade ad gets that ad as ctx (marked as the player by the bridge)', () => {
  const xs = (vm) => { const f = vm.decodeStrip(); return f ? f.records.filter(r => r.kind === 'x') : []; };
  const vm = boot();
  vm.receiveChat('CHANNEL', 'WTS [Lionheart Helm] 300g pst', 'Other', { channel: 'Trade - City', channelIndex: 2 });
  vm.receiveChat('CHANNEL', 'WTS [Black Lotus] x2 90g ea', 'Testchar', { channel: 'Trade - City', channelIndex: 2 });
  vm.advance(30);
  vm.receiveChat('WHISPER', '80g?', 'Bob');
  vm.advance(0.6);
  const r = xs(vm).at(-1);
  assert.equal(r.text, '80g?');
  assert.equal(r.ctx, 'Testchar: WTS [Black Lotus] x2 90g ea', 'only the player\'s own line, one line');
  const sent = JSON.parse(ai.buildPrompt([{ ...r, id: 1 }]).split('\n').pop());
  assert.equal(sent[0].ctx, 'Testchar (player): WTS [Black Lotus] x2 90g ea');
  ackStrip(vm);
  // The conversation goes on: still at most 4 ctx lines, the ad first and not repeated.
  for (const t of ['have 1', 'ok sec', 'trading now']) { vm.receiveChat('WHISPER', t, 'Bob'); vm.advance(0.6); ackStrip(vm); }
  vm.receiveChat('WHISPER', 'ty', 'Bob');
  const line = vm.str('WCH.Chat.run.lines[WCH.Chat.run.order[#WCH.Chat.run.order]].ctx');
  assert.deepEqual(line.split('\n'), ['Testchar: WTS [Black Lotus] x2 90g ea', 'Bob: have 1', 'Bob: ok sec', 'Bob: trading now']);
});

test('addon: the own public line is dropped after 10 minutes; /say counts; party lines and others\' ads do not', () => {
  const ctxOf = (vm) => vm.str('WCH.Chat.run.lines[WCH.Chat.run.order[#WCH.Chat.run.order]].ctx');
  const vm = boot();
  vm.receiveChat('SAY', 'selling 5 linen 1s ea', 'Testchar');
  vm.receiveChat('WHISPER', 'all 5?', 'Ann');
  assert.equal(ctxOf(vm), 'Testchar: selling 5 linen 1s ea');
  vm.receiveChat('PARTY', 'wts nothing here', 'Testchar');
  vm.receiveChat('WHISPER', 'still?', 'Cid');
  assert.equal(ctxOf(vm), 'Testchar: selling 5 linen 1s ea', 'party lines are not ads');
  vm.advance(601);
  vm.receiveChat('WHISPER', 'hello?', 'Dee');
  assert.equal(ctxOf(vm), '', 'stale after 10 minutes');
  vm.receiveChat('CHANNEL', 'WTB [Arcanite Bar]', 'Other', { channel: 'Trade - City', channelIndex: 2 });
  vm.receiveChat('WHISPER', 'hi', 'Eve');
  assert.equal(ctxOf(vm), '', 'someone else\'s ad is not the player\'s');
});
