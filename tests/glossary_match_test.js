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

// ---------------------------------------------------------------------------
// Review fixes, on the real data/glossary/terms.json: ordinary English must not be
// handed a WoW sense; real jargon still matches.
// ---------------------------------------------------------------------------
const real = G.loadGlossary(path.join(__dirname, '..', 'data', 'glossary', 'terms.json'));
const hits = (text, loc = 'zhTW') => real.find(text, loc).map(h => `${h.match}=${h.term}`);

test('real glossary: capitalized forms that are English words match only in their own spelling', () => {
  for (const [line, word] of [['it was down earlier', 'was'], ['how r u', 'how'], ['How r u', 'How'], ['its hot today', 'hot'],
    ['the patch notes', null], ['If you can', 'If'], ['i saw a cow', 'cow'], ['nice bow', 'bow'], ['my arm hurts', 'arm'],
    ['grab the van', 'van'], ['ash and fire', 'ash'], ['fade away', 'fade'], ['id rather not', 'id']]) {
    const h = hits(line);
    if (word) assert.ok(!h.some(x => x.startsWith(word + '=')), `${line}: ${h}`);
  }
  assert.deepStrictEqual(hits('it was down earlier'), ['down=down']);
  assert.ok(hits('pop HoW now').includes('HoW=HoW'));
  assert.ok(hits('my WAs are broken').includes('WAs=WeakAuras'));
  assert.ok(hits('IF is laggy').includes('IF=IF'));
  assert.ok(hits('need more HoTs on tank').length >= 1);
  // Lowercase jargon that is typed lowercase in chat still matches.
  assert.ok(hits('cod me the mats').includes('cod=CoD'));
  assert.ok(hits('dot him up').includes('dot=DoT'));
  assert.ok(hits("ah isn't down for everyone").includes('ah=AH'));
});

test('real glossary: contractions and ordinals are not jargon; units after numbers are', () => {
  for (const line of ["don't pull", 'i don’t know', "we've got it", "i've done it", '1st boss', '2nd pull', '3rd time']) {
    const h = hits(line);
    assert.ok(!h.some(x => /^(don|ve|st|nd|rd)=/i.test(x)), `${line}: ${h}`);
  }
  assert.ok(hits('80g').includes('g=g'));
  assert.ok(hits('5k gold').includes('k=k'));
  assert.ok(hits("ah's prices are nuts").includes('ah=AH'), 'possessive still matches');
});

test('real glossary: everyday words are not handed a WoW sense (at, go, need in a sentence)', () => {
  assert.deepStrictEqual(hits('i need to go eat dinner brb').filter(x => /^(go|at)=/.test(x)), []);
  assert.deepStrictEqual(hits('meet at the bank').filter(x => x.startsWith('at=')), []);
  const need = real.find('i need to go eat dinner brb').find(h => h.term === 'need');
  assert.ok(need && /ordinary English/.test(need.ambiguity), 'need keeps a note telling the model when it is plain English');
  assert.ok(hits('gogo pull').includes('gogo=gogo'));
});

test('real glossary: trade prices: "5g ea" = gold + each, not "1 gold" / Expose Armor', () => {
  const h = real.find('WTS [Major Healing Potion] 5g ea', 'koKR');
  const by = Object.fromEntries(h.map(x => [x.match, x]));
  assert.strictEqual(by.g.term, 'g');
  assert.strictEqual(by.ea.term, 'ea');
  assert.match(by.ea.expansion, /^each/);
  assert.ok(!h.some(x => x.term === 'Expose Armor' || x.term === '1g' || /1 gold/.test(x.expansion)), JSON.stringify(h));
  assert.ok(real.find('no EA, we have sunders').some(x => x.term === 'Expose Armor'));
});

test('real glossary: "123" means asking for a summon', () => {
  const h = real.find('123', 'zhTW');
  assert.strictEqual(h.length, 1);
  assert.match(h[0].expansion, /summon me/);
  assert.match(h[0].tr, /召喚/);
});

test('kind "t": the player\'s own words are not scanned as English jargon, only ctx', () => {
  const fr = real.findForRequest({ kind: 't', text: "J'arrive dans 5 minutes, gardez-moi ma place", ctx: 'Bob: LF1M heals' }, 'frFR');
  assert.ok(!fr.some(x => x.match === 'ma'), JSON.stringify(fr));
  assert.ok(fr.every(x => x.inCtx));
  assert.ok(fr.some(x => x.term === 'LF1M'));
  assert.deepStrictEqual(real.findForRequest({ kind: 't', text: 'Chego em 5 minutos, me convida pro grupo', ctx: '' }, 'ptBR'), []);
  assert.deepStrictEqual(real.findForRequest({ kind: 't', text: 'Bin in 5 Minuten da, lad mich ein', ctx: '' }, 'deDE'), []);
  assert.ok(real.findForRequest({ kind: 'x', text: 'ah is down', ctx: '' }, 'deDE').some(x => x.term === 'AH'));
});

