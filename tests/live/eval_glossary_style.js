#!/usr/bin/env node
// Live eval of explanations + reply style against the real Claude Code CLI (not part of
// `npm test`). Needs `claude` installed and logged in.
//
//   run    the real bridge AiRunner (persistent haiku, MAX_THINKING_TOKENS=0, the real
//          glossary from data/glossary/terms.json, batchWindowMs/maxBatch as the bridge)
//          over data/eval/messages.json: all 50 for zhTW, a fixed 15 for zhCN and deDE.
//          Calls: 7 + 2 + 2 persistent turns (+ one-shot retries for invalid items).
//   judge  one Sonnet one-shot call per batch of 8 graded items: meaning vs mustMention,
//          terms, reply naturalness (1-5, US-realm WoW chat), explanation language.
//
//   node tests/live/eval_glossary_style.js [--tag before] [--out DIR] [--only run|judge]
//        [--locales zhTW,zhCN,deDE] [--limit N] [--holdout] [--ai PATH]
//
//   --holdout  run only the 8 HOLDOUT lines below (zhTW): lines written after the prompt was
//              tuned on the first run, to check the tuning did not just fit the eval set.
//   --ai PATH  use another copy of bridge/ai.js (e.g. the pre-tuning prompt) for the run.
//
// Outputs (DIR defaults to $TMPDIR/wch-eval): <tag>-outputs.json, <tag>-grades.json,
// <tag>-meta.json (runner stats, ms per batch turn, [Name] verbatim count) and a summary
// on stdout.
'use strict';

const os = require('os');
const path = require('path');
const fs = require('fs');
const AI_PATH = (() => { const i = process.argv.indexOf('--ai'); return i >= 0 ? process.argv[i + 1] : ''; })();
const ai = require(AI_PATH ? path.resolve(AI_PATH) : '../../bridge/ai');

const argv = process.argv.slice(2);
const opt = (name, dflt) => { const i = argv.indexOf('--' + name); return i >= 0 ? argv[i + 1] : dflt; };
const TAG = opt('tag', 'run');
const HOLDOUT_ONLY = argv.includes('--holdout');
const OUT = opt('out', path.join(os.tmpdir(), 'wch-eval'));
const ONLY = opt('only', '');
const LIMIT = Number(opt('limit', '0')) || 0;
const LOCS = opt('locales', argv.includes('--holdout') ? 'zhTW' : 'zhTW,zhCN,deDE').split(',');

const ROOT = path.join(__dirname, '..', '..');
const EVAL = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'eval', 'messages.json'), 'utf8'));
// Held-out lines (numbered 101+), not used while tuning the prompt.
const HOLDOUT = [
  { channel: 'CHANNEL:Trade - City', sender: 'Vendr', text: 'ah is lagging so bad rn', mustMention: ["'ah' = Auction House", 'the Auction House is very slow right now'] },
  { channel: 'PARTY', sender: 'Oops', text: 'ah lol my bad', mustMention: ["'ah' is an interjection, not the Auction House", 'apologizing for a mistake'] },
  { channel: 'CHANNEL:LookingForGroup', sender: 'Lightfist', text: 'ret pally lf group for zf', mustMention: ['ret = Retribution (damage) paladin', 'lf = looking for', "zf = Zul'Farrak dungeon"] },
  { channel: 'WHISPER', sender: 'Tinker', text: 'can i get a port to if? will tip', mustMention: ['port = mage portal (teleport)', 'IF = Ironforge', 'will pay a tip'] },
  { channel: 'PARTY', sender: 'Bulwark', text: "who's tanking? i can ot", mustMention: ['asks who is main tank', 'ot = off-tank: they can be the second tank'] },
  { channel: 'RAID', sender: 'Raidlead', text: 'bring fr pots for rag', mustMention: ['fr = fire resistance (potions)', 'rag = Ragnaros, Molten Core final boss'] },
  { channel: 'CHANNEL:Trade - City', sender: 'Glyph', text: 'LF ench for +25 agi 2h, my mats, tip', mustMention: ['looking for an enchanter', '+25 Agility on a two-handed weapon', 'they supply materials and tip'] },
  { channel: 'GUILD', sender: 'Oldtimer', text: 'anyone down for a strat ud run?', mustMention: ["'down for' = willing to join", 'Stratholme Undead side'] },
];
const MESSAGES = [...EVAL, ...Array(100 - EVAL.length).fill(null), ...HOLDOUT];
// 1-based message numbers for the 15-message subsets: the AH cases (1, 36, 37, 38),
// trade, LFG, loot, summon, world buff, insults, memes, battleground, a wipe.
const SUBSET = [1, 2, 4, 7, 9, 11, 13, 19, 20, 24, 36, 37, 38, 42, 46];
const LANG_NAME = { zhTW: 'Traditional Chinese (Taiwan)', zhCN: 'Simplified Chinese (mainland)', deDE: 'German' };

