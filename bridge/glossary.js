// The WoW term glossary on the bridge side: finds the jargon present in a chat line so
// the prompt can hand the model the right meaning (the "ah isn't down for everyone" bug:
// the model read "ah" as the interjection because it never saw the glossary).
//
// Master data: data/glossary/terms.json (array of { term, aliases, expansion, cat,
// ambiguity, examples, tr: { <locale>: "..." } }). The addon gets per-locale copies
// generated from the same file (tools/build-glossary.js).
//
// Matching: case-insensitive, on word boundaries (a letter or digit next to the match
// means no match: "aha" and "shah" don't contain "ah"), multiword terms with any run of
// whitespace between the words, longest match first, no overlaps. One precompiled regex
// for the whole glossary.
'use strict';

const fs = require('fs');
const path = require('path');

const LOCALES = ['zhTW', 'zhCN', 'koKR', 'deDE', 'frFR', 'esES', 'ptBR', 'ruRU', 'itIT'];
const DEFAULT_LOCALE = 'zhTW';
const LOCALE_ALIASES = { esMX: 'esES', zhHK: 'zhTW', ptPT: 'ptBR' };

const DATA_DIR = path.join(__dirname, '..', 'data', 'glossary');
const DEFAULT_FILES = [path.join(DATA_DIR, 'terms.json'), path.join(DATA_DIR, 'raw-terms.json')];

// A supported locale code for `v` (case-insensitive, esMX -> esES), or null.
function normalizeLocale(v) {
  const s = String(v ?? '').trim().replace('-', '').replace('_', '');
  if (!s) return null;
  const all = [...LOCALES, ...Object.keys(LOCALE_ALIASES)];
  const hit = all.find(l => l.toLowerCase() === s.toLowerCase());
  if (!hit) return null;
  return LOCALE_ALIASES[hit] || hit;
}

// Glossary forms that are also everyday English words. A form written with capitals
// ("IF", "AS", "HoW", "WAs", "DoN", "Ash", "Van") matches one of these words only when
// the chat line has exactly that spelling: "how r u" is not Hammer of Wrath, "If" at the
// start of a sentence is not Ironforge, but "IF" and "HoW" still match. A lowercase
// ALIAS in this list never matches ("at" is not "@", "go" is not "gogo"); an entry's own
// lowercase term ("need", "down", "up") still does, and carries an ambiguity note.
const ENGLISH_WORDS = new Set((
  'a an and am are as at be by do go he hi i if in is it me my no of oh on or so to up us we ' +
  'all any ago one per pet run see set two war way who why yes was how don ve id es ad ma em ' +
  'hot tot sod bow cow cot sos gee lip lib arm van ash fade patch shield general forever heroic ' +
  'bubble details legacy prince beast baron emperor inferno razor twins titans giants brood ' +
  'scarab omen atlas gadget gads blasted library armory cathedral survival subtlety ' +
  'reincarnation mine horsemen sepulcher snowfall rag darn fort stocks rend mm fr w x l ' +
  'sum cross might kings hero morning light cause howdy say yell pop transfer convert replace ' +
  'chain tap tapped quick arena princess tribute stairs ruins bomb breath sand heart bugs ' +
  'dragons dogs meter cleave tail pack pot split flower boon gift judge box each guard friendly ' +
  'neutral hated unfriendly load binds talent points bound junk white whatever graves wolf ram ' +
  'horse saber bat inn plan orb orbs crystal tin silk wool linen maxed fee tips icy ham chicken ' +
  'grenades dirge chops runes buyers middle camp tower bunker bunkers glide gryphon owl hawk ' +
  'monkey kitty nova light seals sharing kick assist ship drinking adds sunders bandages ' +
  'materials minute salute salt tilt sweat sweaty yup dinged banker emotes layering casuals ' +
  'chars critters portals disbanding gray reserved bidding bindings root cat bear serpent ' +
  'missiles sanctuary salvation freedom judgement consecration eviscerate pp boxes crippling ' +
  'corruption immolate shards seduce exec thunderclap whirlwind intercept recklessness allies ' +
  'enchants transmute plans guardian capping capped tun flagged parses logs pumping banned ' +
  'ea suspended runners enraged soaking crafting crafted cookie cookies ranged tots'
).split(' '));

