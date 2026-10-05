'use strict';
// Glossary data pipeline + bundled fonts (glossary/font track):
//   data/glossary/terms.json, phrases.json (master data)
//   tools/build-glossary.js -> addon/WoWChatHelper_Glossary_<locale>/ (generated, committed)
//   addon/WoWChatHelper/Fonts/WCH-CJK.ttf (TC), WCH-SC.ttf, WCH-KR.ttf (tools/build-font.py)
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const luaparse = require('luaparse');
const { createVM, parseToc } = require('./helpers/lua');
const build = require('../tools/build-glossary');

const ROOT = path.join(__dirname, '..');
const DATA = path.join(ROOT, 'data', 'glossary');
const FONTS = path.join(ROOT, 'addon', 'WoWChatHelper', 'Fonts');
const LOCALES = ['zhTW', 'zhCN', 'koKR', 'deDE', 'frFR', 'esES', 'ptBR', 'ruRU', 'itIT'];
const CATS = new Set(['lfg', 'raid', 'loot', 'role', 'class', 'combat', 'trade', 'social', 'zone', 'misc']);
const TERM_KEYS = ['term', 'aliases', 'expansion', 'cat', 'ambiguity', 'examples', 'tr'];
const MAX_TR = 24;

const terms = JSON.parse(fs.readFileSync(path.join(DATA, 'terms.json'), 'utf8'));
const phrases = JSON.parse(fs.readFileSync(path.join(DATA, 'phrases.json'), 'utf8'));
const byTerm = new Map(terms.map((t) => [t.term.toLowerCase(), t]));
const chars = (s) => Array.from(s);
const normKey = (k) => k.toLowerCase().trim().replace(/\s+/g, ' ').replace(/[.!?,;:]+$/, '');

// ---------------------------------------------------------------- master data

test('build-glossary uses the fixed locale list', () => {
  assert.deepEqual(build.LOCALES, LOCALES);
});

test('terms.json: count, schema, key order, categories', () => {
  assert.ok(terms.length >= 900, `terms: ${terms.length}`);
  for (const t of terms) {
    const id = JSON.stringify(t.term);
    assert.deepEqual(Object.keys(t), TERM_KEYS, `key order of ${id}`);
    assert.equal(typeof t.term, 'string'); assert.ok(t.term.trim() === t.term && t.term.length > 0, id);
    assert.equal(typeof t.expansion, 'string'); assert.ok(t.expansion.length > 0, `${id} expansion`);
    assert.ok(CATS.has(t.cat), `${id} bad cat ${t.cat}`);
    assert.equal(typeof t.ambiguity, 'string', `${id} ambiguity`);
    assert.ok(Array.isArray(t.aliases) && t.aliases.every((a) => typeof a === 'string' && a.trim()), `${id} aliases`);
    assert.ok(Array.isArray(t.examples) && t.examples.every((a) => typeof a === 'string' && a.trim()), `${id} examples`);
    // English data (it goes to the AI as-is)
    assert.match(t.term + t.expansion + t.ambiguity + t.aliases.join('') + t.examples.join(''), /^[\x20-\x7e]*$/, `${id} non-ASCII English field`);
    assert.deepEqual(Object.keys(t.tr).sort(), [...LOCALES].sort(), `${id} tr locales`);
  }
  const used = new Set(terms.map((t) => t.cat));
  for (const c of CATS) assert.ok(used.has(c), `category unused: ${c}`);
});

test('terms.json: every locale filled, each translation <= 24 characters', () => {
  for (const t of terms) {
    for (const l of LOCALES) {
      const v = t.tr[l];
      assert.equal(typeof v, 'string', `${t.term}.${l}`);
      assert.ok(v.trim().length > 0 && v === v.trim(), `${t.term}.${l} empty or untrimmed`);
      assert.ok(chars(v).length <= MAX_TR, `${t.term}.${l} too long: ${v}`);
    }
  }
});

test('terms.json: no case-insensitive duplicate terms, no alias repeating its own term', () => {
  const seen = new Set();
  for (const t of terms) {
    const k = t.term.toLowerCase();
    assert.ok(!seen.has(k), `duplicate term: ${t.term}`);
    seen.add(k);
    const own = new Set([k]);
    for (const a of t.aliases) {
      assert.ok(!own.has(a.toLowerCase()), `${t.term}: alias ${a} repeated`);
      own.add(a.toLowerCase());
    }
  }
});