// ---------------------------------------------------------------------------
// Glossary data round 2 (eval failures): web addresses / gold spam, and the lines the
// live eval misread because of the data.
// ---------------------------------------------------------------------------
test('urlSpans: web addresses and spam spellings, not ordinary sentences', () => {
  const spans = (s) => G.urlSpans(s).map(([a, b]) => s.slice(a, b));
  assert.deepStrictEqual(spans('free gold visit wowgold dot com'), ['wowgold dot com']);
  assert.deepStrictEqual(spans('www.wowgold.com cheap'), ['www.wowgold.com']);
  assert.deepStrictEqual(spans('go to wowgold.com now'), ['wowgold.com']);
  assert.deepStrictEqual(spans('wowgold(dot)com'), ['wowgold(dot)com']);
  assert.deepStrictEqual(spans('w0wgold . c0m 50% off'), ['w0wgold . c0m']);
  assert.deepStrictEqual(spans('https://x.y/z?a=1 lol'), ['https://x.y/z?a=1']);
  assert.deepStrictEqual(spans('its a dot com scam'), ['a dot com']);
  for (const s of ['dot him up', 'ty. org later', 'meet in org.', 'inv. net worth', 'com on guys', 'wb dropping in org']) {
    assert.deepStrictEqual(spans(s), [], s);
  }
});

test('real glossary: "dot" / "com" inside a web address are not DoT / commission', () => {
  for (const line of ['free gold visit wowgold dot com', 'buy gold at wowgold dot com', 'www.wowgold.com cheap',
    'wowgold.com 10k = 5$', 'wowgold(dot)com', 'w0wgold . c0m']) {
    const h = hits(line);
    assert.ok(!h.some(x => /=(DoT|commission)$/.test(x)), `${line}: ${h}`);
  }
  assert.ok(hits('buy gold at wowgold dot com').includes('gold=gold'), 'words outside the address still match');
  assert.ok(hits('dot him up').includes('dot=DoT'));
  assert.ok(hits('ty. org later').includes('org=Org'));
});

test('real glossary: eval lines get the right entry and note', () => {
  const one = (line, term) => real.find(line, 'zhTW').find(x => x.term === term);
  // gg after a wipe is resigned, not praise
  assert.match(one('gg wipe, run back', 'gg').ambiguity, /wipe.*not praise/);
  // share tags: a multiword entry beats "share" = share the quest
  for (const line of ['can we share tags on these?', 'can we share tags', 'wanna share tag?', 'can we share the mob']) {
    assert.deepStrictEqual(real.find(line).map(x => x.term).filter(t => /share/.test(t)), ['share tags'], line);
  }
  assert.match(one('can u share the quest', 'share').ambiguity, /share tags/);
  // SS: one Soulstone entry with the other senses in its note
  for (const line of ['ss me pls', 'ss on priest']) {
    const h = real.find(line);
    assert.deepStrictEqual(h.filter(x => x.match.toLowerCase() === 'ss').map(x => x.term), ['SS'], line);
    assert.match(h[0].expansion, /Soulstone/);
    assert.match(h[0].ambiguity, /Sinister Strike/);
    assert.match(h[0].ambiguity, /Southshore/);
  }
  // def: definitely by default, defend in a BG
  const def = one('flag carrier is at mid, def our fc', 'def');
  assert.match(def.expansion, /^definitely/);
  assert.match(def.ambiguity, /defend/);
  // Strat Live is Stratholme
  for (const loc of G.LOCALES) {
    const s = real.find('LF1M strat live last spot dps', loc).find(x => x.term === 'Strat Live');
    assert.ok(s && !/血色|붉은십자군|Scarlet|Écarlate|Escarlata|Escarlate|Алого|Scarlatt/i.test(s.tr), `${loc}: ${s && s.tr}`);
  }
  assert.match(one('strat live run', 'Strat Live').expansion, /^Stratholme/);
  assert.match(real.find('strat live', 'zhTW')[0].tr, /斯坦索姆/);
  // jump runs
  for (const line of ['anyone want to run dm east for jumpruns?', 'jumprun?', 'LF jump runs', 'wts dme jump runs']) {
    assert.ok(real.find(line).some(x => x.term === 'jump runs'), line);
  }
  assert.deepStrictEqual(real.find('LF DME').map(x => x.term), ['LF', 'DM East']);
  // "<thing> inc"
  const rezInc = real.find('rez inc').map(x => x.term);
  assert.deepStrictEqual(rezInc, ['rez', 'inc'], 'one rez entry, then inc');
  assert.match(one('rez inc', 'inc').ambiguity, /rez inc/);
  // wb dropping names the dragon head
  assert.match(one('wb dropping in org 10 min', 'world buffs').ambiguity, /Rallying Cry/);
  // "min 50" in a bid
  assert.match(one('dkp bids open, min 50', 'min').ambiguity, /minimum/);
  // "mine" is the ordinary word unless written "gold mine"
  assert.deepStrictEqual(real.find('ya mine too').map(x => x.term).filter(t => /mine/i.test(t)), []);
  assert.ok(real.find('inc gold mine').some(x => x.term === 'Gold Mine'));
});

test('real glossary: common English surfaces that do match carry a note', () => {
  for (const w of ['main', 'focus', 'stack', 'stacks', 'click', 'dropped', 'q', 'behind', 'fire', 'cut', 'charge', 'blind',
    'prep', 'plans', 'buff', 'cons', 'epic', 'blue', 'classic', 'vent', 'ping', 'pal', 'moon', 'wipe', 'bind', 'min', 'def', 'gg']) {
    const h = real.find(w);
    assert.ok(h.length && h.every(x => x.ambiguity), `${w}: ${JSON.stringify(h.map(x => [x.term, x.ambiguity]))}`);
  }
});
