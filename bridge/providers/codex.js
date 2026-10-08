// Adapted from wow-ai (MIT) by chelinho139: bridge/agents.js (the Codex command line,
// codexParser, nativeNextTo).
//
// The OpenAI Codex provider (docs/PROVIDERS.md): drives the local `codex` CLI with the
// user's own ChatGPT / OpenAI login. Codex has no long-lived stdin mode, so every ask() is
// one `codex exec --json` run:
//
//   codex exec --json --ephemeral --sandbox read-only --skip-git-repo-check
//              --ignore-user-config --ignore-rules --disable shell_tool --disable unified_exec
//              -c web_search="disabled" -c model_reasoning_effort="low"
//              -c developer_instructions="<system prompt>"
//              [-m <model>] [extraArgs...] -          (prompt on stdin)
//
// Why each flag (measured on codex-cli 0.154.0):
//   --ephemeral             no thread files on disk; every request is independent anyway.
//   --sandbox read-only     even in read-only mode Codex runs read-only shell commands
//                           (`ls` worked), so the tools are switched off as well:
//   --disable shell_tool / unified_exec, web_search="disabled"
//                           with these the model answers "cannot run commands" instead.
//   --ignore-user-config    the user's config.toml may start MCP servers or hooks on every
//                           run; auth still comes from CODEX_HOME. Overrides go in extraArgs.
//   model_reasoning_effort  "low": a chat line needs no deep reasoning; about 9 s instead of
//                           10.4 s per run here. A later -c in extraArgs overrides it
//                           (the last -c for a key wins).
//   developer_instructions  Codex has no --system-prompt flag; developer instructions rank
//                           above the user turn, so chat text cannot override them as easily
//                           as a context block at the top of the prompt could.
// The reply is the last agent_message of the turn (Codex may send a short preamble message
// first). "error" events can be transient ("Reconnecting... 2/5"); only turn.failed or an
// exit without turn.completed is a failure.
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const childProcess = require('child_process');
const { resolveCli, killTree, runCapture, oneLine } = require('./cli');

// The version these flags were measured on. Older CLIs may lack --ignore-user-config,
// --ignore-rules or the shell_tool / unified_exec features: a warning, not a failure.
const TESTED_VERSION = '0.154.0';

// `codex --version` output ("codex-cli 0.154.0") -> a warning string, or '' when it is the
// tested version or newer (or unreadable: no reason to cry wolf).
function versionWarning(text) {
  const m = /(\d+)\.(\d+)\.(\d+)/.exec(String(text || ''));
  if (!m) return '';
  const have = m.slice(1).map(Number), want = TESTED_VERSION.split('.').map(Number);
  for (let i = 0; i < 3; i++) {
    if (have[i] > want[i]) return '';
    if (have[i] < want[i]) return `codex ${m[0]} is older than the tested ${TESTED_VERSION}; flags may be missing (npm install -g @openai/codex to update)`;
  }
  return '';
}

const INSTALL_HINT = 'install Codex (npm install -g @openai/codex), run `codex login` once, or set codexPath in bridge/config.json';

// Where the npm package keeps the native codex.exe, relative to its bin\codex.js launcher.
function nativeNextTo(script) {
  const arch = process.arch === 'arm64' ? 'arm64' : 'x64';
  const triple = process.arch === 'arm64' ? 'aarch64-pc-windows-msvc' : 'x86_64-pc-windows-msvc';
  const pkg = path.resolve(path.dirname(script), '..'); // node_modules/@openai/codex
  const scope = path.dirname(pkg);
  return [
    path.join(scope, `codex-win32-${arch}`, 'vendor', triple, 'bin', 'codex.exe'),
    path.join(pkg, 'vendor', triple, 'bin', 'codex.exe'),
    path.join(pkg, 'vendor', triple, 'codex', 'codex.exe'),
  ];
}

const CLI = { command: 'codex', pathKey: 'codexPath', installHint: INSTALL_HINT, native: nativeNextTo };

