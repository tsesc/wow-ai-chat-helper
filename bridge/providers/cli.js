// Adapted from wow-ai (MIT) by chelinho139: bridge/agents.js (resolveCommand, unwrapShim,
// nativeNextTo) and bridge/bridge.js (killTree).
//
// What every CLI-backed provider needs, whatever the model behind it: find the executable
// (a configured path, the usual install folders, PATH, npm's Windows .cmd shims), stop a
// process and everything it spawned, and run a short status command (`claude auth status`,
// `codex login status`). Kept here so a new provider only describes where its CLI lives.
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const childProcess = require('child_process');

function exists(p) { try { return fs.statSync(p).isFile(); } catch { return false; } }

function pathDirs(platform = process.platform, env = process.env) {
  const sep = platform === 'win32' ? ';' : ':';
  const dirs = String(env.PATH || env.Path || '').split(sep).filter(Boolean);
  if (platform === 'win32' && env.APPDATA) dirs.push(path.join(env.APPDATA, 'npm'));
  return dirs;
}

// A configured path: a script is run with this node, anything else directly.
function fromPath(p) {
  if (/\.(c|m)?js$/i.test(p)) return { file: process.execPath, args: [p], found: exists(p) };
  return { file: p, args: [], found: exists(p) };
}

// npm's Windows launchers are .cmd files that Node can't spawn directly (and cmd.exe would
// mangle a system prompt with % or " in it). Read the target out of the shim and run that:
// a native .exe, or the .js launcher with this node. native(script) (optional) lists where
// the package keeps a platform binary next to its launcher (Codex ships codex.exe inside the
// npm package); the first one that exists is run directly, so the process tree stays short.
function unwrapShim(shim, native) {
  let src;
  try { src = fs.readFileSync(shim, 'utf8'); } catch { return null; }
  const m = [...src.matchAll(/"%~?dp0%?\\([^"]+)"/g)].find(x => !/(^|\\)node\.exe$/i.test(x[1]));
  if (!m) return null;
  const script = path.resolve(path.dirname(shim), m[1].split('\\').join(path.sep));
  if (!exists(script)) return null;
  for (const exe of native ? native(script) : []) if (exists(exe)) return { file: exe, args: [], found: true };
  if (/\.exe$/i.test(script)) return { file: script, args: [], found: true };
  return { file: process.execPath, args: [script], found: true };
}

// { file, args, found, note }: what to spawn, and whether it is there.
//   spec: { command: 'claude', pathKey: 'claudePath', installHint,
//           posixPaths(home) -> [paths tried first], windowsPaths(home) -> [...],
//           native(script) -> [platform binaries next to an npm launcher] }
//   configured: the <pathKey> value from config.json ('' = search)
//   opts: { platform, env, home } for tests.
function resolveCli(spec, configured = '', opts = {}) {
  const platform = opts.platform || process.platform;
  const env = opts.env || process.env;
  const home = opts.home || os.homedir();
  if (configured) {
    if (/\.(cmd|bat)$/i.test(configured)) {
      const r = unwrapShim(configured, spec.native);
      if (r) return r;
      return { file: configured, args: [], found: false, note: `${spec.pathKey} ${configured} could not be unwrapped` };
    }
    const r = fromPath(configured);
    if (!r.found) r.note = `${spec.pathKey} ${configured} does not exist`;
    return r;
  }
  const dirs = pathDirs(platform, env);
  if (platform !== 'win32') {
    for (const p of spec.posixPaths ? spec.posixPaths(home) : []) if (exists(p)) return { file: p, args: [], found: true };
    for (const d of dirs) { const p = path.join(d, spec.command); if (exists(p)) return { file: p, args: [], found: true }; }
    return { file: spec.command, args: [], found: false, note: spec.installHint };
  }
  for (const p of spec.windowsPaths ? spec.windowsPaths(home) : []) if (exists(p)) return { file: p, args: [], found: true };
  for (const d of dirs) { const exe = path.join(d, spec.command + '.exe'); if (exists(exe)) return { file: exe, args: [], found: true }; }
  for (const d of dirs) {
    const shim = path.join(d, spec.command + '.cmd');
    if (exists(shim)) { const r = unwrapShim(shim, spec.native); if (r) return r; }
  }
  return { file: spec.command + '.exe', args: [], found: false, note: spec.installHint };
}

// Stop a run and whatever it spawned. Windows: taskkill /T /F (an npm launcher runs the
// real binary as its child). Elsewhere the child is started as a process-group leader
// (detached), so the whole group is signalled.
function killTree(child, platform = process.platform) {
  if (!child || child.exitCode !== null || child.signalCode !== null) return;
  if (platform === 'win32') {
    try {
      const k = childProcess.spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' });
      k.on('error', () => { try { child.kill(); } catch {} });
      return;
    } catch {}
  }
  try { process.kill(-child.pid, 'SIGKILL'); return; } catch {}
  try { child.kill('SIGKILL'); } catch {}
}

// Run a short command (a login check) -> Promise<{ code, stdout, stderr, err }>. Never
// rejects: a spawn failure or timeout comes back as `err` with code null.
function runCapture(cmd, args, opts = {}) {
  return new Promise((resolve) => {
    let child;
    try {
      child = childProcess.spawn(cmd.file, [...(cmd.args || []), ...args], {
        cwd: opts.cwd, env: opts.env || process.env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'],
        detached: process.platform !== 'win32',
      });
    } catch (e) { resolve({ code: null, stdout: '', stderr: '', err: e.message }); return; }
    let stdout = '', stderr = '', settled = false;
    const finish = (r) => { if (settled) return; settled = true; clearTimeout(timer); resolve({ stdout, stderr, ...r }); };
    const timer = setTimeout(() => { killTree(child); finish({ code: null, err: 'timeout' }); }, opts.timeoutMs || 20000);
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', d => { if (stdout.length < 16000) stdout += d; });
    child.stderr.on('data', d => { if (stderr.length < 4000) stderr += d; });
    child.on('error', e => finish({ code: null, err: e.message }));
    child.on('close', code => finish({ code, err: '' }));
  });
}

// Whitespace collapsed, cut to n characters: for error text that ends up in the game UI.
function oneLine(s, n = 120) { return String(s || '').trim().replace(/\s+/g, ' ').slice(0, n); }

module.exports = { exists, pathDirs, fromPath, unwrapShim, resolveCli, killTree, runCapture, oneLine };
