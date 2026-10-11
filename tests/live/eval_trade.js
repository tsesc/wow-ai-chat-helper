#!/usr/bin/env node
// Live eval of trade chat (WTS/WTB/WTT, prices, haggling, CoD, crafting services, AH talk,
// gold sellers) against the real Claude Code CLI (not part of `npm test`). Needs `claude`
// installed and logged in.
//
//   run    the real bridge AiRunner (persistent haiku, MAX_THINKING_TOKENS=0, the real
//          glossary, bridge batching) over data/eval/trade.json (38 lines, kind "x", zhTW)
//          and data/eval/trade-translate.json (10 lines, kind "t", zhTW); holdouts excluded.
//          Calls: 6 persistent turns (48 requests, 8 per turn; x and t share batches),
//          plus one-shot retries for invalid items.
//   rules  no model: per explain item
//            price   every mustInTr group has one alternative in "tr" (spaces removed)
//            reply   no reply takes the wrong side (e.g. "wts ..." to a seller's ad)
//            struct  the optional "trade" field: side, price (gold), per, qty
//          per translate item: a reply matches every "must" regex and no "mustNot".
//   judge  one Sonnet one-shot per 8 explain items: side (who buys/sells/crafts), price
//          (amount, unit, each vs total), reply (replies speak as the right party), natural.
//          Calls: 5.
//
//   node tests/live/eval_trade.js [--tag before] [--out DIR] [--only run|judge|score]
//        [--ai PATH] [--limit N] [--holdout | --holdout-old]
//
//   --holdout      the 12 + 6 cases of trade-holdout.json / trade-translate-holdout.json
//                  (written after the prompt was final): 2 + 1 turns, 2 judge calls
//   --holdout-old  the 8 + 3 cases marked "holdout" in trade.json / trade-translate.json
//   --ai PATH  another copy of bridge/ai.js, e.g. a checkout of an older commit
//
// Outputs (DIR defaults to $TMPDIR/wch-eval): trade-<tag>-outputs.json,
// trade-<tag>-grades.json and a summary per category on stdout.
'use strict';

const os = require('os');
const path = require('path');
const fs = require('fs');

const argv = process.argv.slice(2);
const opt = (name, dflt) => { const i = argv.indexOf('--' + name); return i >= 0 ? argv[i + 1] : dflt; };
const AI_PATH = opt('ai', '');
const ai = require(AI_PATH ? path.resolve(AI_PATH) : '../../bridge/ai');
const TAG = opt('tag', 'run');
const OUT = opt('out', path.join(os.tmpdir(), 'wch-eval'));
const ONLY = opt('only', '');
const LIMIT = Number(opt('limit', '0')) || 0;

const ROOT = path.join(__dirname, '..', '..');
const load = (f) => JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'eval', f), 'utf8'));
// Sets: default = trade.json / trade-translate.json without "holdout" entries (the tuning
// set; the prompt examples leaked into it until r3, see docs/research/eval-results.md);
// --holdout-old = the entries marked "holdout" (written after r3, before the final
// prompt); --holdout = trade-holdout.json / trade-translate-holdout.json, written after
// the prompt was final and never used to change it.
const HOLDOUT_OLD = argv.includes('--holdout-old');
const HOLDOUT = argv.includes('--holdout');
let CASES = HOLDOUT ? load('trade-holdout.json') : load('trade.json').filter(c => !!c.holdout === HOLDOUT_OLD);
let TCASES = HOLDOUT ? load('trade-translate-holdout.json') : load('trade-translate.json').filter(c => !!c.holdout === HOLDOUT_OLD);
if (LIMIT) { CASES = CASES.slice(0, LIMIT); TCASES = TCASES.slice(0, Math.ceil(LIMIT / 4)); }
const T_BASE = 201; // ids of the translate items

fs.mkdirSync(OUT, { recursive: true });
const outFile = path.join(OUT, `trade-${TAG}-outputs.json`);
const gradeFile = path.join(OUT, `trade-${TAG}-grades.json`);

