#!/usr/bin/env node
// Adapted from wow-ai (MIT) by chelinho139: bridge/bridge.js (capture child, atomic slot
// publishing, signals, presence beats, state.json, banner).
//
// The bridge (spec section 5):
//   capture line -> decode (protocol.js) -> dedup -> ack signal -> hello / enqueue
//   -> AI (ai.js, batched) -> validate -> store result -> publish slots -> ready signal
//
//   node bridge/bridge.js [--config <file>] [--state <file>] [--inject <file>] [--no-capture]
//
//   --config <file>  default bridge/config.json (copy of config.example.json, made by setup.js)
//   --state <file>   default bridge/state.json
//   --inject <file>  JSON lines: records ({ session, id, kind, channel, sender, model, ctx,
//                    text }) or capture lines ({ id, text } / { cells }); processed as if
//                    read off the strip, then the bridge exits once every request is done.
//                    No capture, no presence beats.
//   --no-capture     don't start capture.ps1 (presence beats and publishing still run)
//
// Also a module: createBridge(cfg, opts) for tests (see the end of this file).
'use strict';

const fs = require('fs');
const path = require('path');
const readline = require('readline');
const { spawn } = require('child_process');
const P = require('./protocol');
const ai = require('./ai');
const { normalizeLocale, DEFAULT_LOCALE } = require('./glossary');
const { SILENT_WAV } = require('./install-slots');

const HERE = __dirname;
const ADDON = 'WoWChatHelper';
const HANDLED_KEEP = 2000;     // ids remembered per session
const SESSIONS_KEEP = 5;       // sessions whose handled ids are remembered
const AHEAD_CLEAR = 50;        // signal files kept empty ahead of the newest id / beat

const CONFIG_DEFAULTS = {
  wowPath: '', addonDir: '', claudePath: '',
  models: { explain: 'haiku', translate: 'haiku', detail: 'sonnet' },
  capture: { enabled: true, corner: 'TOPLEFT', intervalMs: 250, processName: 'WowB', cellPx: 4, cellsPerRow: 200, maxRows: 48 },
  timeoutMs: 60000, batchWindowMs: 400, persistent: true, persistentMaxTurns: 40, maxThinkingTokens: 0,
  glossaryFile: '',
  slots: P.SLOT_COUNT, presenceMax: 2000, presenceIntervalMs: 30000, progressWriteMs: 2000, publishRetryMs: 1000,
};

// config.json (or an object) -> full config with defaults and addonDir resolved.
function resolveConfig(raw = {}) {
  const cfg = { ...CONFIG_DEFAULTS, ...raw };
  cfg.models = { ...CONFIG_DEFAULTS.models, ...(raw.models || {}) };
  cfg.capture = { ...CONFIG_DEFAULTS.capture, ...(raw.capture || {}) };
  if (!cfg.addonDir && cfg.wowPath) cfg.addonDir = path.join(cfg.wowPath, 'Interface', 'AddOns');
  return cfg;
}

function readJson(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return fallback; }
}

// On Windows a rename over a file another process has open (Defender or the indexer
// scanning it, WoW reading a slot) fails with EPERM/EACCES/EBUSY for a few ms: retry with
// a short backoff, as graceful-fs does.
const TRANSIENT = new Set(['EPERM', 'EACCES', 'EBUSY']);
const RENAME_BACKOFF_MS = [5, 20, 50, 100];
const sleepSync = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);

function atomicWrite(file, content) {
  const tmp = file + '.' + process.pid + '.tmp';
  fs.writeFileSync(tmp, content);
  for (let i = 0; ; i++) {
    try { fs.renameSync(tmp, file); return; } catch (e) {
      if (TRANSIENT.has(e.code) && i < RENAME_BACKOFF_MS.length) { sleepSync(RENAME_BACKOFF_MS[i]); continue; }
      try { fs.unlinkSync(tmp); } catch {}
      throw e;
    }
  }
}

