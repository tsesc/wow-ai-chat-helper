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

// All-caps glossary terms that are also everyday English words: when the chat line has
// them in lowercase ("if", "as", "am") they are the English word, not the abbreviation.
// Only that case is skipped; "IF" in capitals still matches Ironforge.
const ENGLISH_WORDS = new Set(('a an and am are as at be by do go he hi i if in is it me my no of oh on or ' +
  'so to up us we all any ago one per pet run see set two war way who why yes').split(' '));

const WORD = /[\p{L}\p{N}]/u;
const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const norm = (s) => String(s).toLowerCase().replace(/\s+/g, ' ').trim();
const isAllCaps = (s) => /[A-Z]/.test(s) && s === s.toUpperCase();

const LETTER = /\p{L}/u;

// One pattern for a term: boundaries only on sides where the term itself starts/ends
// with a letter or digit ("<3", "/w", "price?" carry their own punctuation). A term that
// starts with a letter may follow a digit ("80g", "5k", "2h"); one that starts with a
// digit may not follow a letter or digit ("lvl60" has no "60").
function termPattern(t) {
  t = t.trim();
  const body = t.split(/\s+/).map(escapeRe).join('\\s+');
  const pre = LETTER.test(t[0]) ? '(?<!\\p{L})' : WORD.test(t[0]) ? '(?<![\\p{L}\\p{N}])' : '';
  const post = WORD.test(t.slice(-1)) ? '(?![\\p{L}\\p{N}])' : '';
  return pre + body + post;
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
      for (const { entry, surface } of list) {
        if (seen.has(entry)) continue;
        // "if"/"as"/"am" in lowercase are English, not IF/AS/AM.
        if (isAllCaps(surface) && found === found.toLowerCase() && ENGLISH_WORDS.has(found.toLowerCase())) continue;
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
  findForRequest(req, locale, opts = {}) {
    const max = opts.max ?? 20;
    const inText = this.find(req.text || '', locale, { max });
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

module.exports = { LOCALES, DEFAULT_LOCALE, normalizeLocale, Glossary, loadGlossary, termPattern, ENGLISH_WORDS };
