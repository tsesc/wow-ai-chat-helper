#!/usr/bin/env node
// A stand-in for the Claude Code CLI, for tests. Speaks the two output formats the bridge
// uses, shaped like Claude Code 2.1.x:
//
//   -p --output-format json                one result object on stdout (prompt on stdin)
//   -p --input-format stream-json --output-format stream-json --verbose
//                                          JSON lines in, JSON lines out: system/init,
//                                          assistant, result per user turn
//   --version                              "2.1.289 (Claude Code)"
//   auth status                            {"loggedIn": true, ...} (false with
//                                          FAKE_CLAUDE_LOGGED_OUT=1, exit 1)
//
// The reply is built from the requests in the prompt (the JSON array after "Requests").
// Markers inside a request's text change the behavior:
//   #hang          never answer; also starts a grandchild that sleeps (tree-kill test)
//   #slow:<ms>     wait that long before answering
//   #invalid       this id's object lacks replies (every time)
//   #invalid-once  invalid the first time this id is seen, valid afterwards
//   #omit          left out of the reply when batched with others (answered when alone)
//   #garbage       the whole reply is prose, no JSON
//   #fence         the JSON is wrapped in a ```json code fence
//   #crash         exit 1 with an error on stderr, no result
//   #autherr       result with is_error: true, "Invalid API key · Please run /login"
//   #tone          replies carry an unknown tone ("friendly") and 4 entries
//   #names         "tr" translates every [Name] of the text (drops it) every time
//   #names-once    "tr" translates the [Name]s the first time this id is seen only
//   #linkreply     the first reply asks about the first link token of the text
//                  ("how much for [I1]?"), its "tr" and a term use the token too
//
// Replies use the field names of spec 3.2 (tr, terms[].tr, replies[].tr). The turn log
// carries the "Player language" of the prompt (lang) and the prompt itself.
//
// Env: FAKE_CLAUDE_LOG  append one JSON line per process start and per turn
//      FAKE_CLAUDE_STATE a folder for "seen" counters (#invalid-once)
//      FAKE_CLAUDE_LOGGED_OUT  `auth status` reports loggedIn: false
'use strict';

const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const readline = require('readline');

const argv = process.argv.slice(2);
if (argv.includes('--version')) { console.log('2.1.289 (Claude Code)'); process.exit(0); }
if (argv[0] === 'auth' && argv[1] === 'status') {
  const out = !!process.env.FAKE_CLAUDE_LOGGED_OUT;
  console.log(JSON.stringify(out ? { loggedIn: false, authMethod: 'none', apiProvider: 'firstParty' }
    : { loggedIn: true, authMethod: 'claude.ai', apiProvider: 'firstParty', subscriptionType: 'max' }, null, 2));
  process.exit(out ? 1 : 0);
}

const has = (f) => argv.includes(f);
const val = (f) => { const i = argv.indexOf(f); return i >= 0 ? argv[i + 1] : undefined; };
const persistent = val('--input-format') === 'stream-json';
const model = val('--model') || 'default';
const SESSION = '0f0e0d0c-0000-4000-8000-' + String(process.pid).padStart(12, '0');
const MODEL_ID = model === 'sonnet' ? 'claude-sonnet-4-5-20250929' : 'claude-haiku-4-5-20251001';

function log(obj) {
  if (!process.env.FAKE_CLAUDE_LOG) return;
  fs.appendFileSync(process.env.FAKE_CLAUDE_LOG, JSON.stringify({ pid: process.pid, ...obj }) + '\n');
}

log({
  event: 'start', mode: persistent ? 'persistent' : 'oneshot', model, args: argv, cwd: process.cwd(),
  thinking: process.env.MAX_THINKING_TOKENS ?? null,
  promptHead: (val('--system-prompt') || '').slice(0, 400),
  flags: { tools: val('--tools'), settingSources: val('--setting-sources'), strictMcp: has('--strict-mcp-config'), noSession: has('--no-session-persistence'), verbose: has('--verbose'), systemPrompt: (val('--system-prompt') || '').length },
});

function seen(id) {
  const dir = process.env.FAKE_CLAUDE_STATE;
  if (!dir) return 0;
  fs.mkdirSync(dir, { recursive: true });
  const f = path.join(dir, 'seen-' + id);
  let n = 0; try { n = Number(fs.readFileSync(f, 'utf8')) || 0; } catch {}
  fs.writeFileSync(f, String(n + 1));
  return n;
}

// The requests array follows the "Requests" line (a known-terms block may come first).
function requestsOf(prompt) {
  const r = prompt.lastIndexOf('Requests');
  const i = prompt.indexOf('[', r < 0 ? 0 : r);
  try { return JSON.parse(prompt.slice(i)); } catch { return []; }
}