class Bridge {
  // cfg: resolved config. opts: { stateFile, workDir, log, runner (an AiRunner-like
  // object with request(req) -> Promise<result> and stop()), now () -> epoch seconds }
  constructor(cfg, opts = {}) {
    this.cfg = resolveConfig(cfg);
    this.stateFile = opts.stateFile || path.join(HERE, 'state.json');
    this.log = opts.log || ((...a) => console.log(new Date().toISOString().slice(11, 19), ...a));
    this.nowFn = opts.now || (() => Math.floor(Date.now() / 1000));
    const st = readJson(this.stateFile, {});
    this.state = {
      session: typeof st.session === 'string' ? st.session : '',
      handled: st.handled && typeof st.handled === 'object' ? st.handled : {},
      results: Array.isArray(st.results) ? st.results : [],
      pending: st.pending && typeof st.pending === 'object' ? st.pending : {},
      settings: st.settings && typeof st.settings === 'object' ? st.settings : {},
      presence: Number(st.presence) || 0,
    };
    this.handledSets = new Map();
    for (const [s, ids] of Object.entries(this.state.handled)) this.handledSets.set(s, new Set(Array.isArray(ids) ? ids : []));
    this.runner = opts.runner || new ai.AiRunner({
      // claude runs in an empty folder outside the repo so no project files or CLAUDE.md
      // are near it (ai.js default: <tmp>/wow-chat-helper-cwd).
      ...this.cfg, workDir: opts.workDir || this.cfg.workDir || undefined, log: (...a) => this.log(...a),
    });
    this.inflight = new Set();
    this.lastPublish = 0;
    this.publishTimer = null;
    this.timers = [];
    this.captureProc = null;
    this.stopped = false;
    this.warnedNoAddon = false;
    this.retryTimer = null;
    this.readyWaiting = new Set(); // result ids whose ready signal waits for a full publish
    this.failedSignals = new Map(); // signal file -> wanted state (true = valid)
    this.idleWaiters = [];
  }

  addonPath(...p) { return path.join(this.cfg.addonDir, ADDON, ...p); }
  addonInstalled() { return fs.existsSync(this.addonPath(ADDON + '.toc')); }
  slotsInstalled() { return fs.existsSync(path.join(this.cfg.addonDir, P.slotAddonName(1), 'Inbox.lua')); }

  // The player's language for explanations (hello settings): lang=<code> (/wch lang),
  // else the client's locale when it is one of the supported ones, else zhTW.
  locale() {
    const s = this.state.settings || {};
    return normalizeLocale(s.lang) || normalizeLocale(s.locale) || DEFAULT_LOCALE;
  }

  // -------------------------------------------------------------------------
  // State
  // -------------------------------------------------------------------------

  saveState() {
    const handled = {};
    const sessions = [...this.handledSets.keys()];
    for (const s of sessions.slice(-SESSIONS_KEEP)) handled[s] = [...this.handledSets.get(s)].slice(-HANDLED_KEEP);
    this.state.handled = handled;
    this.state.results = this.state.results.slice(-P.MAX_RESULTS);
    try {
      fs.mkdirSync(path.dirname(this.stateFile), { recursive: true });
      atomicWrite(this.stateFile, JSON.stringify(this.state, null, 1) + '\n');
    } catch (e) { this.log('state: cannot write ' + this.stateFile + ': ' + e.message); }
  }

  isHandled(rec) { const s = this.handledSets.get(rec.session); return !!(s && s.has(rec.id)); }
  markHandled(rec) {
    let s = this.handledSets.get(rec.session);
    if (!s) { s = new Set(); this.handledSets.set(rec.session, s); }
    s.add(rec.id);
  }

  // A session the bridge hasn't been serving: the addon's saved data is new (or a second
  // character's). Results of the old session are not shown to it.
  switchSession(session) {
    if (session === this.state.session) return;
    this.log(`session ${session || '(none)'} (was ${this.state.session || 'none'})`);
    this.state.session = session;
    this.state.results = [];
    this.state.pending = {};
  }

  // Results keep the order they were received in; an update replaces the entry in place.
  setResult(result) {
    const i = this.state.results.findIndex(r => r.id === result.id);
    if (i >= 0) { this.state.results[i] = result; return; }
    this.state.results.push(result);
    if (this.state.results.length > P.MAX_RESULTS) this.state.results = this.state.results.slice(-P.MAX_RESULTS);
  }

  // -------------------------------------------------------------------------
  // What the game reads: slot files and signals
  // -------------------------------------------------------------------------

  slotSource() {
    return P.renderSlotFile({ v: 1, now: this.nowFn(), session: this.state.session, results: this.state.results });
  }

