// Tests for bridge/providers/ (the registry, the shared CLI lookup, the Codex provider, the
// login checks of both) against tests/fakes/fake-codex.js and fake-claude.js (no network).
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const providers = require('../bridge/providers');
const codex = require('../bridge/providers/codex');
const claude = require('../bridge/providers/claude');
const ai = require('../bridge/ai');
const { Glossary } = require('../bridge/glossary');

const FAKE_CODEX = path.join(__dirname, 'fakes', 'fake-codex.js');
const FAKE_CLAUDE = path.join(__dirname, 'fakes', 'fake-claude.js');
const glossary = new Glossary(require('./fixtures/terms.json'));

function tmpdir(prefix = 'wch-prov-') { return fs.mkdtempSync(path.join(os.tmpdir(), prefix)); }

// FAKE_CODEX_LOG in a fresh folder -> { dir, runs() } (one entry per `codex exec`).
function codexLog() {
  const dir = tmpdir();
  const file = path.join(dir, 'codex.log');
  process.env.FAKE_CODEX_LOG = file;
  const runs = () => (fs.existsSync(file) ? fs.readFileSync(file, 'utf8').trim().split('\n').filter(Boolean).map(l => JSON.parse(l)) : []);
  return { dir, runs };
}

async function withEnv(name, value, fn) {
  const old = process.env[name];
  process.env[name] = value;
  try { return await fn(); } finally { if (old === undefined) delete process.env[name]; else process.env[name] = old; }
}

const alive = (pid) => { try { process.kill(pid, 0); return true; } catch { return false; } };

// ---------------------------------------------------------------------------
// Registry and interface
// ---------------------------------------------------------------------------

test('registry: list, get by name (case-insensitive), default claude, unknown name lists the valid ones', () => {
  assert.deepStrictEqual(providers.list(), ['claude', 'codex']);
  assert.strictEqual(providers.get('claude'), claude);
  assert.strictEqual(providers.get('Codex'), codex);
  assert.strictEqual(providers.get(''), claude);
  assert.strictEqual(providers.get(undefined), claude);
  assert.throws(() => providers.get('gpt'), /unknown agent "gpt" \(available: claude, codex\)/);
});

test('every provider implements the interface of docs/PROVIDERS.md', () => {
  for (const name of providers.list()) {
    const p = providers.get(name);
    assert.strictEqual(p.name, name);
    for (const k of ['displayName', 'installHint', 'loginHint', 'pathKey']) assert.ok(typeof p[k] === 'string' && p[k], `${name}.${k}`);
    for (const f of ['resolveCommand', 'loginStatus', 'createSession']) assert.strictEqual(typeof p[f], 'function', `${name}.${f}`);
    assert.deepStrictEqual(Object.keys(p.defaultModels).sort(), ['detail', 'explain', 'translate'], name);
  }
  assert.deepStrictEqual(claude.defaultModels, { explain: 'haiku', translate: 'haiku', detail: 'sonnet' });
  assert.deepStrictEqual(codex.defaultModels, { explain: '', translate: '', detail: '' }, 'codex uses its own default model');
});

test('AiRunner: unknown agent throws with the list; models fall back per provider', () => {
  assert.throws(() => new ai.AiRunner({ agent: 'gemini', glossary }), /unknown agent "gemini" \(available: claude, codex\)/);
  assert.deepStrictEqual(ai.modelsFor(claude, {}), { explain: 'haiku', translate: 'haiku', detail: 'sonnet' });
  assert.deepStrictEqual(ai.modelsFor(claude, { detail: 'opus', explain: ' ' }), { explain: 'haiku', translate: 'haiku', detail: 'opus' });
  assert.deepStrictEqual(ai.modelsFor(codex, { explain: 'gpt-x' }), { explain: 'gpt-x', translate: '', detail: '' });
});