async function run() {
  const workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wch-eval-cwd-'));
  const runner = new ai.AiRunner({ workDir, timeoutMs: 180000, persistent: true, maxThinkingTokens: 0, log: (s) => console.log('  ' + s) });
  if (!runner.cmd.found) { console.error('claude not found:', runner.cmd.note); process.exit(1); }
  const t0 = Date.now();
  let xs, ts;
  try {
    xs = Promise.all(CASES.map((c, i) => runner.request({ id: i + 1, kind: 'x', channel: c.channel, sender: c.sender, ctx: c.ctx || '', text: c.text, lang: 'zhTW' })));
    ts = Promise.all(TCASES.map((c, i) => runner.request({ id: T_BASE + i, kind: 't', channel: c.channel, sender: c.sender, ctx: c.ctx || '', text: c.text, lang: 'zhTW' })));
    [xs, ts] = await Promise.all([xs, ts]);
  } finally { runner.stop(); }
  console.log(`done in ${Date.now() - t0} ms, stats: ${JSON.stringify(runner.stats)}`);
  const results = [
    ...CASES.map((c, i) => ({ kind: 'x', n: i + 1, cat: c.cat, text: c.text, out: xs[i] })),
    ...TCASES.map((c, i) => ({ kind: 't', n: T_BASE + i, cat: 'translate', text: c.text, out: ts[i] })),
  ];
  fs.writeFileSync(outFile, JSON.stringify({ stats: runner.stats, results }, null, 1));
  console.log(`outputs -> ${outFile}`);
}

// ------------------------------------------------------------------ rules (no model)