test('terms.json: core jargon present (incl. Classic-era and the AH bug)', () => {
  for (const must of ['LFM', 'LF1M', 'HC', 'inv', 'ninja', 'OOM', 'CC', 'sheep', 'MT', 'OT', 'DPS',
    'aggro', 'pull', 'wipe', 'rez', 'buff', 'summ', 'port', 'AH', 'WTS', 'WTB', 'WTT', 'CoD', 'mats',
    'BoE', 'BoP', 'SR', 'HR', 'MS', 'OS', 'need', 'greed', 'pug', 'afk', 'brb', 'omw', 'ty', 'np', 'gg',
    'gz', 'grats', 'lol', 'kek', 'ofc', 'idk', 'DM', 'SM', 'BRD', 'UBRS', 'MC', 'Onyxia', 'ZG', 'BWL',
    'down', 'up', 'DMT', 'WB', 'Ony buff', 'Rend buff', 'salv', 'GDKP', 'ding', 'bio', 'Skyborne']) {
    assert.ok(byTerm.has(must.toLowerCase()), `missing required term: ${must}`);
  }
  // ordinary English words the audit says must not be terms (they flood the AI block)
  for (const no of ['all', 'ok', 'sure', 'ready', 'heal', 'run', 'group', 'party', 'wait', 'hi', '60']) {
    assert.ok(!byTerm.has(no), `ordinary word kept as a term: ${no}`);
  }
});

test('terms.json: the triggering bug - AH and down carry what the AI needs', () => {
  const ah = byTerm.get('ah');
  assert.equal(ah.term, 'AH');
  assert.equal(ah.expansion, 'Auction House');
  assert.equal(ah.cat, 'trade');
  assert.match(ah.ambiguity, /interjection/);
  assert.ok(ah.examples.includes("ah isn't down for everyone"));
  assert.equal(ah.tr.zhTW, '拍賣場');
  assert.equal(ah.tr.zhCN, '拍卖行');
  assert.equal(ah.tr.koKR, '경매장');
  assert.equal(ah.tr.deDE, 'Auktionshaus');
  assert.equal(ah.tr.frFR, 'Hôtel des ventes');
  const down = byTerm.get('down');
  assert.match(down.ambiguity, /broken or offline/);
  assert.match(down.ambiguity, /killed/);
  // audit fixes
  assert.match(byTerm.get('hc').ambiguity, /Hardcore/);
  assert.equal(byTerm.get('pl').expansion, 'Power Leveling');
  assert.equal(byTerm.get('st').tr.zhTW, '阿塔哈卡神廟');
  assert.equal(byTerm.get('lfm').tr.zhTW, '徵人');
  assert.equal(byTerm.get('tank').tr.zhTW, '坦');
  assert.equal(byTerm.get('healer').tr.zhTW, '補');
  assert.equal(byTerm.get('boss').tr.zhTW, '王');
  assert.equal(byTerm.get('trash').tr.zhTW, '小怪');
  assert.equal(byTerm.get('wipe').tr.zhTW, '滅團');
});

// Cheap script check: a handful of very common characters that exist only in one of
// Traditional / Simplified Chinese.
const SIMPLIFIED_ONLY = '们这说为对时会来么个国过还没发样问门开关见长队补装级战术师头钱买卖场';
const TRADITIONAL_ONLY = '們這說為對時會來麼個國過還沒發樣問門開關見長隊補裝級戰術師頭錢買賣場';
test('zhTW strings are Traditional, zhCN strings are Simplified (spot check)', () => {
  const all = (l) => terms.map((t) => [t.term, t.tr[l]]).concat(phrases.map((p) => [p.key, p.tr[l]]));
  for (const [k, v] of all('zhTW')) {
    const bad = chars(v).filter((c) => SIMPLIFIED_ONLY.includes(c) && !TRADITIONAL_ONLY.includes(c));
    assert.deepEqual(bad, [], `zhTW ${k}: ${v}`);
  }
  for (const [k, v] of all('zhCN')) {
    const bad = chars(v).filter((c) => TRADITIONAL_ONLY.includes(c) && !SIMPLIFIED_ONLY.includes(c));
    assert.deepEqual(bad, [], `zhCN ${k}: ${v}`);
  }
});

