#!/usr/bin/env node
// Live check against the real Claude Code CLI (not part of `npm test`; run with
// `npm run test:live`). Needs `claude` installed and logged in. Makes 8 model calls:
//
//   one-shot   3 calls, one sample message each, then 1 call with all 3 batched
//   persistent 1 process, 3 turns (one sample each) + 1 batched turn
//
// Prints the exact command line, wall-clock latency per call and whether each reply
// validates against spec 3.2 (ai.matchResults). Options: --model haiku (default),
// --only oneshot|persistent, --show (print the validated JSON).
'use strict';

const os = require('os');
const path = require('path');
const fs = require('fs');
const ai = require('../../bridge/ai');

const argv = process.argv.slice(2);
const opt = (name, dflt) => { const i = argv.indexOf('--' + name); return i >= 0 ? argv[i + 1] : dflt; };
const MODEL = opt('model', 'haiku');
const ONLY = opt('only', '');
const SHOW = argv.includes('--show');

const SAMPLES = [
  { id: 1, kind: 'x', channel: 'CHANNEL:LookingForGroup', sender: 'Grimtusk', ctx: '', text: 'LF1M tank HC DM, inv' },
  { id: 2, kind: 'x', channel: 'PARTY', sender: 'Lunaria', ctx: 'Lunaria: nice pull\nGrimtusk: [Cruel Barb] dropped', text: 'need or greed?' },
  { id: 3, kind: 'x', channel: 'WHISPER', sender: 'Thalric', ctx: '', text: 'ty for the run gg' },
];

const cmd = ai.resolveCommand(process.env.CLAUDE_PATH || '');
if (!cmd.found) { console.error('claude not found:', cmd.note); process.exit(1); }
const workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wch-live-'));
const opts = { workDir, timeoutMs: 120000, persistentMaxTurns: 40, systemPrompt: ai.SYSTEM_PROMPT, maxThinkingTokens: 0 };

function shown(args) {
  return args.map(a => a === ai.SYSTEM_PROMPT ? '<SYSTEM_PROMPT>' : a === '' ? '""' : /\s/.test(a) ? JSON.stringify(a) : a).join(' ');
}

function report(label, ms, r, reqs) {
  if (!r.ok) { console.log(`  ${label}: ${ms} ms  FAILED: ${r.err}`); return { ms, ok: false }; }
  const { done, failed } = ai.matchResults(r.text, reqs);
  console.log(`  ${label}: ${ms} ms  valid ${done.size}/${reqs.length}${failed.length ? '  invalid ids: ' + failed.map(f => f.id).join(',') : ''}`);
  if (SHOW || failed.length) {
    for (const v of done.values()) console.log('    ' + JSON.stringify(v));
    if (failed.length) console.log('    raw: ' + r.text.slice(0, 600));
  }
  return { ms, ok: failed.length === 0 };
}

async function oneShot() {
  console.log(`\none-shot: ${cmd.file} ${shown(ai.claudeArgs('oneshot', MODEL))}  (prompt on stdin)`);
  const times = [];
  for (const s of SAMPLES) {
    const t0 = Date.now();
    const r = await ai.runOnce(cmd, MODEL, ai.buildPrompt([s]), opts);
    times.push(report(`#${s.id} ${JSON.stringify(s.text)}`, Date.now() - t0, r, [s]));
  }
  const t0 = Date.now();
  const r = await ai.runOnce(cmd, MODEL, ai.buildPrompt(SAMPLES), opts);
  times.push(report('batch of 3', Date.now() - t0, r, SAMPLES));
  return times;
}

async function persistent() {
  console.log(`\npersistent: ${cmd.file} ${shown(ai.claudeArgs('persistent', MODEL))}  (stream-json user turns on stdin)`);
  const p = new ai.PersistentClaude(cmd, MODEL, opts);
  const times = [];
  try {
    for (const s of SAMPLES) {
      const t0 = Date.now();
      const r = await p.turn(ai.buildPrompt([s]));
      times.push(report(`turn ${p.turns} #${s.id} ${JSON.stringify(s.text)}${p.turns === 1 ? ' (incl. process start)' : ''}`, Date.now() - t0, r, [s]));
    }
    const batch = SAMPLES.map(s => ({ ...s, id: s.id + 10 }));
    const t0 = Date.now();
    const r = await p.turn(ai.buildPrompt(batch));
    times.push(report(`turn ${p.turns} batch of 3`, Date.now() - t0, r, batch));
    console.log(`  process starts: ${p.starts} (1 = all turns ran in one process)`);
  } finally { p.stop(); }
  return times;
}

(async () => {
  console.log(`claude: ${cmd.file}  model: ${MODEL}  cwd: ${workDir}`);
  const out = {};
  if (ONLY !== 'persistent') out.oneshot = await oneShot();
  if (ONLY !== 'oneshot') out.persistent = await persistent();
  console.log('\nsummary (ms):');
  for (const [k, v] of Object.entries(out)) console.log(`  ${k.padEnd(10)} ${v.map(x => x.ms + (x.ok ? '' : '!')).join('  ')}`);
  const allOk = Object.values(out).flat().every(x => x.ok);
  fs.rmSync(workDir, { recursive: true, force: true });
  process.exit(allOk ? 0 : 1);
})();
