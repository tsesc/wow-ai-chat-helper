// Adapted from wow-ai (MIT) by chelinho139: bridge/agents.js (resolveCommand, the Claude
// stream-json event handling).
//
// The Claude Code provider (docs/PROVIDERS.md): drives the local `claude` CLI, so the
// user's own Claude subscription is the only credential.
//
//   persistent mode  one long-lived `claude -p --input-format stream-json --output-format
//                    stream-json --verbose ...` per session; one ask() = one user turn.
//                    Restarted after persistentMaxTurns turns, on crash and on timeout.
//   one-shot mode    `claude -p --output-format json ...`, prompt on stdin. Used when
//                    persistent=false, for Sonnet, and whenever the runner asks for oneShot
//                    (detail requests and every retry).
//
// This code was moved out of ai.js unchanged when the bridge got pluggable providers; the
// batching, validation and retries stay in ai.js (AiRunner) and are the same for every
// provider.
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const childProcess = require('child_process');
const readline = require('readline');
const { resolveCli, killTree, runCapture, oneLine } = require('./cli');

// ---------------------------------------------------------------------------
// Command line
// ---------------------------------------------------------------------------

// Flags verified against Claude Code 2.1.289 (docs/research/claude-cli-latency.md):
// --tools "" disables every built-in tool, --setting-sources "" skips user/project/local
// settings (hooks, CLAUDE.md-adjacent config), --strict-mcp-config skips MCP servers.
// --bare is not used: it drops OAuth/subscription auth.
function commonArgs(model, systemPrompt) {
  return ['--model', model, '--tools', '', '--system-prompt', systemPrompt,
    '--setting-sources', '', '--strict-mcp-config', '--no-session-persistence'];
}

function claudeArgs(mode, model, systemPrompt = '') {
  if (mode === 'persistent') {
    return ['-p', '--input-format', 'stream-json', '--output-format', 'stream-json', '--verbose',
      ...commonArgs(model, systemPrompt)];
  }
  return ['-p', '--output-format', 'json', ...commonArgs(model, systemPrompt)];
}

// The stream-json input line for one user turn.
function userTurnLine(text) {
  return JSON.stringify({ type: 'user', message: { role: 'user', content: [{ type: 'text', text }] } }) + '\n';
}

// ---------------------------------------------------------------------------
// Finding the executable
// ---------------------------------------------------------------------------

const INSTALL_HINT = 'install Claude Code (https://claude.com/claude-code), run `claude` once and log in, or set claudePath in bridge/config.json';

const CLI = {
  command: 'claude', pathKey: 'claudePath', installHint: INSTALL_HINT,
  posixPaths: (home) => [path.join(home, '.local', 'bin', 'claude')],
  windowsPaths: (home) => [path.join(home, '.local', 'bin', 'claude.exe')],
};

// cfg: { claudePath } (the bridge config). opts: { platform, env, home } for tests.
function resolveCommand(cfg = {}, opts = {}) {
  return resolveCli(CLI, (cfg && cfg.claudePath) || '', opts);
}

// ---------------------------------------------------------------------------
// Process control
// ---------------------------------------------------------------------------

// The environment claude runs with. Haiku 4.5 thinks by default (6000+ thinking tokens,
// ~50 s for one chat line, and --effort low does not change that); MAX_THINKING_TOKENS=0
// brings a call to ~4 s. cfg.maxThinkingTokens: number (default 0), or null to leave the
// user's environment alone.
function claudeEnv(opts = {}) {
  const env = { ...process.env };
  const m = opts.maxThinkingTokens === undefined ? 0 : opts.maxThinkingTokens;
  if (m !== null && m !== '') env.MAX_THINKING_TOKENS = String(m);
  return env;
}

function spawnClaude(cmd, args, opts) {
  const cwd = opts.workDir;
  fs.mkdirSync(cwd, { recursive: true });
  return childProcess.spawn(cmd.file, [...cmd.args, ...args, ...(opts.extraArgs || [])], {
    cwd, env: claudeEnv(opts), windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'],
    detached: process.platform !== 'win32',
  });
}

// A Claude result event that reports failure -> short error text.
function claudeError(ev) {
  const t = String(typeof ev.result === 'string' ? ev.result : (ev.error || ev.subtype || 'error')).trim().replace(/\s+/g, ' ');
  if (/log ?in|auth|api key|credential|unauthori[sz]ed/i.test(t)) return 'claude not logged in: ' + t.slice(0, 100);
  return 'claude: ' + t.slice(0, 120);
}