test('modelsFor: another provider\'s model ids and non-strings are dropped with one log line each', () => {
  const logs = [];
  // "agent" switched to codex by hand, Claude's ids left in config.json.
  assert.deepStrictEqual(ai.modelsFor(codex, { explain: 'haiku', translate: 7, detail: 'gpt-x' }, l => logs.push(l)), { explain: '', translate: '', detail: 'gpt-x' });
  assert.deepStrictEqual(logs, [
    'ai: models.explain "haiku" is a claude model, not codex; using the codex default',
    'ai: models.translate in config.json is not a string; using the codex default',
  ]);
  logs.length = 0;
  assert.deepStrictEqual(ai.modelsFor(claude, { explain: 'sonnet', detail: 'opus' }, l => logs.push(l)), { explain: 'sonnet', translate: 'haiku', detail: 'opus' }, 'own ids stay');
  assert.deepStrictEqual(logs, []);
  const runnerLogs = [];
  const r = new ai.AiRunner({ agent: 'codex', codexPath: FAKE_CODEX, models: { explain: 'haiku', translate: 'haiku', detail: 'sonnet' }, glossary, log: l => runnerLogs.push(l) });
  assert.deepStrictEqual(r.opts.models, { explain: '', translate: '', detail: '' });
  assert.strictEqual(runnerLogs.length, 3);
});

test('codex versionWarning: older than the tested version warns; same, newer or unreadable does not', () => {
  assert.strictEqual(codex.TESTED_VERSION, '0.154.0');
  assert.match(codex.versionWarning('codex-cli 0.153.9'), /^codex 0\.153\.9 is older than the tested 0\.154\.0; flags may be missing/);
  assert.match(codex.versionWarning('codex-cli 0.99.0'), /older/);
  for (const v of ['codex-cli 0.154.0', 'codex-cli 0.154.1', 'codex-cli 0.200.0', 'codex-cli 1.0.0', 'what', '']) assert.strictEqual(codex.versionWarning(v), '', v);
});

// ---------------------------------------------------------------------------
// Finding codex
// ---------------------------------------------------------------------------

test('codex resolveCommand: configured .js runs with node; missing path names codexPath', () => {
  assert.deepStrictEqual(codex.resolveCommand({ codexPath: FAKE_CODEX }), { file: process.execPath, args: [FAKE_CODEX], found: true });
  const m = codex.resolveCommand({ codexPath: path.join(os.tmpdir(), 'nope', 'codex.exe') });
  assert.strictEqual(m.found, false);
  assert.match(m.note, /codexPath .* does not exist/);
  const none = codex.resolveCommand({}, { platform: 'linux', env: { PATH: '' }, home: path.join(os.tmpdir(), 'nobody') });
  assert.strictEqual(none.found, false);
  assert.match(none.note, /npm install -g @openai\/codex/);
});

test('codex resolveCommand: the npm codex.cmd shim on Windows -> the native codex.exe in the package, else codex.js with node', () => {
  const dir = tmpdir();
  const npm = path.join(dir, 'npm');
  const pkg = path.join(npm, 'node_modules', '@openai', 'codex');
  fs.mkdirSync(path.join(pkg, 'bin'), { recursive: true });
  const js = path.join(pkg, 'bin', 'codex.js');
  fs.writeFileSync(js, '');
  const shim = path.join(npm, 'codex.cmd');
  fs.writeFileSync(shim, '@ECHO off\r\nIF EXIST "%dp0%\\node.exe" (\r\n  SET "_prog=%dp0%\\node.exe"\r\n)\r\n"%_prog%"  "%dp0%\\node_modules\\@openai\\codex\\bin\\codex.js" %*\r\n');
  const env = { PATH: path.join(dir, 'empty'), APPDATA: dir };
  assert.deepStrictEqual(codex.resolveCommand({}, { platform: 'win32', env, home: path.join(dir, 'home') }), { file: process.execPath, args: [js], found: true });
  const exe = codex.nativeNextTo(js)[0];
  fs.mkdirSync(path.dirname(exe), { recursive: true });
  fs.writeFileSync(exe, 'MZ');
  assert.deepStrictEqual(codex.resolveCommand({ codexPath: shim }), { file: exe, args: [], found: true });
});

test('codex resolveCommand: posix PATH lookup', { skip: process.platform === 'win32' && 'simulates POSIX paths' }, () => {
  const dir = tmpdir();
  fs.writeFileSync(path.join(dir, 'codex'), '#!/bin/sh\n');
  assert.deepStrictEqual(codex.resolveCommand({}, { platform: 'linux', env: { PATH: dir }, home: path.join(dir, 'home') }), { file: path.join(dir, 'codex'), args: [], found: true });
});

// ---------------------------------------------------------------------------
// Codex command line and output
// ---------------------------------------------------------------------------