// Replies that speak as the wrong party, by the role the player has toward the speaker.
const WRONG_SIDE = {
  buyer: /\b(wts|wtb|selling|i sell|ill sell|i'll sell|pst me)\b/i,
  seller: /\b(wtb|buying|ill take|i'll take|how much (for|is|are))\b/i,
  crafter: /\b(lf|looking for|anyone can|can (u|you) (do|make|craft|put)|need (an? )?(ench|enchanter|alch|bs|crafter))\b/i,
  customer: /\b(i can (do|make|craft)|can do it|wts)\b/i,
  trader: /\b(wts|wtb)\b/i,
};
const SCAM_ENGAGE = /\b(how much|price|discord|site|link|\$|deal)\b/i;

const squash = (s) => String(s || '').replace(/\s+/g, '').toLowerCase();
const sides = (c) => (Array.isArray(c.side) ? c.side : [c.side]);

function ruleScore(c, o) {
  if (!o || o.status !== 'done') return { price: 0, reply: 0, struct: null };
  const tr = squash(o.tr);
  const price = (c.mustInTr || []).every(g => g.some(alt => tr.includes(squash(alt)))) ? 1 : 0;
  const en = o.replies.map(r => r.en);
  let reply = 1;
  if (WRONG_SIDE[c.replyAs] && en.some(e => WRONG_SIDE[c.replyAs].test(e))) reply = 0;
  if (c.cat === 'scam' && c.replyAs === 'none' && en.some(e => SCAM_ENGAGE.test(e))) reply = 0;
  let struct = null;
  if (o.trade && typeof o.trade === 'object') {
    const t = o.trade;
    const sideOk = sides(c).includes(t.side || 'none');
    let priceOk = true;
    // A line with two prices ("1g50s each or 30g for a stack") may be read either way.
    // A missing price, per or qty counts as wrong when the case expects one.
    const priceIs = (p) => t.price != null && Math.abs(Number(t.price) - p.gold) < 0.011 && t.per === p.per;
    if (c.price) priceOk = [c.price, c.priceAlt].some(p => p && priceIs(p));
    const qtyOk = c.qty == null || (t.qty != null && Number(t.qty) === c.qty);
    struct = { side: sideOk ? 1 : 0, price: priceOk && qtyOk ? 1 : 0 };
  } else if (sides(c).includes('none')) struct = { side: 1, price: 1 }; // no field = not a trade line
  else struct = { side: 0, price: 0, missing: true };
  return { price, reply, struct };
}

function translateScore(c, o) {
  if (!o || o.status !== 'done') return { any: 0, first: 0 };
  const ok = (en) => c.must.every(r => new RegExp(r, 'i').test(en)) && !(c.mustNot || []).some(r => new RegExp(r, 'i').test(en));
  const en = o.replies.map(r => r.en);
  return { any: en.some(ok) ? 1 : 0, first: ok(en[0]) ? 1 : 0, all: en.filter(ok).length / en.length };
}

// ------------------------------------------------------------------ judge (Sonnet)

const JUDGE_PROMPT = `You grade an AI chat helper for World of Warcraft (Classic-era, level 60, US realms) on TRADE chat. The player is a Taiwanese beginner. For each incoming line the helper gave: "tr" = explanation in Traditional Chinese, "replies" = English replies the player could send back to the speaker. "expected" says who the speaker is (side), the price reading and which role the player takes when replying (replyAs).
Return ONLY a JSON array, one object per item, same order:
{"n": <n>, "side": 0|1, "price": 0|1|null, "reply": 0|1, "natural": 1-5, "note": "<short English reason for any failure, else empty>"}
- side: 1 only if "tr" makes clear what the speaker is doing: selling, buying, trading/swapping, looking for a crafter (craft-request) or offering to craft (craft-offer); for "none" (AH talk, spam) it must not invent a trade offer, and spam must be called spam/scam. Any reversal (buyer described as seller, request described as offer) is 0.
- price: null if expected price is null. Else 1 only if "tr" gets the amount and unit right (k = thousand, s = silver, c = copper) and whether it is per item, per stack or total; when expected.total is given and qty > 1 the explanation should not contradict it (stating the total is a plus). A wrong number or each/total mix-up is 0.
- reply: 1 if every reply is something the player says AS expected.replyAs to this speaker (buyer: asks price/haggles/takes it; seller: offers the item/quotes a price; crafter: offers to do it; customer: asks for the craft/tip/mats; trader: discusses the swap; none: neutral/no engagement with scams). One reply taking the speaker's own side (e.g. "wts" back to a seller, "lf enchanter" back to someone looking for an enchanter) is 0.
- natural: how natural the English replies are as US-realm WoW trade chat (5 = exactly what a native types: short, lowercase, "how much for 5?", "would u do 20g ea?", "can do, omw"; 3 = understandable but stiff; 1 = wrong).
No prose, no code fences.`;

async function judge() {
  const { results } = JSON.parse(fs.readFileSync(outFile, 'utf8'));
  const cmd = ai.resolveCommand(process.env.CLAUDE_PATH || '');
  const workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wch-judge-cwd-'));
  const opts = { workDir, timeoutMs: 240000, systemPrompt: JUDGE_PROMPT, maxThinkingTokens: 0 };
  const items = results.filter(r => r.kind === 'x');
  const grades = [];
  for (let i = 0; i < items.length; i += 8) {
    const chunk = items.slice(i, i + 8);
    const payload = chunk.map(r => {
      const c = CASES[r.n - 1];
      const o = r.out || {};
      return { n: r.n, channel: c.channel, ctx: c.ctx || '', text: c.text,
        expected: { side: c.side, qty: c.qty, price: c.price, total: c.total, replyAs: c.replyAs, mustMention: c.mustMention },
        output: o.status === 'done' ? { tr: o.tr, replies: o.replies.map(x => x.en) } : { error: o.err || 'no result' } };
    });
    const t0 = Date.now();
    const r = await ai.runOnce(cmd, 'sonnet', `Items:\n${JSON.stringify(payload, null, 1)}`, opts);
    const arr = r.ok ? ai.extractJson(r.text) : null;
    console.log(`  judge ${i / 8 + 1}: ${Date.now() - t0} ms ${arr ? arr.length + ' grades' : 'FAILED ' + (r.err || r.text.slice(0, 200))}`);
    for (const c of chunk) {
      const g = (arr || []).find(x => Number(x && x.n) === c.n);
      grades.push({ n: c.n, ...(g || { side: null, price: null, reply: null, natural: null, note: 'judge missing' }) });
    }
  }
  fs.writeFileSync(gradeFile, JSON.stringify(grades, null, 1));
  console.log(`grades -> ${gradeFile}`);
}

// ------------------------------------------------------------------ summary

function score() {
  const { results, stats } = JSON.parse(fs.readFileSync(outFile, 'utf8'));
  const grades = fs.existsSync(gradeFile) ? JSON.parse(fs.readFileSync(gradeFile, 'utf8')) : [];
  const pct = (a, b) => (b ? Math.round(100 * a / b) + '%' : '-').padStart(5);
  const rows = results.filter(r => r.kind === 'x').map(r => {
    const c = CASES[r.n - 1];
    return { r, c, rule: ruleScore(c, r.out), g: grades.find(x => x.n === r.n) || {} };
  });
  const cats = [...new Set(CASES.map(c => c.cat)), 'ALL'];
  console.log(`\n=== trade ${TAG} (stats ${JSON.stringify(stats)}) ===`);
  console.log('cat            n | judge: side price reply natural | rules: price reply | struct: side price');
  for (const cat of cats) {
    const g = rows.filter(x => cat === 'ALL' || x.c.cat === cat);
    const jg = g.filter(x => x.g.side != null);
    const jp = jg.filter(x => x.g.price != null);
    const sum = (arr, f) => arr.reduce((s, x) => s + Number(f(x) || 0), 0);
    const st = g.filter(x => x.rule.struct);
    console.log(`${cat.padEnd(14)} ${String(g.length).padStart(2)} | ${pct(sum(jg, x => x.g.side), jg.length)} ${pct(sum(jp, x => x.g.price), jp.length)} ${pct(sum(jg, x => x.g.reply), jg.length)} ${(sum(jg, x => x.g.natural) / (jg.length || 1)).toFixed(2).padStart(7)} |` +
      ` ${pct(sum(g, x => x.rule.price), g.length)} ${pct(sum(g, x => x.rule.reply), g.length)} | ${pct(sum(st, x => x.rule.struct.side), st.length)} ${pct(sum(st, x => x.rule.struct.price), st.length)}`);
  }
  const ts = results.filter(r => r.kind === 't').map(r => ({ r, c: TCASES[r.n - T_BASE], s: translateScore(TCASES[r.n - T_BASE], r.out) }));
  const tsum = (k) => ts.reduce((s, x) => s + x.s[k], 0);
  console.log(`translate      ${String(ts.length).padStart(2)} | a reply matches the format: ${pct(tsum('any'), ts.length)}, first reply ${pct(tsum('first'), ts.length)}, all replies ${pct(tsum('all'), ts.length)}`);
  console.log('\nfailures:');
  for (const x of rows) {
    const bad = [];
    if (x.g.side === 0) bad.push('side');
    if (x.g.price === 0) bad.push('price');
    if (x.g.reply === 0) bad.push('reply');
    if (x.rule.price === 0) bad.push('rule-price');
    if (x.rule.reply === 0) bad.push('rule-reply');
    if (x.rule.struct && !x.rule.struct.missing && (!x.rule.struct.side || !x.rule.struct.price)) bad.push('struct ' + JSON.stringify(x.r.out.trade));
    if (bad.length) console.log(`- #${x.r.n} [${x.c.cat}] ${JSON.stringify(x.c.text)}: ${bad.join(', ')}${x.g.note ? ' | ' + x.g.note : ''}\n    tr: ${x.r.out && x.r.out.tr}\n    replies: ${x.r.out && x.r.out.replies ? x.r.out.replies.map(y => y.en).join(' / ') : x.r.out && x.r.out.err}`);
  }
  for (const x of ts) if (!x.s.any) console.log(`- t#${x.r.n} ${JSON.stringify(x.c.text)}: ${x.r.out && x.r.out.replies ? x.r.out.replies.map(y => y.en).join(' / ') : x.r.out && x.r.out.err}`);
}

(async () => {
  if (!ONLY || ONLY === 'run') await run();
  if (!ONLY || ONLY === 'judge') await judge();
  score();
})().catch((e) => { console.error(e); process.exit(1); });