// ---------------------------------------------------------------------------
// One-shot run
// ---------------------------------------------------------------------------

// -> Promise<{ ok: true, text } | { ok: false, err }>. `track` (optional Set) holds the
// child while it runs, so the runner can kill it on stop.
function runOnce(cmd, model, prompt, opts, track) {
  return new Promise((resolve) => {
    let child;
    try { child = spawnClaude(cmd, claudeArgs('oneshot', model, opts.systemPrompt), opts); } catch (e) {
      resolve({ ok: false, err: 'claude could not start: ' + e.message }); return;
    }
    if (track) track.add(child);
    let out = '', errText = '', settled = false;
    const finish = (r) => { if (settled) return; settled = true; clearTimeout(timer); if (track) track.delete(child); resolve(r); };
    const timer = setTimeout(() => { killTree(child); finish({ ok: false, err: 'timeout' }); }, opts.timeoutMs);
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', d => { out += d; });
    child.stderr.on('data', d => { if (errText.length < 4000) errText += d; });
    child.stdin.on('error', () => {});
    child.on('error', e => finish({ ok: false, err: 'claude could not start: ' + e.message }));
    child.on('close', (code) => {
      let ev = null;
      try { ev = JSON.parse(out); } catch {
        const last = out.trim().split('\n').reverse().find(l => l.trim().startsWith('{'));
        try { ev = last ? JSON.parse(last) : null; } catch {}
      }
      if (Array.isArray(ev)) ev = ev.find(e => e && e.type === 'result') || null;
      if (ev && ev.type === 'result') {
        if (ev.is_error) finish({ ok: false, err: claudeError(ev) });
        else finish({ ok: true, text: typeof ev.result === 'string' ? ev.result : JSON.stringify(ev.result ?? '') });
        return;
      }
      const why = (errText || out).trim().replace(/\s+/g, ' ').slice(0, 120);
      finish({ ok: false, err: `claude exited (${code})${why ? ': ' + why : ''}` });
    });
    child.stdin.end(prompt);
  });
}

// ---------------------------------------------------------------------------
// Persistent process
// ---------------------------------------------------------------------------

class PersistentClaude {
  constructor(cmd, model, opts) {
    this.cmd = cmd; this.model = model; this.opts = opts;
    this.child = null; this.turns = 0; this.current = null; this.starts = 0;
  }

  alive() { return !!this.child; }

  start() {
    const child = spawnClaude(this.cmd, claudeArgs('persistent', this.model, this.opts.systemPrompt), this.opts);
    this.child = child; this.turns = 0; this.starts++;
    this.stderr = '';
    child.stderr.setEncoding('utf8');
    child.stderr.on('data', d => { if (this.stderr.length < 4000) this.stderr += d; });
    child.stdin.on('error', () => {});
    const rl = readline.createInterface({ input: child.stdout });
    rl.on('line', (line) => {
      let ev; try { ev = JSON.parse(line); } catch { return; }
      if (child !== this.child) return;
      if (ev.type === 'result' && this.current) {
        const cur = this.current; this.current = null;
        if (ev.is_error) cur.finish({ ok: false, err: claudeError(ev) });
        else cur.finish({ ok: true, text: typeof ev.result === 'string' ? ev.result : JSON.stringify(ev.result ?? '') });
      }
    });
    const gone = (why) => {
      if (child !== this.child) return;
      this.child = null;
      if (this.current) {
        const cur = this.current; this.current = null;
        const tail = this.stderr.trim().replace(/\s+/g, ' ').slice(0, 120);
        cur.finish({ ok: false, err: why + (tail ? ': ' + tail : '') });
      }
    };
    child.on('error', e => gone('claude could not start: ' + e.message));
    child.on('close', code => gone(`claude exited (${code})`));
  }

  // Kill the process; a turn in flight resolves with `why`.
  stop(why = 'claude restarted') {
    const c = this.child; this.child = null;
    if (c) { try { c.stdin.end(); } catch {} killTree(c); }
    if (this.current) { const cur = this.current; this.current = null; cur.finish({ ok: false, err: why }); }
  }