  // Writes the slot data to Inbox.lua and every slot. Returns true when every slot got
  // it. Files that failed (even after atomicWrite's retries) are retried on a timer
  // (the whole publish, with the then-current data); ready signals of results published
  // meanwhile wait for a publish that reached every slot (raiseReady).
  publishNow() {
    if (this.publishTimer) { clearTimeout(this.publishTimer); this.publishTimer = null; }
    this.lastPublish = Date.now();
    const body = this.slotSource();
    const failed = [];
    const inbox = this.addonPath('Inbox.lua');
    try { atomicWrite(inbox, body); } catch (e) {
      if (e.code === 'ENOENT' && !this.addonInstalled()) {
        if (!this.warnedNoAddon) {
          this.warnedNoAddon = true;
          this.log(`publish: cannot write ${inbox} (${e.code}); addon not installed? run: node setup.js, then restart WoW`);
        }
      } else failed.push([inbox, e]);
    }
    // The slots are what the game reads: write them even if Inbox.lua failed.
    for (let i = 1; i <= this.cfg.slots; i++) {
      const file = path.join(this.cfg.addonDir, P.slotAddonName(i), 'Inbox.lua');
      try { atomicWrite(file, body); } catch (e) {
        if (e.code === 'ENOENT' && !fs.existsSync(path.dirname(file))) continue; // slot not installed (banner says so)
        failed.push([file, e]);
      }
    }
    if (failed.length) {
      const [file, e] = failed[0];
      this.log(`publish: ${failed.length} file(s) not written (${e.code || e.message}), e.g. ${file}; retrying in ${this.cfg.publishRetryMs} ms`);
      this.scheduleRetry();
      return false;
    }
    this.flushReady();
    return true;
  }

  scheduleRetry() {
    if (this.retryTimer || this.stopped) return;
    this.retryTimer = setTimeout(() => {
      this.retryTimer = null;
      if (this.stopped) return;
      this.publishNow();
      this.retrySignals();
    }, this.cfg.publishRetryMs);
  }

  // A result's ready signal, once a publish carrying it reached every slot.
  raiseReady(id) {
    this.readyWaiting.add(id);
    if (!this.retryTimer) this.flushReady();
  }

  flushReady() {
    for (const id of this.readyWaiting) this.signal('ready', id, true);
    this.readyWaiting.clear();
  }

  // Final results and receipts publish immediately; anything else at most every
  // progressWriteMs.
  publish(urgent) {
    if (urgent) { this.publishNow(); return; }
    const wait = this.cfg.progressWriteMs - (Date.now() - this.lastPublish);
    if (wait <= 0) this.publishNow();
    else if (!this.publishTimer) this.publishTimer = setTimeout(() => { this.publishTimer = null; this.publishNow(); }, wait);
  }

  // kind 'ready' | 'ack' (n = request id) | 'presence' (n = beat). on: valid / empty wav.
  // A write that fails is logged and retried with the next publish retry; the newest
  // wanted state of a file wins.
  signal(kind, n, on) {
    const file = this.addonPath(...P.signalPath(kind, n).split('/'));
    this.failedSignals.delete(file);
    try {
      if (!on) {
        let st = null;
        try { st = fs.statSync(file); } catch (e) { if (e.code === 'ENOENT') return; throw e; }
        if (st.size === 0) return;
      }
      atomicWrite(file, on ? SILENT_WAV : Buffer.alloc(0));
    } catch (e) {
      if (e.code === 'ENOENT' && !fs.existsSync(path.dirname(file))) return; // signals not installed
      this.log(`signal: cannot write ${file} (${e.code || e.message}); will retry`);
      this.failedSignals.set(file, on);
      this.scheduleRetry();
    }
  }

  retrySignals() {
    const todo = [...this.failedSignals];
    this.failedSignals.clear();
    for (const [file, on] of todo) {
      try { atomicWrite(file, on ? SILENT_WAV : Buffer.alloc(0)); } catch (e) {
        this.failedSignals.set(file, on);
        this.log(`signal: still cannot write ${file} (${e.code || e.message})`);
      }
    }
    if (this.failedSignals.size) this.scheduleRetry();
  }

  // A new id: its ready file must be empty until the result is in, and the files of the
  // next ids are kept empty so a fresh client can't see a stale signal as raised.
  clearAhead(id) {
    this.signal('ready', id, false);
    for (let j = 1; j <= AHEAD_CLEAR; j++) { this.signal('ready', id + j, false); this.signal('ack', id + j, false); }
  }