// cfg: { codexPath } (the bridge config). opts: { platform, env, home } for tests.
function resolveCommand(cfg = {}, opts = {}) {
  return resolveCli(CLI, (cfg && cfg.codexPath) || '', opts);
}

// A TOML basic string for a -c value. JSON's escapes (\" \\ \n \t \uXXXX) are valid TOML;
// DEL is the one character TOML wants escaped that JSON leaves alone.
function tomlString(s) { return JSON.stringify(String(s)).replace(/\x7f/g, '\\u007f'); }

function codexArgs(model, systemPrompt, extraArgs = []) {
  const a = ['exec', '--json', '--ephemeral', '--sandbox', 'read-only', '--skip-git-repo-check',
    '--ignore-user-config', '--ignore-rules', '--disable', 'shell_tool', '--disable', 'unified_exec',
    '-c', 'web_search="disabled"', '-c', 'model_reasoning_effort="low"'];
  if (systemPrompt) a.push('-c', 'developer_instructions=' + tomlString(systemPrompt));
  if (model) a.push('-m', model);
  return [...a, ...(Array.isArray(extraArgs) ? extraArgs : []), '-'];
}

// Error text from Codex -> the short reason shown to the player.
function codexError(t) {
  const s = oneLine(t, 200);
  if (/401|unauthori[sz]ed|not logged in|log ?in|authentication|api key/i.test(s)) return 'codex not logged in: ' + s.slice(0, 100);
  return 'codex: ' + s.slice(0, 120);
}

// The JSON lines of one `codex exec --json` run -> { text } | { err }.
// code: the exit code; stderr: its tail (for errors that happen before any event).
function parseExecOutput(stdout, code, stderr = '') {
  let events = 0, last = null, lastError = '', completed = false, failed = null;
  for (const line of String(stdout || '').split('\n')) {
    if (!line.trim()) continue;
    let ev; try { ev = JSON.parse(line); } catch { continue; }
    if (!ev || typeof ev !== 'object') continue;
    events++;
    const item = ev.item;
    if (ev.type === 'item.completed' && item && item.type === 'agent_message') last = String(item.text || '');
    else if (ev.type === 'item.completed' && item && item.type === 'error') lastError = String(item.message || lastError);
    else if (ev.type === 'error') lastError = String(ev.message || lastError);
    else if (ev.type === 'turn.failed') failed = (ev.error && ev.error.message) || lastError || 'the turn failed';
    else if (ev.type === 'turn.completed') completed = true;
  }
  if (failed) return { err: codexError(failed) };
  if (completed) {
    if (last === null || !last.trim()) return { err: 'codex returned an empty reply' };
    return { text: last };
  }
  const why = oneLine(lastError || stderr || '', 120);
  if (!events && code === 0) return { err: 'codex output was not JSON lines' + (oneLine(stdout) ? ': ' + oneLine(stdout, 80) : '') };
  if (/401|unauthori[sz]ed|not logged in/i.test(why)) return { err: codexError(why) };
  return { err: `codex exited (${code})${why ? ': ' + why : ''}` };
}

// One `codex exec` run -> Promise<{ ok: true, text } | { ok: false, err }>. `track`
// (optional Set) holds the child while it runs, so close() can kill it.
function runExec(cmd, model, prompt, opts, track) {
  return new Promise((resolve) => {
    let child;
    try {
      fs.mkdirSync(opts.workDir, { recursive: true });
      child = childProcess.spawn(cmd.file, [...cmd.args, ...codexArgs(model, opts.systemPrompt, opts.extraArgs)], {
        cwd: opts.workDir, env: process.env, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'],
        detached: process.platform !== 'win32',
      });
    } catch (e) { resolve({ ok: false, err: 'codex could not start: ' + e.message }); return; }
    if (track) track.add(child);
    let out = '', errText = '', settled = false;
    const finish = (r) => { if (settled) return; settled = true; clearTimeout(timer); if (track) track.delete(child); resolve(r); };
    const timer = setTimeout(() => { killTree(child); finish({ ok: false, err: 'timeout' }); }, opts.timeoutMs);
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', d => { out += d; });
    // Keep the end of stderr: Codex logs retries there before the real error.
    child.stderr.on('data', d => { errText = (errText + d).slice(-4000); });
    child.stdin.on('error', () => {});
    child.on('error', e => finish({ ok: false, err: 'codex could not start: ' + e.message }));
    child.on('close', (code) => {
      const r = parseExecOutput(out, code, errText);
      finish(r.err ? { ok: false, err: r.err } : { ok: true, text: r.text });
    });
    child.stdin.end(prompt);
  });
}