test('phrases.json: count, normalized unique keys, schema, terms exist', () => {
  assert.ok(phrases.length >= 120, `phrases: ${phrases.length}`);
  const keys = new Set();
  for (const p of phrases) {
    assert.deepEqual(Object.keys(p), ['key', 'terms', 'tr'], `keys of ${p.key}`);
    assert.equal(p.key, normKey(p.key), `not normalized: ${JSON.stringify(p.key)}`);
    assert.ok(p.key.length > 0);
    assert.ok(!keys.has(p.key), `duplicate phrase key: ${p.key}`);
    keys.add(p.key);
    assert.ok(Array.isArray(p.terms));
    for (const n of p.terms) assert.ok(byTerm.has(String(n).toLowerCase()), `${p.key}: unknown term ${n}`);
    assert.deepEqual(Object.keys(p.tr).sort(), [...LOCALES].sort(), `${p.key} tr locales`);
    for (const l of LOCALES) {
      assert.ok(typeof p.tr[l] === 'string' && p.tr[l].trim().length > 0, `${p.key}.${l}`);
      assert.ok(chars(p.tr[l]).length <= MAX_TR, `${p.key}.${l} too long: ${p.tr[l]}`);
    }
  }
  for (const must of ['ty', 'ty all', 'gg', 'omw', 'inv pls', 'inv', 'brb', 'lf tank', 'rdy', 'grats', 'np',
    "don't pull", 'dont pull', "let's go", 'lets go', 'tyty', 'ding', 'ah is down']) {
    assert.ok(keys.has(must), `missing phrase: ${must}`);
  }
});

// ---------------------------------------------------------------- generated addons

test('generated glossary addons are up to date with the JSON (rebuilt in memory)', () => {
  const fresh = build.outputs(build.loadData(ROOT));
  assert.equal(Object.keys(fresh).length, LOCALES.length * 2);
  const stale = [];
  for (const [rel, content] of Object.entries(fresh)) {
    let cur = null;
    try { cur = fs.readFileSync(path.join(ROOT, rel), 'utf8').replace(/\r\n/g, '\n'); } catch {}
    if (cur !== content) stale.push(rel);
  }
  assert.deepEqual(stale, [], 'stale: run `node tools/build-glossary.js`');
  // no extra (e.g. renamed-locale) glossary addons lying around
  const dirs = fs.readdirSync(path.join(ROOT, 'addon')).filter((d) => d.startsWith(build.PREFIX)).sort();
  assert.deepEqual(dirs, LOCALES.map((l) => build.PREFIX + l).sort());
});

test('luaStr escapes quotes, backslashes and newlines for Lua 5.1', () => {
  assert.equal(build.luaStr('a"b\\c\nd'), '"a\\"b\\\\c\\nd"');
  const vm = createVM({ files: [], addonName: 'X' });
  assert.equal(vm.eval(build.luaStr('it\'s "x" \\ é 拍賣場\n')), 'it\'s "x" \\ é 拍賣場\n');
});

for (const loc of LOCALES) {
  test(`${loc}: TOC is load-on-demand and the Lua loads in fengari with the right data`, () => {
    const dir = path.join(ROOT, 'addon', build.PREFIX + loc);
    const toc = path.join(dir, build.PREFIX + loc + '.toc');
    const parsed = parseToc(toc);
    assert.equal(parsed.metadata.Interface, '16001');
    assert.equal(parsed.metadata.LoadOnDemand, '1');
    assert.equal(parsed.metadata.Dependencies, 'WoWChatHelper');
    assert.deepEqual(parsed.files.map((f) => path.basename(f)), ['Glossary.lua']);

    const src = fs.readFileSync(path.join(dir, 'Glossary.lua'), 'utf8');
    const ast = luaparse.parse(src, { luaVersion: '5.1' });
    const ctor = ast.body[0].init[0];
    const phrasesField = ctor.fields.find((f) => f.key && f.key.name === 'phrases');
    const keys = phrasesField.value.fields.map((f) => f.key.value || f.key.raw.slice(1, -1));
    assert.equal(new Set(keys).size, keys.length, 'duplicate phrase keys in the Lua table');

    const vm = createVM({ toc, addonName: build.PREFIX + loc });
    const G = vm.eval('WCH_Glossary');
    assert.equal(G.locale, loc);
    assert.equal(G.terms.length, terms.length);
    assert.equal(Object.keys(G.phrases).length, phrases.length);
    for (let i = 0; i < terms.length; i++) {
      const g = G.terms[i], t = terms[i];
      assert.deepEqual(Object.keys(g).sort(), ['ambiguity', 'cat', 'expansion', 'term', 'tr']);
      assert.equal(g.term, t.term); assert.equal(g.tr, t.tr[loc]); assert.equal(g.ambiguity, t.ambiguity);
    }
    const ah = G.terms.find((t) => t.term === 'AH');
    assert.equal(ah.tr, byTerm.get('ah').tr[loc]);
    const p = G.phrases['inv pls'];
    assert.equal(p.tr, phrases.find((x) => x.key === 'inv pls').tr[loc]);
    assert.deepEqual(p.terms.map((t) => t.term), ['inv', 'pls']);
    assert.equal(p.terms[0].tr, byTerm.get('inv').tr[loc]);
    // a phrase without terms still has a (possibly empty) terms table
    assert.ok(G.phrases.hello && typeof G.phrases.hello.terms === 'object');
  });
}

