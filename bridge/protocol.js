// Adapted from wow-ai (MIT) by chelinho139: bridge/protocol.js (luaStr, slotNumber)
// and bridge/capture.ps1 / capture_x11.py (the frame decoder).
//
// Pure functions shared by the bridge, setup and tests. No I/O, no dependencies.
// Interfaces: docs/superpowers/specs/2026-10-05-wow-ai-chat-helper-design.md, section 3.
'use strict';

// ---------------------------------------------------------------------------
// 3.1 Pixel strip frame (game -> bridge)
// ---------------------------------------------------------------------------

const MAGIC1 = 0xC7, MAGIC2 = 0x2B;
const BITS = 3;
const CELL = 4, CELLS_PER_ROW = 200, MAX_ROWS = 48;
const CAPACITY_CELLS = CELLS_PER_ROW * MAX_ROWS;
const CAPACITY_BYTES = Math.floor(CAPACITY_CELLS * BITS / 8);
const MAX_PAYLOAD = 3200;   // Codec.lua hard limit
const BATCH_BYTES = 3000;   // the addon batches records into one frame up to this size

const RS = '\x1E', US = '\x1F';
const FIELDS = ['session', 'id', 'kind', 'channel', 'sender', 'model', 'ctx', 'text'];
const KINDS = new Set(['h', 'x', 't', 'd']);

function fletcher16(bytes, from, to) {
  let s1 = 0, s2 = 0;
  for (let k = from; k < to; k++) { s1 = (s1 + bytes[k]) % 255; s2 = (s2 + s1) % 255; }
  return [s1, s2];
}

// Cell values (0..7, one per cell, in strip order) -> frame.
// Returns null when the first bytes are not the magic (no strip there),
// { error: 'length' | 'truncated' | 'checksum' } for a strip that does not validate,
// or { id, payload: Buffer, text } (text = payload decoded as UTF-8).
// Same algorithm as wow-ai's capture.ps1 Decode; missing cells read as 0.
function decodeFrame(cells, capacityCells = CAPACITY_CELLS) {
  const total = Math.min(cells.length, capacityCells);
  const bytes = [];
  let acc = 0, nbits = 0, needed = 6;
  outer:
  for (let i = 0; i < total; i++) {
    acc = (acc << BITS) | ((cells[i] | 0) & 7);
    nbits += BITS;
    while (nbits >= 8) {
      bytes.push((acc >> (nbits - 8)) & 0xFF);
      nbits -= 8;
      acc &= (1 << nbits) - 1;
      if (bytes.length === 2 && (bytes[0] !== MAGIC1 || bytes[1] !== MAGIC2)) return null;
      if (bytes.length === 6) {
        const len = bytes[4] * 256 + bytes[5];
        needed = 8 + len;
        if (needed > Math.floor(capacityCells * BITS / 8)) return { error: 'length' };
      }
      if (bytes.length >= needed) break outer;
    }
  }
  if (bytes.length < 2) return null;
  if (bytes.length < needed) return { error: 'truncated' };
  const len = bytes[4] * 256 + bytes[5];
  const [s1, s2] = fletcher16(bytes, 2, 6 + len);
  if (bytes[6 + len] !== s1 || bytes[7 + len] !== s2) return { error: 'checksum' };
  const payload = Buffer.from(bytes.slice(6, 6 + len));
  return { id: bytes[2] * 256 + bytes[3], payload, text: payload.toString('utf8') };
}