  // Presence: every presenceIntervalMs flip the next presence/kkkk.wav valid; the 50
  // ahead of the counter are kept empty. The counter persists in state.json.
  presenceBeat() {
    if (!fs.existsSync(this.addonPath('sig', 'presence'))) return;
    const max = this.cfg.presenceMax;
    this.state.presence = (this.state.presence % max) + 1;
    const k = this.state.presence;
    this.signal('presence', k, true);
    for (let j = 1; j <= AHEAD_CLEAR; j++) this.signal('presence', ((k - 1 + j) % max) + 1, false);
    this.saveState();
  }

  // -------------------------------------------------------------------------
  // Inputs
  // -------------------------------------------------------------------------

  // One JSON line from capture.ps1: { info } / { warn } / { error } / { id, text } /
  // { cells: "0123..." } (raw cell values, decoded here with protocol.decodeFrame).
  handleCaptureLine(line) {
    let ev;
    try { ev = JSON.parse(line); } catch { return; }
    if (!ev || typeof ev !== 'object') return;
    if (ev.info) { this.log('capture:', ev.info); return; }
    if (ev.warn) { this.log('capture:', ev.warn); return; }
    if (ev.error) { this.log('capture error:', ev.error); return; }
    if (typeof ev.cells === 'string') {
      const f = P.decodeFrame([...ev.cells].map(Number));
      if (!f) return;
      if (f.error) { this.log('capture: strip seen but rejected: ' + f.error); return; }
      this.handleFrame(f.id, f.text);
      return;
    }
    if (typeof ev.id === 'number' && typeof ev.text === 'string') this.handleFrame(ev.id, ev.text);
  }

  handleFrame(frameId, payload) {
    const records = P.parseRecords(payload);
    this.log(`strip #${frameId}: ${records.length} record(s)`);
    this.handleRecords(records);
  }

  handleRecords(records) {
    if (!records.length) return;
    // The addon takes the frame down once the ack for its highest id fires.
    const maxId = Math.max(...records.map(r => r.id));
    let changed = false, fresh = false, urgent = false;
    for (const rec of records) {
      if (this.isHandled(rec)) continue;
      this.markHandled(rec);
      fresh = true;
      if (rec.session !== this.state.session) { this.switchSession(rec.session); changed = true; }
      if (rec.kind === 'h') {
        this.state.settings = P.parseSettings(rec.text);
        this.log(`hello ${rec.session} #${rec.id}` + (rec.text ? ` (${rec.text.slice(0, 120)})` : '') + `; language ${this.locale()}`);
        if (this.state.settings.lang && !normalizeLocale(this.state.settings.lang)) {
          this.log(`warning: unsupported lang=${this.state.settings.lang}; answering in ${this.locale()}`);
        }
        const corner = this.state.settings.corner;
        if (corner && corner !== this.cfg.capture.corner) {
          this.log(`warning: addon strip corner is ${corner} but config capture.corner is ${this.cfg.capture.corner}; set them the same`);
        }
        changed = true;
        continue;
      }
      this.clearAhead(rec.id);
      this.setResult({ id: rec.id, kind: rec.kind, status: 'working' });
      this.state.pending[rec.id] = rec;
      this.log(`request #${rec.id} ${rec.kind} ${rec.channel}${rec.sender ? ' ' + rec.sender : ''}: ${rec.text.slice(0, 80)}`);
      this.dispatch(rec);
      changed = urgent = true;
    }
    this.signal('ack', maxId, true);
    if (fresh) this.saveState();
    // Receipts (working status) immediately; a hello-only frame through the throttle.
    if (changed) this.publish(urgent);
  }

  // The record goes to the AI with the language in force when it is sent; the result
  // names that language (lang), so the addon files learned terms under it even if the
  // player switched language meanwhile.
  dispatch(rec) {
    const lang = this.locale();
    const p = this.runner.request({ ...rec, lang }).then((result) => {
      if (this.stopped) return;
      if (rec.session !== this.state.session) return; // the session changed meanwhile
      delete this.state.pending[rec.id];
      this.setResult({ ...result, id: rec.id, kind: rec.kind, lang });
      this.saveState();
      this.publish(true);
      this.raiseReady(rec.id);
      this.log(`result #${rec.id}: ${result.status}${result.err ? ' (' + result.err + ')' : ''}`);
    }).catch((e) => this.log(`result #${rec.id} failed: ${e && e.stack || e}`))
      .finally(() => { this.inflight.delete(p); this.checkIdle(); });
    this.inflight.add(p);
  }