fs.mkdirSync(OUT, { recursive: true });
const outFile = path.join(OUT, `${TAG}-outputs.json`);
const gradeFile = path.join(OUT, `${TAG}-grades.json`);

function pick(locale) {
  let nums = HOLDOUT_ONLY ? HOLDOUT.map((_, i) => 101 + i) : locale === 'zhTW' ? EVAL.map((_, i) => i + 1) : SUBSET;
  if (LIMIT) nums = nums.slice(0, LIMIT);
  return nums;
}

async function run() {
  const workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wch-eval-cwd-'));
  const log = (s) => console.log('  ' + s);
  const runner = new ai.AiRunner({ workDir, timeoutMs: 180000, persistent: true, maxThinkingTokens: 0, log });
  if (!runner.cmd.found) { console.error('claude not found:', runner.cmd.note); process.exit(1); }
  console.log(`glossary: ${runner.glossary.file} (${runner.glossary.terms ? runner.glossary.terms.length : '?'} terms)`);
  // Time every persistent batch turn (latency per batch, retries excluded).
  const batchMs = [];
  const runBatch = runner.runBatch.bind(runner);
  runner.runBatch = async (batch, ...rest) => {
    const t = Date.now();
    try { return await runBatch(batch, ...rest); } finally { batchMs.push({ n: batch.length, ms: Date.now() - t }); }
  };
  const results = [];
  try {
    for (const locale of LOCS) {
      const nums = pick(locale);
      console.log(`\n${locale}: ${nums.length} messages`);
      const t0 = Date.now();
      // Submit all at once: the runner batches them maxBatch (8) per persistent turn.
      const outs = await Promise.all(nums.map((n) => {
        const m = MESSAGES[n - 1];
        return runner.request({ id: n, kind: 'x', channel: m.channel, sender: m.sender, ctx: '', text: m.text, lang: locale });
      }));
      console.log(`  ${locale} done in ${Date.now() - t0} ms`);
      nums.forEach((n, i) => results.push({ locale, n, text: MESSAGES[n - 1].text, out: outs[i] }));
    }
  } finally { runner.stop(); }
  console.log(`\nstats: ${JSON.stringify(runner.stats)}`);
  const avg = batchMs.length ? Math.round(batchMs.reduce((s, b) => s + b.ms, 0) / batchMs.length) : 0;
  console.log(`batches: ${batchMs.length}, avg ${avg} ms per batch (${batchMs.map(b => b.n + ':' + b.ms).join(' ')})`);
  // Game link names: items with a [Name] whose final "tr" holds every name verbatim.
  const linked = results.filter(r => ai.bracketNames(r.text).length);
  const verbatim = linked.filter(r => r.out && r.out.status === 'done' && !ai.missingNames(r.out, { kind: 'x', text: r.text }).length);
  console.log(`link names: ${verbatim.length}/${linked.length} items verbatim in the final tr; first-pass misses (nameRetries) ${runner.stats.nameRetries}, appended ${runner.stats.namesAppended}`);
  fs.writeFileSync(path.join(OUT, `${TAG}-meta.json`), JSON.stringify({ stats: runner.stats, batchMs, avgBatchMs: avg, linked: linked.length, verbatim: verbatim.length }, null, 1));
  fs.writeFileSync(outFile, JSON.stringify(results, null, 1));
  console.log(`outputs -> ${outFile}`);
}