test('codexArgs: read-only, ephemeral, no tools, system prompt as developer_instructions, prompt on stdin', () => {
  const a = codex.codexArgs('', 'SP "quoted" 100%\nline 2');
  assert.deepStrictEqual(a.slice(0, 17), ['exec', '--json', '--ephemeral', '--sandbox', 'read-only', '--skip-git-repo-check',
    '--ignore-user-config', '--ignore-rules', '--disable', 'shell_tool', '--disable', 'unified_exec', '-c', 'web_search="disabled"',
    '-c', 'model_reasoning_effort="low"', '-c']);
  const dev = a[17];
  assert.ok(dev.startsWith('developer_instructions="'));
  assert.strictEqual(JSON.parse(dev.slice('developer_instructions='.length)), 'SP "quoted" 100%\nline 2');
  assert.strictEqual(a[a.length - 1], '-');
  assert.ok(!a.includes('-m'), 'no model -> codex default');
  const b = codex.codexArgs('gpt-x', 'SP', ['-c', 'model_reasoning_effort="low"']);
  assert.deepStrictEqual(b.slice(-5), ['-m', 'gpt-x', '-c', 'model_reasoning_effort="low"', '-']);
  assert.strictEqual(codex.tomlString('a\x7fb'), '"a\\u007fb"');
});

test('parseExecOutput: last agent message; empty; turn.failed; transient errors; not JSON; no events', () => {
  const lines = (...evs) => evs.map(e => JSON.stringify(e)).join('\n') + '\n';
  const msg = (text) => ({ type: 'item.completed', item: { type: 'agent_message', text } });
  const done = { type: 'turn.completed', usage: {} };
  assert.deepStrictEqual(codex.parseExecOutput(lines({ type: 'thread.started' }, msg('first'), msg('pong'), done), 0), { text: 'pong' });
  assert.deepStrictEqual(codex.parseExecOutput(lines(msg('  '), done), 0), { err: 'codex returned an empty reply' });
  assert.deepStrictEqual(codex.parseExecOutput(lines(done), 0), { err: 'codex returned an empty reply' });
  assert.deepStrictEqual(codex.parseExecOutput(lines({ type: 'error', message: 'Reconnecting... 1/5' }, msg('ok'), done), 0), { text: 'ok' });
  assert.deepStrictEqual(codex.parseExecOutput(lines({ type: 'turn.failed', error: { message: 'boom' } }), 1), { err: 'codex: boom' });
  assert.match(codex.parseExecOutput(lines({ type: 'turn.failed', error: { message: 'unexpected status 401 Unauthorized' } }), 1).err, /^codex not logged in: /);
  assert.match(codex.parseExecOutput('hello there\n', 0).err, /^codex output was not JSON lines: hello there/);
  assert.deepStrictEqual(codex.parseExecOutput('', 1, 'Error loading configuration\n'), { err: 'codex exited (1): Error loading configuration' });
  assert.deepStrictEqual(codex.parseExecOutput(lines({ type: 'thread.started' }), null), { err: 'codex exited (null)' });
});

// ---------------------------------------------------------------------------
// Codex sessions against the fake CLI
// ---------------------------------------------------------------------------

test('codex session: ask -> the reply text; flags, cwd, system prompt and model reach the CLI', async () => {
  const { dir, runs } = codexLog();
  const s = codex.createSession({ role: 'explain', model: '', systemPrompt: 'BE BRIEF', cfg: { codexPath: FAKE_CODEX, workDir: path.join(dir, 'cwd'), timeoutMs: 10000 } });
  assert.strictEqual(s.persistent, false);
  assert.strictEqual(await s.ask('reply with the single word pong'), 'pong');
  assert.strictEqual(await s.ask('second #preamble'), 'pong', 'the last agent message is the answer');
  assert.strictEqual(await s.ask('third #reconnect'), 'pong', 'a transient error event is not a failure');
  const [r] = runs();
  assert.strictEqual(r.developer, 'BE BRIEF');
  assert.strictEqual(r.model, null);
  assert.strictEqual(fs.realpathSync(r.cwd), fs.realpathSync(path.join(dir, 'cwd')));
  assert.strictEqual(r.prompt, 'reply with the single word pong');
  for (const f of ['--ephemeral', '--skip-git-repo-check', '--json']) assert.ok(r.args.includes(f), f);
  assert.strictEqual(r.args[r.args.indexOf('--sandbox') + 1], 'read-only');
  assert.strictEqual(runs().length, 3, 'one exec per ask');
  s.close();
});