const WORD = /[\p{L}\p{N}]/u;
const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const norm = (s) => String(s).toLowerCase().replace(/\s+/g, ' ').trim();
const hasCaps = (s) => /[A-Z]/.test(s);

const LETTER = /\p{L}/u;
// Letter-initial forms that may follow a number: units ("80g", "5k", "2h", "10min", "x2").
const UNITS = new Set(['g', 's', 'c', 'k', 'm', 'h', 'min', 'mins', 'sec', 'secs', 'hr', 'hrs', 'gold', 'silver', 'copper', 'x']);

// One pattern for a term: boundaries only on sides where the term itself starts/ends
// with a letter or digit ("<3", "/w", "price?" carry their own punctuation).
// Left: a letter-initial form may not follow a letter, a digit (except unit forms:
// "80g", "5k") or an apostrophe ("we've" has no "ve"); a digit-initial one may not
// follow a letter or digit ("lvl60" has no "60"). Right: no letter or digit, and no
// contraction ("don't" has no "don"; "ah's prices" still has "ah").
function termPattern(t) {
  t = t.trim();
  const body = t.split(/\s+/).map(escapeRe).join('\\s+');
  let pre = '';
  if (LETTER.test(t[0])) pre = UNITS.has(t.toLowerCase()) ? "(?<![\\p{L}'\u2019])" : "(?<![\\p{L}\\p{N}'\u2019])";
  else if (WORD.test(t[0])) pre = '(?<![\\p{L}\\p{N}])';
  const post = WORD.test(t.slice(-1)) ? "(?![\\p{L}\\p{N}])(?!['\u2019](?:t|ve|re|ll|d|m)(?![\\p{L}]))" : '';
  return pre + body + post;
}

// Whether the chat spelling `found` of glossary form `surface` counts (see ENGLISH_WORDS).
function formMatches(surface, found, viaAlias) {
  const low = found.toLowerCase();
  if (!ENGLISH_WORDS.has(low)) return true;
  if (hasCaps(surface)) return found === surface;
  return !viaAlias;
}

class Glossary {
  // entries: the terms.json array. Entries without a term are ignored.
  constructor(entries = []) {
    this.entries = [];
    this.byKey = new Map(); // normalized surface form -> [{ entry, viaAlias, surface }]
    for (const e of Array.isArray(entries) ? entries : []) {
      if (!e || typeof e !== 'object' || typeof e.term !== 'string' || !e.term.trim()) continue;
      const entry = {
        term: e.term.trim(), aliases: Array.isArray(e.aliases) ? e.aliases.filter(a => typeof a === 'string' && a.trim()) : [],
        expansion: typeof e.expansion === 'string' ? e.expansion : '', cat: typeof e.cat === 'string' ? e.cat : '',
        ambiguity: typeof e.ambiguity === 'string' ? e.ambiguity : '',
        tr: e.tr && typeof e.tr === 'object' ? e.tr : {},
      };
      this.entries.push(entry);
      const forms = [[entry.term, false], ...entry.aliases.map(a => [a.trim(), true])];
      for (const [surface, viaAlias] of forms) {
        const k = norm(surface);
        if (!k) continue;
        let list = this.byKey.get(k);
        if (!list) { list = []; this.byKey.set(k, list); }
        if (list.some(x => x.entry === entry)) continue;
        // The entry whose own term is this form comes first.
        if (viaAlias) list.push({ entry, viaAlias, surface }); else list.unshift({ entry, viaAlias, surface });
      }
    }
    // Keys bucketed by their first character; each bucket is one sticky regex, longest
    // key first, tried only at positions starting with that character.
    const buckets = new Map();
    for (const k of this.byKey.keys()) {
      const c = String.fromCodePoint(k.codePointAt(0));
      if (!buckets.has(c)) buckets.set(c, []);
      buckets.get(c).push(k);
    }
    this.buckets = new Map();
    for (const [c, keys] of buckets) {
      keys.sort((a, b) => b.length - a.length);
      this.buckets.set(c, new RegExp(keys.map(termPattern).join('|'), 'iuy'));
    }
  }

