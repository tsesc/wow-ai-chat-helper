// bridge/protocol.js: strip records, Lua serialization for slot files, slot math.
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const luaparse = require('luaparse');
const { createVM } = require('./helpers/lua');
const P = require('../bridge/protocol');

const vm = createVM({ files: [] });

// --- records (3.1) ---------------------------------------------------------

const sample = [
  { session: 'Ab3xK9', id: 1, kind: 'h', channel: '', sender: '', model: '', ctx: '', text: 'v=1;corner=TOPLEFT' },
  { session: 'Ab3xK9', id: 12, kind: 'x', channel: 'WHISPER', sender: 'Bob-Stormrage', model: '', ctx: 'Bob-Stormrage: hey\nTestchar: 嗨', text: 'LF1M tank HC DM, inv' },
  { session: 'Ab3xK9', id: 13, kind: 't', channel: 'PARTY', sender: '', model: 'haiku', ctx: '', text: '我五分鐘後到 😀' },
  { session: 'Ab3xK9', id: 14, kind: 'd', channel: 'CHANNEL:Trade - City', sender: 'Zoë', model: 'sonnet', ctx: '', text: 'WTS [Arcanite Bar] PST' },
];

test('records round-trip, including UTF-8 Chinese and empty fields', () => {
  const payload = P.encodeRecords(sample);
  assert.equal(payload.split(P.RS).length, 4);
  assert.deepEqual(P.parseRecords(payload), sample);
  assert.deepEqual(P.parseRecords(Buffer.from(payload, 'utf8')), sample, 'Buffer input');
});

test('field order is session id kind channel sender model ctx text', () => {
  const s = P.encodeRecords([sample[1]]);
  assert.equal(s, ['Ab3xK9', '12', 'x', 'WHISPER', 'Bob-Stormrage', '', 'Bob-Stormrage: hey\nTestchar: 嗨', 'LF1M tank HC DM, inv'].join('\x1F'));
});

test('separators inside fields are replaced, so records never split', () => {
  const r = { ...sample[1], sender: 'a\x1Fb', ctx: 'x\x1Ey', text: 'one\x1Etwo\x1Fthree' };
  const back = P.parseRecords(P.encodeRecords([r]));
  assert.equal(back.length, 1);
  assert.equal(back[0].text, 'one two three');
  assert.equal(back[0].sender, 'a b');
  assert.equal(back[0].ctx, 'x y');
});

test('malformed records are dropped; extra unit separators stay in text', () => {
  const good = P.encodeRecords([sample[1]]);
  const junk = ['', 'a\x1Fb', 's\x1F0\x1Fx\x1F\x1F\x1F\x1F\x1Ft', 's\x1F-1\x1Fx\x1F\x1F\x1F\x1F\x1Ft', 's\x1F2\x1Fq\x1F\x1F\x1F\x1F\x1Ft', 's\x1F01\x1Fx\x1F\x1F\x1F\x1F\x1Ft'];
  assert.deepEqual(P.parseRecords([...junk, good].join(P.RS)), [sample[1]]);
  const foreign = 's\x1F5\x1Fx\x1FSAY\x1FBob\x1F\x1F\x1Fa\x1Fb';
  assert.equal(P.parseRecords(foreign)[0].text, 'a\x1Fb');
  assert.deepEqual(P.parseRecords(''), []);
});

test('hello settings parse', () => {
  assert.deepEqual(P.parseSettings('v=1;corner=TOPRIGHT;auto=WHISPER,PARTY;;flag;=x'), { v: '1', corner: 'TOPRIGHT', auto: 'WHISPER,PARTY', flag: '' });
});

test('encodeFrame/decodeFrame round-trip a batched payload', () => {
  const payload = P.encodeRecords(sample);
  const f = P.decodeFrame(P.encodeFrame(14, payload));
  assert.equal(f.id, 14);
  assert.deepEqual(P.parseRecords(f.payload), sample);
  assert.throws(() => P.encodeFrame(1, 'x'.repeat(P.MAX_PAYLOAD + 1)));
});

// --- Lua serialization (3.3) ----------------------------------------------

// Read back a Lua string literal as raw bytes (hex) in the VM.
function luaBytesHex(literal) {
  return vm.str(`(function(s) local t = {} for i = 1, #s do t[i] = string.format("%02x", s:byte(i)) end return table.concat(t) end)(${literal})`);
}

test('luaString escapes quotes, backslashes, newlines and control chars', () => {
  assert.equal(P.luaString('a"b\\c\nd\re\0f\x7f'), '"a\\"b\\\\c\\nd\\re\\000f\\127"');
  assert.equal(P.luaString('\x01' + '2'), '"\\0012"', 'three digits so a following digit is not swallowed');
  assert.equal(P.luaString('中文'), '"中文"', 'UTF-8 passes through');
  assert.equal(P.luaString(null), '""');
  assert.ok(!/[\n\r]/.test(P.luaString('x\ny\r')), 'one line');
});

