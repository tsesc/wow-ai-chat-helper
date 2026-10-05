// Tests for bridge/glossary.js: the matcher that feeds the known-terms block of the prompt.
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const G = require('../bridge/glossary');

const FIXTURE = path.join(__dirname, 'fixtures', 'terms.json');
const g = new G.Glossary(JSON.parse(fs.readFileSync(FIXTURE, 'utf8')));
const terms = (text, loc) => g.find(text, loc).map(h => h.term);

test('fixture has the terms.json schema with all 9 locales', () => {
  const data = JSON.parse(fs.readFileSync(FIXTURE, 'utf8'));
  for (const t of data) {
    assert.deepStrictEqual(Object.keys(t), ['term', 'aliases', 'expansion', 'cat', 'ambiguity', 'examples', 'tr']);
    assert.deepStrictEqual(Object.keys(t.tr), G.LOCALES);
  }
});

test('the trigger line: "ah isn\'t down for everyone" finds AH with its expansion, note and translation', () => {
  const hits = g.find("ah isn't down for everyone", 'zhTW');
  const ah = hits.find(h => h.term === 'AH');
  assert.ok(ah, 'AH found');
  assert.strictEqual(ah.match, 'ah');
  assert.strictEqual(ah.expansion, 'Auction House');
  assert.strictEqual(ah.tr, '拍賣場');
  assert.match(ah.ambiguity, /interjection/);
  assert.deepStrictEqual(terms("ah isn't down for everyone"), ['AH', 'down']);
});

test('case-insensitive: ah / AH / Ah / "auction house" / "Auction  House"', () => {
  for (const t of ['ah', 'AH', 'Ah', 'check the AH', 'the auction house is down', 'Auction  House', 'AUCTION HOUSE']) {
    assert.ok(terms(t).includes('AH'), t);
  }
  assert.strictEqual(g.find('the auction house is down')[0].match, 'auction house');
});

test('word boundaries: aha, shah, ahh, bah, ah2 do not contain AH', () => {
  for (const t of ['aha', 'shah', 'ahh', 'bah', 'ah2', 'yeah', 'ahead', 'Ahn\'Qiraj', 'tyvm', 'pity']) {
    assert.deepStrictEqual(terms(t), [], t);
  }
  // Punctuation and apostrophes are boundaries.
  assert.deepStrictEqual(terms('(ah)'), ['AH']);
  assert.deepStrictEqual(terms("ah's prices"), ['AH']);
  assert.deepStrictEqual(terms('ty!'), ['ty']);
  assert.deepStrictEqual(terms('ok,ty'), ['ty']);
});

test('multiword terms and aliases; the longest form wins, no overlaps', () => {
  assert.deepStrictEqual(terms('who wants to run sm cath?'), ['SM Cath']);
  assert.deepStrictEqual(terms('SM   CATH tonight'), ['SM Cath']);
  assert.deepStrictEqual(terms('sm cathedral run'), ['SM Cath']);
  assert.deepStrictEqual(terms('cath only'), ['SM Cath']);
  assert.deepStrictEqual(terms('LF 1M'), ['LF1M']);
  assert.deepStrictEqual(terms('thx all'), ['ty'], 'alias maps to its entry');
  assert.deepStrictEqual(terms('ty ty thx'), ['ty'], 'one hit per entry');
});

test('letters after a number match ("80g"), digit-led terms need a clean start; symbol terms', () => {
  assert.deepStrictEqual(terms('80g'), ['g']);
  assert.deepStrictEqual(terms('ty <3'), ['ty', '<3']);
  assert.deepStrictEqual(terms('i<3 u'), ['<3'], 'no boundary needed before a symbol');
});

test('all-caps terms that are English words are skipped in lowercase only', () => {
  assert.deepStrictEqual(terms('if u want'), []);
  assert.deepStrictEqual(terms('meet in IF'), ['IF']);
  assert.deepStrictEqual(terms('meet in ironforge'), ['IF']);
});

test('locale: translation for the locale, esMX -> esES, unknown -> zhTW, missing -> ""', () => {
  assert.strictEqual(g.find('ah', 'deDE')[0].tr, 'Auktionshaus');
  assert.strictEqual(g.find('ah', 'esMX')[0].tr, 'Casa de subastas');
  assert.strictEqual(g.find('ah', 'enUS')[0].tr, '拍賣場');
  const bare = new G.Glossary([{ term: 'wb', aliases: [], expansion: 'world buff', cat: 'raid', ambiguity: '', examples: [] }]);
  assert.deepStrictEqual(bare.find('wb in 5', 'koKR'), [{ term: 'wb', expansion: 'world buff', ambiguity: '', cat: 'raid', tr: '', match: 'wb' }]);
  assert.strictEqual(G.normalizeLocale('kokr'), 'koKR');
  assert.strictEqual(G.normalizeLocale('zh-TW'), 'zhTW');
  assert.strictEqual(G.normalizeLocale('enUS'), null);
  assert.strictEqual(G.normalizeLocale(''), null);
});

test('findForRequest: text hits first, then ctx-only hits flagged inCtx', () => {
  const hits = g.findForRequest({ text: 'inv pls', ctx: 'Bob: LF1M sm cath\nAnn: inv me too' }, 'zhTW');
  assert.deepStrictEqual(hits.map(h => [h.term, !!h.inCtx]), [['inv', false], ['LF1M', true], ['SM Cath', true]]);
});

test('max caps the hits; bad entries are ignored; empty input is fine', () => {
  assert.strictEqual(g.find('ah inv ty LF1M IF', 'zhTW', { max: 2 }).length, 2);
  const odd = new G.Glossary([null, { term: '' }, { term: 'brd', aliases: ['blackrock depths', 7] }]);
  assert.strictEqual(odd.size, 1);
  assert.deepStrictEqual(odd.find('BRD or blackrock depths').map(h => h.term), ['brd']);
  assert.deepStrictEqual(g.find(''), []);
  assert.deepStrictEqual(new G.Glossary([]).find('ah'), []);
});

test('loadGlossary: a given file, a missing file (empty + note), a broken file', () => {
  assert.strictEqual(G.loadGlossary(FIXTURE).size, 9);
  const logs = [];
  const none = G.loadGlossary(path.join(os.tmpdir(), 'wch-none.json'), l => logs.push(l));
  assert.strictEqual(none.size, 0);
  assert.match(logs.join('\n'), /no glossary file found/);
  const bad = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'wch-g-')), 'terms.json');
  fs.writeFileSync(bad, '{ nope');
  logs.length = 0;
  assert.strictEqual(G.loadGlossary(bad, l => logs.push(l)).size, 0);
  assert.match(logs.join('\n'), /cannot parse/);
});

test('the repo glossary loads and is fast (precompiled)', () => {
  const real = G.loadGlossary();
  if (!real.size) return; // data/glossary not built in this checkout
  const line = "LFM UBRS need 1 dps, have key, wts [Arcanite Bar] 25g pst - ah isn't down for everyone";
  assert.ok(real.find(line).some(h => h.term === 'AH'), 'AH in the real glossary');
  const t0 = process.hrtime.bigint();
  for (let i = 0; i < 500; i++) real.find(line);
  const ms = Number(process.hrtime.bigint() - t0) / 1e6 / 500;
  assert.ok(ms < 5, `find() took ${ms.toFixed(2)} ms per line`);
});