  // [{ index, text }] of every glossary form in `text`: leftmost-longest, no overlaps.
  scan(text) {
    const s = String(text ?? '');
    const out = [];
    for (let i = 0; i < s.length;) {
      const cp = s.codePointAt(i);
      const ch = String.fromCodePoint(cp);
      const re = this.buckets.get(ch.toLowerCase()) || this.buckets.get(ch);
      if (re) {
        re.lastIndex = i;
        const m = re.exec(s);
        if (m && m[0].length) { out.push({ index: i, text: m[0] }); i += m[0].length; continue; }
      }
      i += ch.length;
    }
    return out;
  }

  get size() { return this.entries.length; }

  // The glossary hits in `text`, in order of appearance, one per entry:
  // [{ term, expansion, ambiguity, tr, cat, match }]. `tr` is the translation for
  // `locale` ("" when the glossary has none). opts.max caps the list (default 20).
  find(text, locale = DEFAULT_LOCALE, opts = {}) {
    const max = opts.max ?? 20;
    const out = [];
    if (!text) return out;
    const seen = new Set();
    const loc = normalizeLocale(locale) || DEFAULT_LOCALE;
    for (const { text: found } of this.scan(text)) {
      const list = this.byKey.get(norm(found)) || [];
      for (const { entry, surface, viaAlias } of list) {
        if (seen.has(entry)) continue;
        // "if"/"how"/"was" in ordinary spelling are English, not IF/HoW/WAs.
        if (!formMatches(surface, found, viaAlias)) continue;
        seen.add(entry);
        out.push({
          term: entry.term, expansion: entry.expansion, ambiguity: entry.ambiguity, cat: entry.cat,
          tr: typeof entry.tr[loc] === 'string' ? entry.tr[loc] : '', match: found,
        });
        if (out.length >= max) return out;
      }
    }
    return out;
  }

  // Hits for a request: its text first, then ctx lines (flagged inCtx), no duplicates.
  // For kind "t" the text is the player's own language, not English chat: only the
  // (English) ctx lines are scanned ("ma place" is not MA, "em 5 minutos" is not EM).
  findForRequest(req, locale, opts = {}) {
    const max = opts.max ?? 20;
    const inText = req.kind === 't' ? [] : this.find(req.text || '', locale, { max });
    const terms = new Set(inText.map(h => h.term));
    const inCtx = this.find(req.ctx || '', locale, { max })
      .filter(h => !terms.has(h.term)).map(h => ({ ...h, inCtx: true }));
    return [...inText, ...inCtx].slice(0, max);
  }
}

// Glossary from a file (default: data/glossary/terms.json, else raw-terms.json while the
// translated file is not built yet). A missing or broken file gives an empty glossary
// and a note: the bridge still works, the prompt just has no known-terms block.
function loadGlossary(file, log = () => {}) {
  const files = file ? [file] : DEFAULT_FILES;
  for (const f of files) {
    let raw;
    try { raw = fs.readFileSync(f, 'utf8'); } catch { continue; }
    try {
      const g = new Glossary(JSON.parse(raw));
      g.file = f;
      return g;
    } catch (e) { log(`glossary: cannot parse ${f}: ${e.message}`); }
  }
  log(`glossary: no glossary file found (${files.join(', ')}); prompts go without known terms`);
  const g = new Glossary([]);
  g.file = null;
  return g;
}

module.exports = { LOCALES, DEFAULT_LOCALE, normalizeLocale, Glossary, loadGlossary, termPattern, formMatches, ENGLISH_WORDS };
