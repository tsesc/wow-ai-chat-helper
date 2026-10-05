// Cross-language: the addon's real Codec.lua (in the Lua harness, sandboxed, checked as
// Lua 5.1) encodes; bridge/protocol.js decodes.
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createVM } = require('./helpers/lua');
const P = require('../bridge/protocol');

const vm = createVM({ files: ['addon/WoWChatHelper/Codec.lua'] });

function luaEncode(id, payload) {
  const s = vm.str(`(function(id, p)
    local cells = WCH_Codec.Encode(id, p)
    local t = {}
    for i = 1, #cells do t[i] = string.format("%d", cells[i]) end
    return table.concat(t, ",")
  end)(${id}, ${P.luaString(payload)})`);
  return s.split(',').map(Number);
}

const rec = (o) => ({ session: 'Ab3xK9', id: 1, kind: 'x', channel: 'WHISPER', sender: 'Bob', model: '', ctx: '', text: '', ...o });

test('magic is 0xC7 0x2B and the codec is exposed on the addon namespace', () => {
  assert.equal(vm.num('WCH_Codec.MAGIC1'), 0xC7);
  assert.equal(vm.num('WCH_Codec.MAGIC2'), 0x2B);
  assert.equal(vm.str('STUB.AddonNamespace("WoWChatHelper").Codec == WCH_Codec'), 'true');
  const cells = luaEncode(1, 'x');
  assert.deepEqual(cells.slice(0, 5), [6, 1, 6, 2, 5], '0xC72B = 110 001 110 010 101 1.. packed MSB-first');
});

test('Lua output equals the JS mirror encoder cell for cell', () => {
  for (const [id, payload] of [[1, ''], [7, 'hello'], [65535, 'z'.repeat(301)], [70000, 'wrap id']]) {
    assert.deepEqual(luaEncode(id, payload), P.encodeFrame(id, payload), `id ${id}`);
  }
});

const cases = [
  ['ASCII single record', 12, P.encodeRecords([rec({ id: 12, text: 'LF1M tank HC DM, inv' })])],
  ['Traditional Chinese translate record', 13, P.encodeRecords([rec({ id: 13, kind: 't', channel: 'PARTY', sender: '', text: '我五分鐘後到，等我一下 🙏' })])],
  ['hello with settings', 1, P.encodeRecords([rec({ id: 1, kind: 'h', channel: '', sender: '', text: 'v=1;corner=TOPLEFT;auto=WHISPER,PARTY' })])],
  ['multi-record with ctx, quotes, backslashes, newlines', 44, P.encodeRecords([
    rec({ id: 42, ctx: 'Bob: hi\nTestchar: 嗨', text: 'can u "port" me? C:\\x' }),
    rec({ id: 43, kind: 'd', channel: 'CHANNEL:Trade - City', sender: 'Älvä-Stormrage', model: 'sonnet', text: 'WTS [Arcanite Bar] 50g' }),
    rec({ id: 44, kind: 't', channel: 'GUILD', text: '謝謝大家，晚安' }),
  ])],
];

for (const [name, id, payload] of cases) {
  test(`round trip: ${name}`, () => {
    const cells = luaEncode(id, payload);
    assert.ok(cells.length <= P.CAPACITY_CELLS);
    const f = P.decodeFrame(cells);
    assert.ok(f && !f.error, JSON.stringify(f));
    assert.equal(f.id, id);
    assert.equal(f.text, payload);
    assert.deepEqual(f.payload, Buffer.from(payload, 'utf8'));
    const back = P.parseRecords(f.payload);
    assert.equal(P.encodeRecords(back), payload, 'records survive the frame');
  });
}

test('decodes inside a full-size strip with trailing junk cells', () => {
  const payload = P.encodeRecords([rec({ id: 5, text: '中文 '.repeat(200) })]);
  const cells = luaEncode(5, payload);
  const strip = cells.concat(Array.from({ length: P.CAPACITY_CELLS - cells.length }, (_, i) => (i * 5) % 8));
  const f = P.decodeFrame(strip);
  assert.equal(f.text, payload);
});

test('a near-capacity frame (3000-byte batch) round-trips', () => {
  const payload = P.encodeRecords([rec({ id: 9, text: '' })]);
  const room = P.BATCH_BYTES - Buffer.byteLength(payload);
  const big = payload + 'é'.repeat(Math.floor(room / 2)) + 'a'.repeat(room % 2);
  assert.equal(Buffer.byteLength(big), P.BATCH_BYTES);
  const f = P.decodeFrame(luaEncode(9, big));
  assert.equal(f.text, big);
});

test('decoder rejects wow-ai magic, corrupted cells and truncation', () => {
  const cells = luaEncode(3, 'hello');
  // A valid wow-ai frame (magic 0xC7 0x1A) is not ours: no strip.
  const body = [...Buffer.from('hello')];
  const bytes = [0xC7, 0x1A, 0, 3, 0, body.length, ...body];
  bytes.push(...P.fletcher16(bytes, 2, bytes.length));
  const bits = bytes.flatMap(b => [...b.toString(2).padStart(8, '0')].map(Number));
  while (bits.length % 3) bits.push(0);
  const foreign = [];
  for (let i = 0; i < bits.length; i += 3) foreign.push(bits[i] * 4 + bits[i + 1] * 2 + bits[i + 2]);
  assert.equal(P.decodeFrame(foreign), null);
  const bad = cells.slice(); bad[30] ^= 1;
  assert.deepEqual(P.decodeFrame(bad), { error: 'checksum' });
  assert.deepEqual(P.decodeFrame(cells.slice(0, cells.length - 6)), { error: 'truncated' });
  assert.equal(P.decodeFrame([]), null);
});

test('CellColor maps bits to pure primaries', () => {
  assert.equal(vm.str('table.concat({WCH_Codec.CellColor(5)}, ",")'), '1,0,1');
  assert.equal(vm.str('table.concat({WCH_Codec.CellColor(6)}, ",")'), '1,1,0');
});