// ---------------------------------------------------------------- fonts

// TrueType cmap parsing (no dependencies): formats 4 and 12 of the Windows Unicode cmaps.
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

const FONT_FILES = { tc: 'WCH-CJK.ttf', sc: 'WCH-SC.ttf', kr: 'WCH-KR.ttf' };
const cmaps = {};
const cmapOf = (k) => (cmaps[k] ||= readCmap(fs.readFileSync(path.join(FONTS, FONT_FILES[k]))));

// Every character of a locale's glossary strings (terms + phrases).
function glossaryChars(loc) {
  const s = new Set();
  for (const t of terms) for (const c of chars(t.tr[loc])) s.add(c);
  for (const p of phrases) for (const c of chars(p.tr[loc])) s.add(c);
  return s;
}
// Non-ASCII characters of one `Locales.<loc> = { ... }` table in Locales.lua ('' if absent).
function localeTableChars(loc) {
  const file = path.join(ROOT, 'addon', 'WoWChatHelper', 'Locales.lua');
  if (!fs.existsSync(file)) return new Set();
  const m = fs.readFileSync(file, 'utf8').match(new RegExp(`^Locales\\.${loc}\\s*=\\s*\\{\\n([\\s\\S]*?)^\\}`, 'm'));
  return new Set(m ? chars(m[1]).filter((c) => c.codePointAt(0) > 0x7f) : []);
}
const missingFrom = (cmap, set) => [...set].filter((c) => c.codePointAt(0) >= 0x20 && !cmap.has(c.codePointAt(0)));

test('fonts: three TrueType (glyf) subsets, each <= 3 MB, OFL license shipped', () => {
  for (const [k, f] of Object.entries(FONT_FILES)) {
    const file = path.join(FONTS, f);
    const st = fs.statSync(file);
    assert.ok(st.size > 100000 && st.size <= 3 * 1024 * 1024, `${f} size ${st.size}`);
    const buf = fs.readFileSync(file);
    assert.equal(buf.readUInt32BE(0), 0x00010000, `${f} not TrueType-outline sfnt`);
    const tables = [];
    for (let i = 0; i < buf.readUInt16BE(4); i++) tables.push(buf.toString('latin1', 12 + i * 16, 16 + i * 16));
    assert.ok(tables.includes('glyf') && !tables.includes('CFF '), `${k}: expected glyf outlines`);
  }
  const ofl = fs.readFileSync(path.join(FONTS, 'OFL.txt'), 'utf8');
  assert.match(ofl, /SIL OPEN FONT LICENSE Version 1\.1/i);
  for (const f of Object.values(FONT_FILES)) assert.ok(ofl.includes(f), `OFL.txt does not name ${f}`);
});

test('fonts: all three cover ASCII, Latin-1 letters and basic Cyrillic (player names, English chat)', () => {
  for (const k of Object.keys(FONT_FILES)) {
    const cmap = cmapOf(k);
    for (let c = 0x21; c <= 0x7e; c++) assert.ok(cmap.has(c), `${k}: ASCII ${String.fromCharCode(c)}`);
    for (const c of 'äöüßéèêçñàùâîôûëïœ¿¡«»АБВабвёЁжщ') assert.ok(cmap.has(c.codePointAt(0)), `${k}: ${c}`);
  }
});