  // One user turn -> Promise<{ ok, text } | { ok: false, err }>. One turn at a time.
  turn(prompt) {
    if (this.child && this.turns >= this.opts.persistentMaxTurns) this.stop();
    if (!this.child) {
      try { this.start(); } catch (e) { return Promise.resolve({ ok: false, err: 'claude could not start: ' + e.message }); }
    }
    this.turns++;
    return new Promise((resolve) => {
      let settled = false;
      const cur = {
        finish: (r) => { if (settled) return; settled = true; clearTimeout(timer); resolve(r); },
      };
      const timer = setTimeout(() => { this.stop('timeout'); cur.finish({ ok: false, err: 'timeout' }); }, this.opts.timeoutMs);
      this.current = cur;
      try { this.child.stdin.write(userTurnLine(prompt)); } catch (e) { this.stop(); cur.finish({ ok: false, err: 'claude stdin: ' + e.message }); }
    });
  }
}

// ---------------------------------------------------------------------------
// The provider interface (docs/PROVIDERS.md)
// ---------------------------------------------------------------------------

const SESSION_DEFAULTS = {
  timeoutMs: 60000, persistent: true, persistentMaxTurns: 40, maxThinkingTokens: 0, extraArgs: [],
  workDir: path.join(os.tmpdir(), 'wow-chat-helper-cwd'),
};

// { ok, detail }: is the CLI logged in? `claude auth status` prints JSON with loggedIn
// (Claude Code 2.1.x); no model call. cfg: the bridge config (claudePath), or { command }.
async function loginStatus(cfg = {}) {
  const cmd = cfg.command || resolveCommand(cfg);
  if (!cmd.found) return { ok: false, detail: 'claude CLI not found: ' + (cmd.note || INSTALL_HINT) };
  const r = await runCapture(cmd, ['auth', 'status'], { timeoutMs: 20000 });
  let st = null;
  try { st = JSON.parse(r.stdout); } catch {}
  if (st && typeof st.loggedIn === 'boolean') {
    if (st.loggedIn) return { ok: true, detail: [st.authMethod, st.subscriptionType].filter(Boolean).join(', ') || 'logged in' };
    return { ok: false, detail: 'not logged in (run `claude auth login`)' };
  }
  const why = r.err || `exit ${r.code}`;
  const tail = oneLine(r.stderr || r.stdout, 100);
  return { ok: false, detail: `\`claude auth status\` gave no answer (${why})${tail ? ': ' + tail : ''}` };
}

// A session: one model and system prompt. Persistent unless oneShot, persistent=false or
// Sonnet (spec 5: Sonnet is only used for detail and always runs one-shot).
//   { role, model, systemPrompt, cfg, log, command, oneShot }
//   -> { persistent, busy, ask(prompt, { timeoutMs }) -> Promise<string>, close(why) }
// ask() rejects with an Error whose message is the short reason shown to the player.
function createSession({ model, systemPrompt = '', cfg = {}, command, oneShot = false } = {}) {
  const opts = { ...SESSION_DEFAULTS, ...cfg, systemPrompt };
  if (!cfg.workDir) opts.workDir = SESSION_DEFAULTS.workDir;
  const cmd = command || resolveCommand(cfg);
  const persistent = !oneShot && !!opts.persistent && model !== 'sonnet';
  const proc = persistent ? new PersistentClaude(cmd, model, opts) : null;
  const children = new Set();
  const settle = (r) => (r.ok ? r.text : Promise.reject(new Error(r.err)));
  return {
    persistent,
    get busy() { return !!(proc && proc.current) || children.size > 0; },
    ask(prompt, o = {}) {
      if (!cmd.found) return Promise.reject(new Error('claude CLI not found: ' + (cmd.note || INSTALL_HINT)));
      if (proc) return proc.turn(prompt).then(settle);
      const run = o.timeoutMs ? { ...opts, timeoutMs: o.timeoutMs } : opts;
      return runOnce(cmd, model, prompt, run, children).then(settle);
    },
    close(why = 'claude restarted') {
      if (proc) proc.stop(why);
      for (const c of children) killTree(c);
    },
  };
}

module.exports = {
  name: 'claude',
  displayName: 'Claude Code',
  installHint: INSTALL_HINT,
  loginHint: 'Run `claude auth login` (or `claude` once) in a terminal and log in',
  pathKey: 'claudePath',
  // Spec 5: Haiku for the fast kinds, Sonnet for the closer look.
  defaultModels: { explain: 'haiku', translate: 'haiku', detail: 'sonnet' },
  resolveCommand, loginStatus, createSession,
  // How requests are run, for the bridge banner.
  describeMode: (cfg = {}) => (cfg.persistent === false ? 'one-shot mode' : 'persistent mode (Sonnet one-shot)'),
  // Internals, exported for ai.js (backward-compatible exports) and the tests.
  claudeArgs, userTurnLine, claudeEnv, claudeError, runOnce, PersistentClaude, INSTALL_HINT,
};