// The JS mirror of Codec.lua's Encode, for tests and tools: (id, payload string|Buffer) -> cells.
function encodeFrame(id, payload) {
  const body = Buffer.isBuffer(payload) ? payload : Buffer.from(String(payload), 'utf8');
  if (body.length > MAX_PAYLOAD) throw new Error(`payload too long: ${body.length} > ${MAX_PAYLOAD}`);
  id = ((id % 65536) + 65536) % 65536;
  const bytes = [MAGIC1, MAGIC2, id >> 8, id & 0xFF, body.length >> 8, body.length & 0xFF, ...body];
  bytes.push(...fletcher16(bytes, 2, bytes.length));
  const cells = [];
  let acc = 0, nbits = 0;
  for (const b of bytes) {
    acc = (acc << 8) | b; nbits += 8;
    while (nbits >= BITS) { nbits -= BITS; cells.push((acc >> nbits) & 7); acc &= (1 << nbits) - 1; }
  }
  if (nbits > 0) cells.push((acc << (BITS - nbits)) & 7);
  return cells;
}

// ---------------------------------------------------------------------------
// 3.1 Records: session US id US kind US channel US sender US model US ctx US text,
// records separated by RS.
// ---------------------------------------------------------------------------

// Record separators can't appear inside a field; the addon replaces them too.
function cleanField(v) { return String(v ?? '').replace(/[\x1E\x1F]/g, ' '); }

// Array of record objects -> payload string (UTF-8 safe: JS strings throughout;
// Buffer.byteLength(result) is the wire size).
function encodeRecords(records) {
  return records.map(r => FIELDS.map(f => cleanField(r[f])).join(US)).join(RS);
}

// Payload (string or Buffer) -> array of records
// { session, id (number), kind, channel, sender, model, ctx, text }.
// Records that are malformed (fewer than 8 fields, id not a positive integer, unknown
// kind) are dropped. A unit separator inside `text` (only from a foreign encoder) is kept
// in the text, as wow-ai does.
function parseRecords(payload) {
  const s = Buffer.isBuffer(payload) ? payload.toString('utf8') : String(payload ?? '');
  const out = [];
  if (s === '') return out;
  for (const raw of s.split(RS)) {
    const p = raw.split(US);
    if (p.length < 8) continue;
    if (!/^[1-9]\d*$/.test(p[1])) continue;
    if (!KINDS.has(p[2])) continue;
    out.push({
      session: p[0], id: Number(p[1]), kind: p[2], channel: p[3], sender: p[4],
      model: p[5], ctx: p[6], text: p.slice(7).join(US),
    });
  }
  return out;
}

// A hello's settings text "k=v;k=v" -> { k: v }. Empty keys are ignored.
function parseSettings(text) {
  const out = {};
  for (const part of String(text ?? '').split(';')) {
    if (!part) continue;
    const eq = part.indexOf('=');
    const k = (eq < 0 ? part : part.slice(0, eq)).trim();
    if (k) out[k] = eq < 0 ? '' : part.slice(eq + 1);
  }
  return out;
}

// ---------------------------------------------------------------------------
// 3.3 Slot data (bridge -> game)
// ---------------------------------------------------------------------------

const SLOT_COUNT = 200;
const MAX_RESULTS = 100;
const SLOT_GLOBAL = 'WCH_SlotData';

function slotNumber(id) { return ((id - 1) % SLOT_COUNT) + 1; }
function pad3(n) { return String(n).padStart(3, '0'); }
function slotAddonName(n) { return 'WoWChatHelper_S' + pad3(n); }

// Signal file path relative to the WoWChatHelper addon folder (3.4), forward slashes.
//   kind 'ready' | 'ack': n is a request id, mapped through slotNumber -> sig/ready/NNN.wav
//   kind 'presence': n is the beat counter -> sig/presence/kkkk.wav
//   kind 'ctl': n is 'empty' | 'valid'
function signalPath(kind, n) {
  if (kind === 'ready' || kind === 'ack') return `sig/${kind}/${pad3(slotNumber(n))}.wav`;
  if (kind === 'presence') return `sig/presence/${String(n).padStart(4, '0')}.wav`;
  if (kind === 'ctl') return `sig/ctl/${n}.wav`;
  throw new Error('unknown signal kind: ' + kind);
}

