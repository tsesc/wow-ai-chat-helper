'use strict';
// Tests for addon/WoWChatHelper/Glossary.lua and Fonts/WCH-CJK.ttf (glossary + font track).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const luaparse = require('luaparse');
const { createVM } = require('./helpers/lua');

const ADDON = path.join(__dirname, '..', 'addon', 'WoWChatHelper');
const GLOSSARY = path.join(ADDON, 'Glossary.lua');
const FONT = path.join(ADDON, 'Fonts', 'WCH-CJK.ttf');
const CATS = new Set(['lfg', 'raid', 'loot', 'role', 'class', 'combat', 'trade', 'social', 'zone', 'misc']);

function load() {
  const vm = createVM({ files: [GLOSSARY], addonName: 'WoWChatHelper' });
  return vm.eval('WCH_Glossary');
}
const G = load();
const chars = (s) => Array.from(s);

test('Glossary.lua is valid Lua 5.1 and loads in fengari', () => {
  luaparse.parse(fs.readFileSync(GLOSSARY, 'utf8'), { luaVersion: '5.1' });
  assert.equal(typeof G, 'object');
  assert.ok(Array.isArray(G.terms));
  assert.equal(typeof G.phrases, 'object');
});

test('terms: count and schema', () => {
  assert.ok(G.terms.length >= 300, `terms: ${G.terms.length}`);
  for (const t of G.terms) {
    for (const k of ['term', 'expansion', 'zh', 'cat']) {
      assert.equal(typeof t[k], 'string', `${JSON.stringify(t)} missing ${k}`);
      assert.ok(t[k].length > 0, `${JSON.stringify(t)} empty ${k}`);
    }
    assert.ok(CATS.has(t.cat), `bad cat in ${JSON.stringify(t)}`);
    assert.ok(chars(t.zh).length <= 20, `zh too long: ${t.term} ${t.zh}`);
    assert.deepEqual(Object.keys(t).sort(), ['cat', 'expansion', 'term', 'zh']);
  }
});

test('terms: no case-insensitive duplicates, every category used', () => {
  const seen = new Map();
  for (const t of G.terms) {
    const k = t.term.toLowerCase();
    assert.ok(!seen.has(k), `duplicate term: ${t.term}`);
    seen.set(k, t);
  }
  const used = new Set(G.terms.map((t) => t.cat));
  for (const c of CATS) assert.ok(used.has(c), `category unused: ${c}`);
  for (const must of ['LFM', 'LF1M', 'HC', 'inv', 'ninja', 'OOM', 'CC', 'sheep', 'MT', 'OT', 'DPS',
    'aggro', 'pull', 'wipe', 'rez', 'buff', 'summ', 'port', 'AH', 'WTS', 'WTB', 'WTT', 'CoD', 'mats',
    'BoE', 'BoP', 'SR', 'MS', 'OS', 'need', 'greed', 'pug', 'afk', 'brb', 'omw', 'ty', 'np', 'gg',
    'gz', 'grats', 'lol', 'kek', 'ofc', 'idk', 'DM', 'SM', 'BRD', 'UBRS', 'MC', 'Onyxia', 'ZG', 'BWL']) {
    assert.ok(seen.has(must.toLowerCase()), `missing required term: ${must}`);
  }
  assert.equal(seen.get('lfm').zh, '徵人');
  assert.equal(seen.get('lfm').expansion, 'Looking For More');
});

test('phrases: count, normalized keys, schema', () => {
  const keys = Object.keys(G.phrases);
  assert.ok(keys.length >= 80, `phrases: ${keys.length}`);
  for (const k of keys) {
    assert.equal(k, k.toLowerCase(), `not lowercase: ${k}`);
    assert.equal(k, k.trim(), `not trimmed: ${k}`);
    assert.ok(!/\s{2,}/.test(k), `multiple spaces: ${k}`);
    assert.ok(!/[.!,;:]+$/.test(k), `trailing punctuation: ${k}`);
    assert.ok(k.length > 0);
    const p = G.phrases[k];
    assert.equal(typeof p.zh, 'string', k);
    assert.ok(p.zh.length > 0 && chars(p.zh).length <= 20, `phrase zh: ${k}`);
    // an empty Lua table comes back as {}; accept both it and an array
    const terms = Array.isArray(p.terms) ? p.terms : [];
    if (!Array.isArray(p.terms)) assert.deepEqual(p.terms, {}, `terms of ${k}`);
    for (const t of terms) {
      for (const f of ['term', 'expansion', 'zh']) assert.equal(typeof t[f], 'string', `${k}.${f}`);
      assert.ok(chars(t.zh).length <= 20, `${k} term zh too long`);
    }
  }
  for (const must of ['ty', 'ty all', 'gg', 'omw', 'inv pls', 'inv', 'brb', 'lf tank', 'ready?', 'rdy', 'grats', 'np']) {
    assert.ok(G.phrases[must], `missing phrase: ${must}`);
  }
});

test('phrases: no duplicate keys in the Lua source (a table constructor would silently override)', () => {
  const ast = luaparse.parse(fs.readFileSync(GLOSSARY, 'utf8'), { luaVersion: '5.1' });
  const ctor = ast.body[0].init[0];
  const phrasesField = ctor.fields.find((f) => f.key && f.key.name === 'phrases');
  const keys = phrasesField.value.fields.map((f) => f.key.value || f.key.raw.slice(1, -1));
  assert.equal(new Set(keys).size, keys.length, 'duplicate phrase keys');
  assert.equal(keys.length, Object.keys(G.phrases).length);
  const termsField = ctor.fields.find((f) => f.key && f.key.name === 'terms');
  assert.equal(termsField.value.fields.length, G.terms.length);
});