test('font TC: punctuation, MOE 4808, zhTW glossary/UI and the Latin/Cyrillic languages', () => {
  const cmap = cmapOf('tc');
  for (const c of '，。、：；？！「」『』（）…—·％～') assert.ok(cmap.has(c.codePointAt(0)), `punct ${c}`);
  const moe = chars(fs.readFileSync(path.join(ROOT, 'tools', 'data', 'moe-4808.txt'), 'utf8')).filter((c) => c.codePointAt(0) > 0x2e80);
  assert.equal(new Set(moe).size, 4808);
  assert.deepEqual(moe.filter((c) => !cmap.has(c.codePointAt(0))), [], 'MOE chars missing');
  const zh = glossaryChars('zhTW');
  assert.ok([...zh].filter((c) => c.codePointAt(0) > 0x2e80).length > 500, 'sanity: many CJK chars');
  assert.deepEqual(missingFrom(cmap, zh), [], 'zhTW glossary glyphs missing from WCH-CJK.ttf');
  assert.deepEqual(missingFrom(cmap, localeTableChars('zhTW')), [], 'zhTW UI glyphs missing (rebuild fonts)');
  for (const l of ['deDE', 'frFR', 'esES', 'ptBR', 'ruRU', 'itIT']) {
    assert.deepEqual(missingFrom(cmap, glossaryChars(l)), [], `${l} glossary glyphs missing from WCH-CJK.ttf`);
    assert.deepEqual(missingFrom(cmap, localeTableChars(l)), [], `${l} UI glyphs missing from WCH-CJK.ttf`);
  }
});

test('font SC: GB2312 (6763 hanzi), zhCN glossary and UI strings', () => {
  const cmap = cmapOf('sc');
  for (const c of '，。、：；？！“”‘’（）…—·％～') assert.ok(cmap.has(c.codePointAt(0)), `punct ${c}`);
  const gb = chars(fs.readFileSync(path.join(ROOT, 'tools', 'data', 'gb2312-6763.txt'), 'utf8')).filter((c) => c.codePointAt(0) > 0x2e80);
  assert.equal(new Set(gb).size, 6763);
  assert.deepEqual(gb.filter((c) => !cmap.has(c.codePointAt(0))), [], 'GB2312 chars missing');
  assert.deepEqual(missingFrom(cmap, glossaryChars('zhCN')), [], 'zhCN glossary glyphs missing from WCH-SC.ttf');
  assert.deepEqual(missingFrom(cmap, localeTableChars('zhCN')), [], 'zhCN UI glyphs missing (rebuild fonts)');
});

test('font KR: KS X 1001 Hangul (2350), compatibility jamo, koKR glossary and UI strings', () => {
  const cmap = cmapOf('kr');
  const ks = chars(fs.readFileSync(path.join(ROOT, 'tools', 'data', 'ksx1001-hangul-2350.txt'), 'utf8')).filter((c) => c.codePointAt(0) >= 0xac00);
  assert.equal(new Set(ks).size, 2350);
  assert.deepEqual(ks.filter((c) => !cmap.has(c.codePointAt(0))), [], 'KS X 1001 syllables missing');
  for (const c of 'ㄱㄴㄷㅋㅎㅏㅠㅜ') assert.ok(cmap.has(c.codePointAt(0)), `jamo ${c}`);
  assert.deepEqual(missingFrom(cmap, glossaryChars('koKR')), [], 'koKR glossary glyphs missing from WCH-KR.ttf');
  assert.deepEqual(missingFrom(cmap, localeTableChars('koKR')), [], 'koKR UI glyphs missing (rebuild fonts)');
});

// Review fix: data lint against merged entries (EA "each", 1g "5g/10g/100g").
test('terms.json lint: no numeric price aliases, no everyday-word aliases that change the meaning', () => {
  const { ENGLISH_WORDS } = require('../bridge/glossary');
  const data = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'data', 'glossary', 'terms.json'), 'utf8'));
  for (const t of data) {
    for (const a of t.aliases) {
      assert.ok(!/^\d+\s*[gsc]$/i.test(a), `${t.term}: numeric price alias ${a}`);
      assert.ok(!/^\d/.test(t.term) || !/^\d+[gsc]$/i.test(t.term), `${t.term}: a price is not a term`);
    }
    for (const bad of ['each', 'at', 'go']) assert.ok(!t.aliases.includes(bad), `${t.term}: alias ${bad}`);
  }
  assert.ok(ENGLISH_WORDS.has('was') && ENGLISH_WORDS.has('how'));
  const by = (k) => data.find(t => t.term === k);
  assert.ok(!by('1g'), '1g entry gone');
  assert.deepStrictEqual(by('Expose Armor').aliases, ['EA']);
  assert.match(by('123').expansion, /summon me/);
});