test('codex session: empty reply, non-zero exit, output that is not JSON, a crash and a 401 are clear errors', async () => {
  const { dir } = codexLog();
  const s = codex.createSession({ model: 'gpt-x', cfg: { codexPath: FAKE_CODEX, workDir: path.join(dir, 'cwd'), timeoutMs: 10000 } });
  await assert.rejects(s.ask('x #empty'), { message: 'codex returned an empty reply' });
  await assert.rejects(s.ask('x #exit'), { message: 'codex: stream disconnected before completion' });
  await assert.rejects(s.ask('x #notjson'), /^Error: codex output was not JSON lines: Sure! pong/);
  await assert.rejects(s.ask('x #crash'), { message: 'codex exited (2): Error: boom' });
  await assert.rejects(s.ask('x #autherr'), /codex not logged in: unexpected status 401/);
});

test('codex session: timeout kills the run; close() kills one in flight; missing CLI rejects without spawning', async () => {
  const { dir, runs } = codexLog();
  const s = codex.createSession({ cfg: { codexPath: FAKE_CODEX, workDir: path.join(dir, 'cwd'), timeoutMs: 800 } });
  await assert.rejects(s.ask('x #hang'), { message: 'timeout' });
  const p = s.ask('y #hang', { timeoutMs: 30000 });
  await new Promise(r => setTimeout(r, 400));
  assert.strictEqual(s.busy, true);
  s.close();
  await assert.rejects(p, /codex exited/);
  await new Promise(r => setTimeout(r, 200));
  for (const r of runs()) assert.ok(!alive(r.pid), 'killed ' + r.pid);
  const missing = codex.createSession({ cfg: { codexPath: path.join(dir, 'no-codex.exe') } });
  await assert.rejects(missing.ask('hi'), /^Error: codex CLI not found: codexPath .* does not exist/);
});

// ---------------------------------------------------------------------------
// Login checks
// ---------------------------------------------------------------------------

test('loginStatus: claude (`claude auth status`) and codex (`codex login status`), ok and not ok', async () => {
  assert.deepStrictEqual(await claude.loginStatus({ claudePath: FAKE_CLAUDE }), { ok: true, detail: 'claude.ai, max' });
  assert.deepStrictEqual(await codex.loginStatus({ codexPath: FAKE_CODEX }), { ok: true, detail: 'Logged in using ChatGPT' });
  await withEnv('FAKE_CLAUDE_LOGGED_OUT', '1', async () => {
    assert.deepStrictEqual(await claude.loginStatus({ claudePath: FAKE_CLAUDE }), { ok: false, detail: 'not logged in (run `claude auth login`)' });
  });
  await withEnv('FAKE_CODEX_LOGGED_OUT', '1', async () => {
    assert.deepStrictEqual(await codex.loginStatus({ codexPath: FAKE_CODEX }), { ok: false, detail: 'Not logged in (run `codex login`)' });
  });
  const nc = await claude.loginStatus({ claudePath: path.join(os.tmpdir(), 'no-such-claude.exe') });
  assert.strictEqual(nc.ok, false);
  assert.match(nc.detail, /^claude CLI not found/);
  await withEnv('FAKE_CODEX_VERSION', '0.150.2', async () => {
    const old = await codex.loginStatus({ codexPath: FAKE_CODEX });
    assert.strictEqual(old.ok, true, 'an old version is a warning, not a failure');
    assert.match(old.warning, /codex 0\.150\.2 is older than the tested 0\.154\.0/);
  });
  const nx = await codex.loginStatus({ codexPath: path.join(os.tmpdir(), 'no-such-codex.exe') });
  assert.strictEqual(nx.ok, false);
  assert.match(nx.detail, /^codex CLI not found/);
});