const JUDGE_PROMPT = `You grade an AI chat helper for World of Warcraft (Classic-era, level 60, US realms). For each chat line it gave: "tr" = explanation in the player's language, "terms" = jargon glossary, "replies" = English reply candidates the player can send.
Grade each item strictly and return ONLY a JSON array, one object per item, same order:
{"n": <n>, "meaning": 0|1, "terms": 0|1, "natural": 1-5, "language": 0|1, "note": "<short English reason for any failure, else empty>"}
- meaning: 1 only if the explanation gets the core meaning right per mustMention (missing a minor detail is ok; a wrong reading of any key jargon, e.g. 'ah' as an interjection where it is the Auction House, is 0).
- terms: 1 if the terms listed are correct and the key jargon in the line is covered with correct expansions; 0 for a wrong expansion or a missing key term.
- natural: how natural the English replies are as US-realm WoW chat (5 = exactly what a native US player types: short, lowercase, real shorthand, sensible for the situation; 3 = understandable but textbook/stiff or slightly off; 1 = wrong or unnatural). Also penalize replies that don't fit the situation, insults, or retail-only slang.
- language: 1 if "tr", term "tr" and reply "tr" are all in the expected language (correct script: Traditional vs Simplified Chinese), using natural gamer wording; 0 otherwise.
No prose, no code fences.`;

async function judge() {
  const results = JSON.parse(fs.readFileSync(outFile, 'utf8'));
  const cmd = ai.resolveCommand(process.env.CLAUDE_PATH || '');
  const workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wch-judge-cwd-'));
  const opts = { workDir, timeoutMs: 240000, systemPrompt: JUDGE_PROMPT, maxThinkingTokens: 0 };
  const grades = [];
  for (const locale of LOCS) {
    const items = results.filter(r => r.locale === locale);
    for (let i = 0; i < items.length; i += 8) {
      const chunk = items.slice(i, i + 8);
      const payload = chunk.map(r => {
        const m = MESSAGES[r.n - 1];
        const o = r.out || {};
        return { n: r.n, channel: m.channel, text: m.text, mustMention: m.mustMention,
          output: o.status === 'done' ? { tr: o.tr, terms: o.terms, replies: o.replies } : { error: o.err || 'no result' } };
      });
      const prompt = `Expected explanation language: ${LANG_NAME[locale] || locale}.\nItems:\n${JSON.stringify(payload, null, 1)}`;
      const t0 = Date.now();
      const r = await ai.runOnce(cmd, 'sonnet', prompt, opts);
      const arr = r.ok ? ai.extractJson(r.text) : null;
      console.log(`  judge ${locale} ${i / 8 + 1}: ${Date.now() - t0} ms ${arr ? arr.length + ' grades' : 'FAILED ' + (r.err || r.text.slice(0, 200))}`);
      for (const c of chunk) {
        const g = (arr || []).find(x => Number(x && x.n) === c.n);
        grades.push({ locale, n: c.n, ...(g || { meaning: null, terms: null, natural: null, language: null, note: 'judge missing' }) });
      }
    }
  }
  fs.writeFileSync(gradeFile, JSON.stringify(grades, null, 1));
  console.log(`grades -> ${gradeFile}`);
  summary(grades, results);
}

function summary(grades, results) {
  const pct = (a, b) => b ? (100 * a / b).toFixed(0) + '%' : '-';
  console.log(`\n=== ${TAG} ===`);
  for (const locale of [...LOCS, 'ALL']) {
    const g = grades.filter(x => (locale === 'ALL' || x.locale === locale) && x.meaning !== null);
    const sum = (k) => g.reduce((s, x) => s + Number(x[k] || 0), 0);
    const errs = results.filter(r => (locale === 'ALL' || r.locale === locale) && (!r.out || r.out.status !== 'done')).length;
    console.log(`${locale.padEnd(5)} n=${g.length} meaning ${pct(sum('meaning'), g.length)}  terms ${pct(sum('terms'), g.length)}  natural ${(sum('natural') / (g.length || 1)).toFixed(2)}  language ${pct(sum('language'), g.length)}  errors ${errs}`);
  }
  const bad = grades.filter(x => x.meaning === 0 || x.terms === 0 || x.language === 0 || (x.natural && x.natural < 4));
  for (const b of bad) {
    const r = results.find(x => x.locale === b.locale && x.n === b.n);
    console.log(`- ${b.locale} #${b.n} ${JSON.stringify(r.text)} m=${b.meaning} t=${b.terms} nat=${b.natural} lang=${b.language}: ${b.note}`);
  }
}

(async () => {
  if (ONLY !== 'judge') await run();
  if (ONLY !== 'run') await judge();
})().catch((e) => { console.error(e); process.exit(1); });