// ---------------------------------------------------------------------------
// The provider interface (docs/PROVIDERS.md)
// ---------------------------------------------------------------------------

const SESSION_DEFAULTS = { timeoutMs: 60000, extraArgs: [], workDir: path.join(os.tmpdir(), 'wow-chat-helper-cwd') };

// { ok, detail, warning? }: `codex login status` exits 0 when logged in ("Logged in using
// ChatGPT", printed on stderr), 1 with "Not logged in" otherwise. No model call.
// `login status` rejects --ignore-user-config (codex-cli 0.154.0), so unlike exec it reads
// the user's config.toml; only the auth in CODEX_HOME matters for the answer.
// `warning` is set when `codex --version` is older than TESTED_VERSION.
async function loginStatus(cfg = {}) {
  const cmd = cfg.command || resolveCommand(cfg);
  if (!cmd.found) return { ok: false, detail: 'codex CLI not found: ' + (cmd.note || INSTALL_HINT) };
  const [r, v] = await Promise.all([
    runCapture(cmd, ['login', 'status'], { timeoutMs: 20000 }),
    runCapture(cmd, ['--version'], { timeoutMs: 20000 }),
  ]);
  const warning = versionWarning(v.stdout);
  const w = warning ? { warning } : {};
  const text = oneLine(String(r.stdout || '') + ' ' + String(r.stderr || ''), 100);
  if (r.code === 0) return { ok: true, detail: text || 'logged in', ...w };
  if (r.err) return { ok: false, detail: `\`codex login status\` gave no answer (${r.err})`, ...w };
  return { ok: false, detail: (text || `exit ${r.code}`) + ' (run `codex login`)', ...w };
}

// A session: one model and system prompt. Stateless: each ask() is its own `codex exec`.
//   { role, model, systemPrompt, cfg, log, command, oneShot }
//   -> { persistent: false, busy, ask(prompt, { timeoutMs }) -> Promise<string>, close(why) }
function createSession({ model = '', systemPrompt = '', cfg = {}, command } = {}) {
  const opts = { ...SESSION_DEFAULTS, ...cfg, systemPrompt };
  if (!cfg.workDir) opts.workDir = SESSION_DEFAULTS.workDir;
  const cmd = command || resolveCommand(cfg);
  const children = new Set();
  return {
    persistent: false,
    get busy() { return children.size > 0; },
    ask(prompt, o = {}) {
      if (!cmd.found) return Promise.reject(new Error('codex CLI not found: ' + (cmd.note || INSTALL_HINT)));
      const run = o.timeoutMs ? { ...opts, timeoutMs: o.timeoutMs } : opts;
      return runExec(cmd, model, prompt, run, children).then(r => (r.ok ? r.text : Promise.reject(new Error(r.err))));
    },
    close() { for (const c of children) killTree(c); },
  };
}

module.exports = {
  name: 'codex',
  displayName: 'Codex',
  installHint: INSTALL_HINT,
  loginHint: 'Run `codex login` in a terminal and sign in',
  pathKey: 'codexPath',
  // Empty = Codex's own default model (no -m): model ids change too often to pin one here.
  // config.json "models" sets them per kind.
  defaultModels: { explain: '', translate: '', detail: '' },
  resolveCommand, loginStatus, createSession,
  // How requests are run, for the bridge banner.
  describeMode: () => 'one `codex exec` per batch (reasoning effort low)',
  versionWarning, TESTED_VERSION,
  // Internals, exported for the tests.
  codexArgs, parseExecOutput, codexError, tomlString, nativeNextTo,
};