  checkIdle() {
    if (this.inflight.size) return;
    const w = this.idleWaiters; this.idleWaiters = [];
    for (const f of w) f();
  }

  // Resolves once no AI request is in flight.
  idle() { return this.inflight.size ? new Promise(r => this.idleWaiters.push(r)) : Promise.resolve(); }

  // Requests that were in flight when the bridge last stopped are run again.
  resumePending() {
    const recs = Object.values(this.state.pending).filter(r => r && r.session === this.state.session && r.id);
    for (const rec of recs) { this.log(`resuming request #${rec.id}`); this.dispatch(rec); }
    return recs.length;
  }

  // -------------------------------------------------------------------------
  // Capture child process
  // -------------------------------------------------------------------------

  captureCommand() {
    const cap = this.cfg.capture;
    if (Array.isArray(cap.command) && cap.command.length) return [cap.command[0], cap.command.slice(1)];
    if (process.platform !== 'win32') return null;
    return ['powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', path.join(HERE, 'capture.ps1'),
      '-Cell', String(cap.cellPx), '-Cells', String(cap.cellsPerRow), '-MaxRows', String(cap.maxRows),
      '-IntervalMs', String(cap.intervalMs), '-ProcessName', cap.processName, '-Corner', cap.corner,
      '-ParentPid', String(process.pid)]];
  }

  startCapture() {
    if (this.stopped) return;
    const c = this.captureCommand();
    if (!c) { this.log('capture: only available on Windows (capture.ps1); not started'); return; }
    const [cmd, args] = c;
    const ps = spawn(cmd, args, { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    this.captureProc = ps;
    const rl = readline.createInterface({ input: ps.stdout });
    rl.on('line', line => this.handleCaptureLine(line));
    ps.stderr.on('data', d => this.log('capture stderr:', String(d).trim().slice(0, 300)));
    ps.on('error', err => this.log(`capture could not start (${cmd}): ${err.message}`));
    ps.on('close', (code) => {
      if (this.captureProc === ps) this.captureProc = null;
      if (this.stopped) return;
      this.log(`capture exited (${code}); restarting in 5 s`);
      this.timers.push(setTimeout(() => this.startCapture(), 5000));
    });
  }

  // -------------------------------------------------------------------------
  // Lifecycle
  // -------------------------------------------------------------------------

  banner() {
    const cmd = this.runner.cmd || { found: true, file: '(custom runner)', args: [] };
    const lines = [
      'WoW Chat Helper bridge',
      `  addons   : ${this.cfg.addonDir || '(wowPath not set in config.json)'}`,
      `  addon    : ${this.addonInstalled() ? 'installed' : 'NOT INSTALLED - run: node setup.js, then restart WoW'}`,
      `  slots    : ${this.slotsInstalled() ? this.cfg.slots + ' installed' : 'NOT INSTALLED - run: node setup.js, then restart WoW'}`,
      `  claude   : ${cmd.found ? [cmd.file, ...cmd.args].join(' ') : 'NOT FOUND - ' + (cmd.note || '')}`,
      `  models   : explain ${this.cfg.models.explain}, translate ${this.cfg.models.translate}, detail ${this.cfg.models.detail}; ${this.cfg.persistent ? 'persistent' : 'one-shot'} mode, batch window ${this.cfg.batchWindowMs} ms`,
      `  capture  : ${this.cfg.capture.enabled ? `${this.cfg.capture.processName}, ${this.cfg.capture.corner}, every ${this.cfg.capture.intervalMs} ms` : 'off'}`,
      `  session  : ${this.state.session || '(waiting for the addon hello)'}`,
      `  language : ${this.locale()} (from the addon hello: lang=, else the client locale)`,
    ];
    const g = this.runner.glossary;
    if (g) lines.push(`  glossary : ${g.size ? g.size + ' terms from ' + g.file : 'NONE - prompts go without known terms (data/glossary/terms.json missing?)'}`);
    if (!cmd.found) lines.push('  !! Claude Code CLI not found: every request will come back as an error until it is installed and logged in.');
    return lines.join('\n');
  }

  // Banner follow-up: is the CLI logged in? Logs a warning line when it is not.
  async checkClaude() {
    if (typeof this.runner.checkLogin !== 'function' || (this.runner.cmd && !this.runner.cmd.found)) return null;
    const r = await this.runner.checkLogin();
    if (r.ok) this.log('claude   : login ok');
    else if (r.loggedOut) this.log(`  !! Claude Code CLI is not logged in (${r.err}). Run \`claude\` once in a terminal and log in; until then every request comes back as an error.`);
    else this.log(`  !! Claude Code CLI check failed: ${r.err}`);
    return r;
  }

  // opts: { capture: bool, presence: bool }
  start(opts = {}) {
    this.publishNow();
    this.resumePending();
    if (opts.presence !== false) {
      this.presenceBeat();
      const t = setInterval(() => this.presenceBeat(), this.cfg.presenceIntervalMs);
      this.timers.push(t);
    }
    if (opts.capture !== false && this.cfg.capture.enabled) this.startCapture();
  }

  // Synchronous best-effort kill of every child process (process 'exit' handler).
  kill() {
    this.stopped = true;
    if (this.captureProc) { try { ai.killTree(this.captureProc); } catch {} }
    try { this.runner.stop(); } catch {}
  }

  stop() {
    this.stopped = true;
    for (const t of this.timers) { clearTimeout(t); clearInterval(t); }
    if (this.publishTimer) { clearTimeout(this.publishTimer); this.publishTimer = null; }
    if (this.retryTimer) { clearTimeout(this.retryTimer); this.retryTimer = null; }
    if (this.captureProc) { try { ai.killTree(this.captureProc); } catch {} }
    try { this.runner.stop(); } catch {}
    this.saveState();
  }
}

function createBridge(cfg, opts) { return new Bridge(cfg, opts); }

// Inject file -> array of { records } | { line } items.
function readInjectFile(file) {
  const out = [];
  for (const raw of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    const v = JSON.parse(line);
    if (v && typeof v === 'object' && typeof v.kind === 'string') {
      out.push({ records: [{ session: '', channel: '', sender: '', model: '', ctx: '', text: '', ...v, id: Number(v.id) }] });
    } else out.push({ line });
  }
  return out;
}

async function main(argv) {
  const arg = (name) => { const i = argv.indexOf('--' + name); return i >= 0 ? argv[i + 1] : undefined; };
  if (argv.includes('--help')) {
    console.log('node bridge/bridge.js [--config <file>] [--state <file>] [--inject <file>] [--no-capture]');
    process.exit(0);
  }
  const configFile = path.resolve(arg('config') || path.join(HERE, 'config.json'));
  const raw = readJson(configFile, null);
  if (!raw) {
    console.error(`No config at ${configFile}. Run: node setup.js (or copy bridge/config.example.json to bridge/config.json and set wowPath).`);
    process.exit(2);
  }
  const cfg = resolveConfig(raw);
  if (!cfg.addonDir) { console.error('config.json: set wowPath (the WoW client folder).'); process.exit(2); }
  const bridge = createBridge(cfg, { stateFile: arg('state') ? path.resolve(arg('state')) : undefined, workDir: cfg.workDir || undefined });
  console.log(bridge.banner());
  const injectFile = arg('inject');
  if (injectFile) {
    bridge.publishNow();
    for (const item of readInjectFile(injectFile)) {
      if (item.records) bridge.handleRecords(item.records);
      else bridge.handleCaptureLine(item.line);
    }
    await bridge.idle();
    bridge.stop();
    process.exit(0);
  }
  console.log('Leave this window open while you play. Ctrl+C to stop.\n');
  bridge.start({ capture: !argv.includes('--no-capture') });
  if (cfg.startupCheck !== false) bridge.checkClaude().catch(() => {});
  const stop = () => { bridge.stop(); process.exit(0); };
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
  // Windows does not kill child processes with their parent: on any exit (including a
  // crash) take capture.ps1 and the claude processes down too. capture.ps1 also exits
  // by itself once this process is gone (-ParentPid).
  process.on('exit', () => { if (!bridge.stopped) { try { bridge.kill(); } catch {} } });
  process.on('uncaughtException', (e) => { console.error(e); try { bridge.kill(); } catch {} process.exit(1); });
}

if (require.main === module) main(process.argv.slice(2)).catch((e) => { console.error(e); process.exit(1); });

module.exports = { Bridge, createBridge, resolveConfig, readInjectFile, atomicWrite, CONFIG_DEFAULTS, main };