// ---- TrueType cmap parsing (no dependencies) ----
function readCmap(buf) {
  const numTables = buf.readUInt16BE(4);
  let cmapOff = -1;
  for (let i = 0; i < numTables; i++) {
    const o = 12 + i * 16;
    if (buf.toString('latin1', o, o + 4) === 'cmap') cmapOff = buf.readUInt32BE(o + 8);
  }
  assert.ok(cmapOff >= 0, 'no cmap table');
  const n = buf.readUInt16BE(cmapOff + 2);
  let best = null;
  for (let i = 0; i < n; i++) {
    const rec = cmapOff + 4 + i * 8;
    const plat = buf.readUInt16BE(rec), enc = buf.readUInt16BE(rec + 2), off = cmapOff + buf.readUInt32BE(rec + 4);
    const fmt = buf.readUInt16BE(off);
    if ((fmt === 12 && plat === 3 && enc === 10) || (fmt === 4 && plat === 3 && enc === 1 && !best)) best = { off, fmt };
  }
  assert.ok(best, 'no usable unicode cmap');
  const set = new Set();
  const { off } = best;
  if (best.fmt === 12) {
    const groups = buf.readUInt32BE(off + 12);
    for (let g = 0; g < groups; g++) {
      const p = off + 16 + g * 12;
      const s = buf.readUInt32BE(p), e = buf.readUInt32BE(p + 4), gid = buf.readUInt32BE(p + 8);
      for (let c = s; c <= e; c++) if (gid + (c - s) !== 0) set.add(c);
    }
  } else {
    const segX2 = buf.readUInt16BE(off + 6);
    const endO = off + 14, startO = endO + segX2 + 2, deltaO = startO + segX2, rangeO = deltaO + segX2;
    for (let s = 0; s < segX2; s += 2) {
      const end = buf.readUInt16BE(endO + s), start = buf.readUInt16BE(startO + s);
      const delta = buf.readInt16BE(deltaO + s), ro = buf.readUInt16BE(rangeO + s);
      for (let c = start; c <= end && c !== 0xFFFF; c++) {
        let gid;
        if (ro === 0) gid = (c + delta) & 0xFFFF;
        else {
          gid = buf.readUInt16BE(rangeO + s + ro + (c - start) * 2);
          if (gid !== 0) gid = (gid + delta) & 0xFFFF;
        }
        if (gid !== 0) set.add(c);
      }
    }
  }
  return set;
}

test('font: WCH-CJK.ttf exists, is a TrueType font, <= 4 MB, ships OFL.txt', () => {
  const st = fs.statSync(FONT);
  assert.ok(st.size > 100000 && st.size <= 4 * 1024 * 1024, `size ${st.size}`);
  const buf = fs.readFileSync(FONT);
  assert.equal(buf.readUInt32BE(0), 0x00010000, 'not TrueType-outline sfnt');
  const tables = [];
  for (let i = 0; i < buf.readUInt16BE(4); i++) tables.push(buf.toString('latin1', 12 + i * 16, 16 + i * 16));
  assert.ok(tables.includes('glyf') && !tables.includes('CFF '), 'expected glyf outlines');
  assert.match(fs.readFileSync(path.join(ADDON, 'Fonts', 'OFL.txt'), 'utf8'), /SIL OPEN FONT LICENSE Version 1\.1/i);
});

test('font: cmap covers ASCII, punctuation and the MOE 4808 common characters', () => {
  const cmap = readCmap(fs.readFileSync(FONT));
  for (let c = 0x21; c <= 0x7e; c++) assert.ok(cmap.has(c), `ASCII ${String.fromCharCode(c)}`);
  for (const c of '，。、：；？！「」『』（）…—·％～') assert.ok(cmap.has(c.codePointAt(0)), `punct ${c}`);
  const moe = fs.readFileSync(path.join(__dirname, '..', 'tools', 'data', 'moe-4808.txt'), 'utf8');
  const common = chars(moe).filter((c) => c.codePointAt(0) > 0x2e80);
  assert.equal(new Set(common).size, 4808);
  const missing = common.filter((c) => !cmap.has(c.codePointAt(0)));
  assert.deepEqual(missing, [], `missing common chars: ${missing.join('')}`);
});

test('font: every non-ASCII char used in Glossary.lua (zh fields and expansions) is in the font', () => {
  const cmap = readCmap(fs.readFileSync(FONT));
  const used = new Set();
  const add = (s) => { for (const c of chars(s)) used.add(c); };
  for (const t of G.terms) { add(t.term); add(t.expansion); add(t.zh); }
  for (const [k, p] of Object.entries(G.phrases)) {
    add(k); add(p.zh);
    if (Array.isArray(p.terms)) for (const t of p.terms) { add(t.term); add(t.expansion); add(t.zh); }
  }
  const zhChars = [...used].filter((c) => c.codePointAt(0) > 0x7f);
  assert.ok(zhChars.length > 300, 'sanity: expected many CJK chars in the glossary');
  const missing = [...used].filter((c) => c.codePointAt(0) >= 0x20 && !cmap.has(c.codePointAt(0)));
  assert.deepEqual(missing, [], `glyphs missing from font: ${missing.join('')}`);
});