function randomString(rnd) {
  const pools = [
    () => String.fromCharCode(Math.floor(rnd() * 0x20)),            // control chars
    () => '"\\\'\n\r\t[]]=%'[Math.floor(rnd() * 12)],                 // Lua-significant
    () => String(Math.floor(rnd() * 10)),                            // digits after escapes
    () => String.fromCharCode(0x20 + Math.floor(rnd() * 0x5F)),      // printable ASCII
    () => String.fromCodePoint(0x4E00 + Math.floor(rnd() * 0x5000)), // CJK
    () => String.fromCodePoint(0x80 + Math.floor(rnd() * 0x780)),    // 2-byte UTF-8
    () => String.fromCodePoint(0x1F300 + Math.floor(rnd() * 0x300)), // emoji (4-byte)
    () => '\x7F',
    () => '\uD800',                                                   // lone surrogate
  ];
  let s = '';
  const n = Math.floor(rnd() * 40);
  for (let i = 0; i < n; i++) s += pools[Math.floor(rnd() * pools.length)]();
  return s;
}

function mulberry32(a) {
  return () => { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

test('fuzz: luaString of random UTF-8 reads back byte-exact in Lua and parses as Lua 5.1', () => {
  const rnd = mulberry32(20261005);
  for (let i = 0; i < 400; i++) {
    const s = randomString(rnd);
    const lit = P.luaString(s);
    const expected = Buffer.from(s.toWellFormed(), 'utf8').toString('hex');
    assert.equal(luaBytesHex(lit), expected, `case ${i}: ${JSON.stringify(s)}`);
    luaparse.parse(`x = ${lit}`, { luaVersion: '5.1' });
  }
});

test('luaSerialize: scalars, sequences, records, keyword and odd keys, nil fields', () => {
  assert.equal(P.luaSerialize(null), 'nil');
  assert.equal(P.luaSerialize(true), 'true');
  assert.equal(P.luaSerialize(12), '12');
  assert.equal(P.luaSerialize(1.5), '1.5');
  assert.equal(P.luaSerialize(NaN), '0');
  assert.equal(P.luaSerialize([]), '{}');
  assert.equal(P.luaSerialize([1, 'a']), '{ 1, "a" }');
  assert.equal(P.luaSerialize({ a: 1, end: 2, 'x-y': 3, 7: 'n', skip: null, u: undefined }), '{ [7] = "n", a = 1, ["end"] = 2, ["x-y"] = 3 }');
  const v = { s: 'q"\n中', list: [{ t: 'LF1M', zh: '還缺一人' }], deep: { ok: false } };
  assert.deepEqual(vm.eval(P.luaSerialize(v)), v);
  assert.deepEqual(vm.eval(P.luaSerialize(v, '  ')), v, 'pretty form evaluates the same');
});

test('renderSlotFile matches spec 3.3 and loads as WCH_SlotData', () => {
  const results = [
    { id: 12, kind: 'x', status: 'done', zh: '徵 1 名坦克打英雄難度死亡礦坑，有意者密我邀請',
      terms: [{ term: 'LF1M', expansion: 'Looking For 1 More', zh: '還缺一人' }],
      replies: [{ en: 'inv pls, tank here', zh: '請邀我，我是坦', tone: 'casual' }, { en: 'Hi! I can tank, could I get an "invite"?', zh: '嗨\n可以嗎', tone: 'polite' }] },
    { id: 13, kind: 't', status: 'working' },
    { id: 14, kind: 'd', status: 'error', err: 'timeout' },
  ];
  const src = P.renderSlotFile({ now: 1790000000, session: 'Ab3xK9', results });
  assert.match(src, /^-- Written by the wow-ai-chat-helper bridge/);
  assert.match(src, /\nWCH_SlotData = \{\n  v = 1,\n  now = 1790000000,\n  session = "Ab3xK9",\n  results = \{/);
  luaparse.parse(src, { luaVersion: '5.1' });
  vm.run(src);
  assert.deepEqual(vm.eval('WCH_SlotData'), { v: 1, now: 1790000000, session: 'Ab3xK9', results });
});

test('renderSlotFile keeps only the most recent 100 results', () => {
  const results = Array.from({ length: 130 }, (_, i) => ({ id: i + 1, kind: 'x', status: 'working' }));
  vm.run(P.renderSlotFile({ now: 1, session: 's', results }));
  assert.equal(vm.num('#WCH_SlotData.results'), 100);
  assert.equal(vm.num('WCH_SlotData.results[1].id'), 31);
  assert.equal(vm.num('WCH_SlotData.results[100].id'), 130);
});

// --- slot and signal numbering (3.4, 3.5) ----------------------------------

test('slotNumber = ((id-1) % 200) + 1', () => {
  assert.deepEqual([1, 2, 199, 200, 201, 400, 401, 65535].map(P.slotNumber), [1, 2, 199, 200, 1, 200, 1, 135]);
  for (let id = 1; id <= 1000; id++) {
    const n = P.slotNumber(id);
    assert.ok(n >= 1 && n <= 200);
    assert.equal(n, ((id - 1) % 200) + 1);
  }
  assert.equal(P.slotAddonName(P.slotNumber(201)), 'WoWChatHelper_S001');
});

test('signal paths', () => {
  assert.equal(P.signalPath('ready', 12), 'sig/ready/012.wav');
  assert.equal(P.signalPath('ack', 201), 'sig/ack/001.wav');
  assert.equal(P.signalPath('presence', 7), 'sig/presence/0007.wav');
  assert.equal(P.signalPath('ctl', 'valid'), 'sig/ctl/valid.wav');
  assert.throws(() => P.signalPath('bogus', 1));
});