function answer(req, alone) {
  const t = String(req.text || '');
  if (t.includes('#omit') && !alone) return null;
  if (t.includes('#invalid') && !t.includes('#invalid-once')) return { id: req.id, kind: req.kind, tr: '壞掉' };
  if (t.includes('#invalid-once') && seen(req.id) === 0) return { id: req.id, kind: req.kind, tr: '壞掉' };
  const replies = [
    { en: 'inv pls', tr: '請邀我', tone: 'casual' },
    { en: 'Hi, could I get an invite?', tr: '嗨，可以邀我嗎？', tone: 'polite' },
  ];
  if (t.includes('#tone')) {
    replies[0].tone = 'friendly';
    replies.push({ en: 'inv', tr: '邀', tone: 'short' }, { en: 'extra', tr: '多的', tone: 'short' });
  }
  const link = t.includes('#linkreply') ? (/\[I\d+\]/.exec(t) || [])[0] : undefined;
  if (link) replies[0] = { en: 'how much for ' + link + '?', tr: link + ' 多少錢？', tone: 'casual' };
  if (req.kind === 'x') {
    const terms = /LF1M/.test(t) ? [{ term: 'LF1M', expansion: 'Looking For 1 More', tr: '還缺一人' }] : [];
    const translate = (t.includes('#names') && !t.includes('#names-once')) || (t.includes('#names-once') && seen('names-' + req.id) === 0);
    const tr = '譯：' + (translate ? t.replace(/\[[^\]]*\]/g, '某物品') : t);
    if (link) terms.push({ term: link, expansion: '', tr: '物品' });
    return { id: req.id, kind: 'x', tr, terms, replies };
  }
  if (req.kind === 't') return { id: req.id, kind: 't', replies: [{ en: 'omw, 5 min', tr: '我在路上，5 分鐘', tone: 'short' }, ...replies] };
  if (req.kind === 'd') return { id: req.id, kind: 'd', detail: '語氣：輕鬆\n情境：' + t + '\n建議：回 ty' };
  return null;
}

function usage(out) {
  return { input_tokens: 1200, cache_creation_input_tokens: 0, cache_read_input_tokens: 0, output_tokens: out, service_tier: 'standard' };
}

// prompt -> Promise<{ text, isError } | 'hang' | 'crash'>
async function respond(prompt) {
  const reqs = requestsOf(prompt);
  const all = reqs.map(r => String(r.text || '')).join(' ');
  const lang = (/^Player language: (\w+)/m.exec(prompt) || [])[1] || null;
  log({ event: 'turn', ids: reqs.map(r => r.id), kinds: reqs.map(r => r.kind), lang, prompt });
  const slow = /#slow:(\d+)/.exec(all);
  if (slow) await new Promise(r => setTimeout(r, Number(slow[1])));
  if (all.includes('#hang')) {
    const gc = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore' });
    log({ event: 'grandchild', grandchild: gc.pid });
    return 'hang';
  }
  if (all.includes('#crash')) return 'crash';
  if (all.includes('#autherr')) return { text: 'Invalid API key · Please run /login', isError: true };
  if (all.includes('#garbage')) return { text: 'Sure! Here is what that means: it is a group invite.', isError: false };
  const alone = reqs.length === 1;
  const arr = reqs.map(r => answer(r, alone)).filter(Boolean);
  let text = JSON.stringify(arr);
  if (all.includes('#fence')) text = '```json\n' + text + '\n```';
  return { text, isError: false };
}

function resultEvent(r, ms) {
  return {
    type: 'result', subtype: r.isError ? 'error_during_execution' : 'success', is_error: r.isError,
    api_error_status: null, duration_ms: ms + 300, duration_api_ms: ms, num_turns: 1, result: r.text,
    stop_reason: 'end_turn', session_id: SESSION, total_cost_usd: 0.0021, usage: usage(200),
    modelUsage: { [MODEL_ID]: { inputTokens: 1200, outputTokens: 200, costUSD: 0.0021 } },
    permission_denials: [], terminal_reason: 'completed', uuid: 'a1b2c3d4-0000-4000-8000-000000000001',
  };
}

function write(obj) { process.stdout.write(JSON.stringify(obj) + '\n'); }

async function oneShot() {
  let prompt = '';
  process.stdin.setEncoding('utf8');
  for await (const chunk of process.stdin) prompt += chunk;
  const r = await respond(prompt);
  if (r === 'hang') { setInterval(() => {}, 1000); return; }
  if (r === 'crash') { process.stderr.write('Error: boom\n'); process.exit(1); }
  process.stdout.write(JSON.stringify(resultEvent(r, 900)));
  process.exit(r.isError ? 1 : 0);
}

function persistentMode() {
  let inited = false;
  let chain = Promise.resolve();
  const rl = readline.createInterface({ input: process.stdin });
  rl.on('line', (line) => {
    let msg; try { msg = JSON.parse(line); } catch { return; }
    if (msg.type !== 'user' || !msg.message) return;
    const content = msg.message.content;
    const prompt = typeof content === 'string' ? content : (content || []).filter(c => c.type === 'text').map(c => c.text).join('');
    chain = chain.then(async () => {
      if (!inited) {
        inited = true;
        write({ type: 'system', subtype: 'init', cwd: process.cwd(), session_id: SESSION, tools: [], mcp_servers: [], model: MODEL_ID, permissionMode: 'default', slash_commands: [], apiKeySource: 'none', claude_code_version: '2.1.289', output_style: 'default', agents: [], skills: [], plugins: [], uuid: 'a1b2c3d4-0000-4000-8000-000000000000' });
      }
      const r = await respond(prompt);
      if (r === 'hang') { await new Promise(() => {}); return; }
      if (r === 'crash') { process.stderr.write('Error: boom\n'); process.exit(1); }
      write({
        type: 'assistant', session_id: SESSION, parent_tool_use_id: null, uuid: 'a1b2c3d4-0000-4000-8000-000000000002',
        message: { id: 'msg_fake' + Date.now(), type: 'message', role: 'assistant', model: MODEL_ID, content: [{ type: 'text', text: r.text }], stop_reason: null, stop_sequence: null, usage: usage(200) },
      });
      write(resultEvent(r, 700));
    });
  });
  rl.on('close', () => { chain.then(() => process.exit(0)); });
}

if (persistent) persistentMode(); else oneShot();
