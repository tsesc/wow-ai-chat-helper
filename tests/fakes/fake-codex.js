#!/usr/bin/env node
// A stand-in for the OpenAI Codex CLI, for tests. Speaks what the codex provider uses,
// shaped like codex-cli 0.154.0 (captured from a real run):
//
//   exec --json ... -        prompt on stdin; JSON lines on stdout: thread.started,
//                            turn.started, item.completed (agent_message), turn.completed
//   login status             "Logged in using ChatGPT" on stderr, exit 0
//                            ("Not logged in", exit 1, with FAKE_CODEX_LOGGED_OUT=1)
//   --version                "codex-cli 0.154.0" (or FAKE_CODEX_VERSION)
//
// The reply is a valid JSON array for the requests in the prompt (the array after
// "Requests"); with no such array it is "pong". Markers in the prompt change the behavior:
//   #empty        turn.completed with an empty agent message
//   #exit         an error event, turn.failed, exit 1
//   #autherr      transient "Reconnecting..." errors, then turn.failed with a 401, exit 1
//   #notjson      plain text on stdout, no JSON lines, exit 0
//   #crash        "Error: boom" on stderr, exit 2, no events
//   #preamble     a short agent message first, the real answer as the last one
//   #reconnect    a transient error event before a normal answer
//   #hang         never answer
//
// Env: FAKE_CODEX_LOG  append one JSON line per run (args, the -c developer_instructions,
//                      the prompt) for the tests to inspect
'use strict';

const fs = require('fs');

const argv = process.argv.slice(2);
if (argv.includes('--version')) { console.log('codex-cli ' + (process.env.FAKE_CODEX_VERSION || '0.154.0')); process.exit(0); }
if (argv[0] === 'login' && argv[1] === 'status') {
  if (process.env.FAKE_CODEX_LOGGED_OUT) { process.stderr.write('Not logged in\n'); process.exit(1); }
  process.stderr.write('Logged in using ChatGPT\n');
  process.exit(0);
}
if (argv[0] !== 'exec') { process.stderr.write('fake-codex: unsupported ' + argv.join(' ') + '\n'); process.exit(2); }

const configs = [];
for (let i = 0; i < argv.length; i++) if (argv[i] === '-c') configs.push(argv[i + 1]);
const devCfg = configs.find(c => c.startsWith('developer_instructions=')) || '';
const developer = devCfg ? JSON.parse(devCfg.slice('developer_instructions='.length)) : null;
const val = (f) => { const i = argv.indexOf(f); return i >= 0 ? argv[i + 1] : undefined; };

function write(obj) { process.stdout.write(JSON.stringify(obj) + '\n'); }

function requestsOf(prompt) {
  const r = prompt.lastIndexOf('Requests');
  if (r < 0) return null;
  const i = prompt.indexOf('[', r);
  try { return JSON.parse(prompt.slice(i)); } catch { return null; }
}

function answer(req) {
  const replies = [{ en: 'inv pls', tr: '請邀我', tone: 'casual' }, { en: 'can i join?', tr: '我可以加入嗎？', tone: 'polite' }];
  if (req.kind === 'x') return { id: req.id, kind: 'x', tr: '譯：' + req.text, terms: [], replies };
  if (req.kind === 't') return { id: req.id, kind: 't', replies };
  return { id: req.id, kind: 'd', detail: '語氣：輕鬆\n情境：' + req.text + '\n建議：回 ty' };
}

async function main() {
  let prompt = '';
  process.stdin.setEncoding('utf8');
  for await (const chunk of process.stdin) prompt += chunk;
  if (process.env.FAKE_CODEX_LOG) {
    fs.appendFileSync(process.env.FAKE_CODEX_LOG, JSON.stringify({ pid: process.pid, args: argv, cwd: process.cwd(), model: val('-m') || null, developer, prompt }) + '\n');
  }
  if (prompt.includes('#hang')) { setInterval(() => {}, 1000); return; }
  if (prompt.includes('#crash')) { process.stderr.write('Error: boom\n'); process.exit(2); }
  if (prompt.includes('#notjson')) { process.stdout.write('Sure! pong\n'); process.exit(0); }
  write({ type: 'thread.started', thread_id: '01a1192d-00e9-7d13-8082-0149bf6d33ce' });
  write({ type: 'turn.started' });
  if (prompt.includes('#autherr')) {
    write({ type: 'error', message: 'Reconnecting... 2/5 (unexpected status 401 Unauthorized: Missing bearer or basic authentication in header)' });
    write({ type: 'turn.failed', error: { message: 'unexpected status 401 Unauthorized: Missing bearer or basic authentication in header' } });
    process.exit(1);
  }
  if (prompt.includes('#exit')) {
    write({ type: 'error', message: 'stream disconnected before completion' });
    write({ type: 'turn.failed', error: { message: 'stream disconnected before completion' } });
    process.exit(1);
  }
  if (prompt.includes('#reconnect')) write({ type: 'error', message: 'Reconnecting... 1/5 (stream disconnected)' });
  if (prompt.includes('#preamble')) write({ type: 'item.completed', item: { id: 'item_0', type: 'agent_message', text: 'Let me answer that.' } });
  const reqs = requestsOf(prompt);
  let text = reqs ? JSON.stringify(reqs.map(answer)) : 'pong';
  if (prompt.includes('#empty')) text = '';
  write({ type: 'item.completed', item: { id: 'item_1', type: 'agent_message', text } });
  write({ type: 'turn.completed', usage: { input_tokens: 16094, cached_input_tokens: 0, cache_write_input_tokens: 0, output_tokens: 5, reasoning_output_tokens: 0 } });
  process.exit(0);
}

main();