test('AiRunner.checkLogin: a logged-out provider is reported without a model call', async () => {
  const { dir, runs } = codexLog();
  const runner = new ai.AiRunner({ agent: 'codex', codexPath: FAKE_CODEX, workDir: path.join(dir, 'cwd'), glossary, timeoutMs: 10000 });
  try {
    assert.deepStrictEqual(await runner.checkLogin(), { ok: true });
    assert.strictEqual(runs().length, 1, 'one probe');
    await withEnv('FAKE_CODEX_LOGGED_OUT', '1', async () => {
      assert.deepStrictEqual(await runner.checkLogin(), { ok: false, loggedOut: true, err: 'codex not logged in: Not logged in (run `codex login`)' });
    });
    assert.strictEqual(runs().length, 1, 'no probe when logged out');
  } finally { runner.stop(); }
  await withEnv('FAKE_CLAUDE_LOGGED_OUT', '1', async () => {
    const r = new ai.AiRunner({ claudePath: FAKE_CLAUDE, workDir: path.join(dir, 'cwd2'), glossary });
    const st = await r.checkLogin();
    assert.strictEqual(st.loggedOut, true);
    assert.match(st.err, /^claude not logged in: not logged in/);
  });
});

// ---------------------------------------------------------------------------
// The runner on Codex
// ---------------------------------------------------------------------------

function req(id, text, kind = 'x', extra = {}) {
  return { session: 's1', id, kind, channel: 'PARTY', sender: 'Bob', model: '', ctx: '', text, ...extra };
}

test('runner on codex: a batch is one exec with the per-language system prompt; detail runs alone; results validated', async () => {
  const { dir, runs } = codexLog();
  const logs = [];
  const runner = new ai.AiRunner({ agent: 'codex', codexPath: FAKE_CODEX, workDir: path.join(dir, 'cwd'), batchWindowMs: 60, timeoutMs: 10000, glossary, log: l => logs.push(l) });
  try {
    const [a, b] = await Promise.all([runner.request(req(1, 'lf1m strat', 'x', { lang: 'deDE' })), runner.request(req(2, '我五分鐘後到', 't', { lang: 'deDE' }))]);
    assert.deepStrictEqual([a.status, b.status], ['done', 'done']);
    assert.strictEqual(a.tr, '譯：lf1m strat');
    const d = await runner.request(req(3, 'ur dps is trash', 'd'));
    assert.strictEqual(d.status, 'done');
    assert.match(d.detail, /^語氣/);
    const r = runs();
    assert.strictEqual(r.length, 2, 'x+t in one exec, d alone');
    assert.strictEqual(r[0].developer, ai.buildSystemPrompt('deDE'));
    assert.strictEqual(r[1].developer, ai.buildSystemPrompt('zhTW'));
    assert.ok(r.every(x => x.model === null), 'codex default model');
    assert.ok(logs.some(l => /^ai: one-shot default deDE, 2 request\(s\): ok$/.test(l)), logs.join('\n'));
  } finally { runner.stop(); }
});

test('runner on codex: an empty reply is retried once alone, then an error naming it; models override -m', async () => {
  const { dir, runs } = codexLog();
  const runner = new ai.AiRunner({ agent: 'codex', codexPath: FAKE_CODEX, workDir: path.join(dir, 'cwd'), batchWindowMs: 30, timeoutMs: 10000, glossary, models: { explain: 'gpt-x' } });
  try {
    const r = await runner.request(req(1, 'hi #empty'));
    assert.deepStrictEqual([r.status, r.err], ['error', 'codex returned an empty reply']);
    assert.deepStrictEqual(runs().map(x => x.model), ['gpt-x', 'gpt-x'], 'first try + one retry, with the configured model');
    const missing = new ai.AiRunner({ agent: 'codex', codexPath: path.join(dir, 'no-codex.exe'), glossary });
    const m = await missing.request(req(2, 'hi'));
    assert.match(m.err, /^codex CLI not found/);
  } finally { runner.stop(); }
});

test('claude sessions: persistent for haiku, one-shot for sonnet or when asked', () => {
  const cfg = { claudePath: FAKE_CLAUDE };
  assert.strictEqual(claude.createSession({ model: 'haiku', cfg }).persistent, true);
  assert.strictEqual(claude.createSession({ model: 'sonnet', cfg }).persistent, false);
  assert.strictEqual(claude.createSession({ model: 'haiku', cfg, oneShot: true }).persistent, false);
  assert.strictEqual(claude.createSession({ model: 'haiku', cfg: { ...cfg, persistent: false } }).persistent, false);
});