// A double-quoted Lua 5.1 string literal for any JS string; what string.format("%q")
// guarantees, but on one line: backslash, quote, CR, LF and every other control byte
// are escaped (\n, \r, \ddd with 3 digits so a following digit can't extend it); bytes
// >= 0x80 (UTF-8) pass through unchanged. Lone surrogates become U+FFFD, as UTF-8 would.
function luaString(s) {
  let out = '"';
  for (const ch of String(s ?? '').toWellFormed()) {
    const c = ch.codePointAt(0);
    if (ch === '\\') out += '\\\\';
    else if (ch === '"') out += '\\"';
    else if (ch === '\n') out += '\\n';
    else if (ch === '\r') out += '\\r';
    else if (c < 0x20 || c === 0x7F) out += '\\' + String(c).padStart(3, '0');
    else out += ch;
  }
  return out + '"';
}

const LUA_KEYWORDS = new Set(('and break do else elseif end false for function if in local nil not ' +
  'or repeat return then true until while goto').split(' '));

function luaKey(k) {
  return /^[A-Za-z_][A-Za-z0-9_]*$/.test(k) && !LUA_KEYWORDS.has(k) ? k : '[' + luaString(k) + ']';
}

function luaNumber(n) {
  if (!Number.isFinite(n)) return '0';
  if (Number.isInteger(n)) return String(n);
  return String(n); // JS shortest round-trip form is valid Lua (e.g. 1.5, 1e-7)
}

// JS value -> Lua expression. null/undefined -> nil (omitted as table fields); arrays ->
// sequences; plain objects -> records with keys in insertion order. `indent` (a string)
// pretty-prints nested tables one entry per line.
function luaSerialize(v, indent = '', level = 0) {
  if (v === null || v === undefined) return 'nil';
  if (typeof v === 'boolean') return v ? 'true' : 'false';
  if (typeof v === 'number') return luaNumber(v);
  if (typeof v === 'bigint') return String(v);
  if (typeof v === 'string') return luaString(v);
  if (typeof v !== 'object') throw new TypeError('luaSerialize: unsupported ' + typeof v);
  const parts = [];
  if (Array.isArray(v)) {
    for (const item of v) parts.push(luaSerialize(item, indent, level + 1));
  } else {
    for (const [k, item] of Object.entries(v)) {
      if (item === undefined || item === null) continue;
      const key = /^[1-9]\d*$/.test(k) ? '[' + k + ']' : luaKey(k);
      parts.push(key + ' = ' + luaSerialize(item, indent, level + 1));
    }
  }
  if (parts.length === 0) return '{}';
  if (!indent) return '{ ' + parts.join(', ') + ' }';
  const pad = indent.repeat(level + 1), close = indent.repeat(level);
  return '{\n' + parts.map(p => pad + p + ',').join('\n') + '\n' + close + '}';
}

// The slot file / Inbox.lua body for spec 3.3. `data` = { now, session, results, ... };
// `v` defaults to 1, only the last MAX_RESULTS results are kept.
function renderSlotFile(data) {
  const { v = 1, now = Math.floor(Date.now() / 1000), session = '', results = [], ...rest } = data || {};
  const body = { v, now, session, results: results.slice(-MAX_RESULTS), ...rest };
  return '-- Written by the wow-ai-chat-helper bridge. Do not edit by hand.\n' +
    SLOT_GLOBAL + ' = ' + luaSerialize(body, '  ') + '\n';
}

module.exports = {
  MAGIC1, MAGIC2, BITS, CELL, CELLS_PER_ROW, MAX_ROWS, CAPACITY_CELLS, CAPACITY_BYTES,
  MAX_PAYLOAD, BATCH_BYTES, RS, US, FIELDS, KINDS, SLOT_COUNT, MAX_RESULTS, SLOT_GLOBAL,
  fletcher16, decodeFrame, encodeFrame,
  cleanField, encodeRecords, parseRecords, parseSettings,
  slotNumber, pad3, slotAddonName, signalPath,
  luaString, luaSerialize, renderSlotFile,
};
