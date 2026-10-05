// Tests for bridge/bridge.js, bridge/install-slots.js, setup.js and bridge/supervisor.js,
// against a temporary fake WoW folder and tests/fakes/fake-claude.js (no network).
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn, spawnSync } = require('child_process');
const P = require('../bridge/protocol');
const B = require('../bridge/bridge');
const { installSlots, SILENT_WAV } = require('../bridge/install-slots');
const { setup, copyGlossaryAddons, removeStaleGlossary } = require('../setup');
const { createVM } = require('./helpers/lua');

const ROOT = path.join(__dirname, '..');
const FAKE = path.join(__dirname, 'fakes', 'fake-claude.js');
const FAKE_CAPTURE = path.join(__dirname, 'fakes', 'fake-capture.js');
const INJECT = path.join(__dirname, 'fixtures', 'inject.jsonl');
const TERMS = path.join(__dirname, 'fixtures', 'terms.json');

function tmpdir(prefix = 'wch-bridge-') { return fs.mkdtempSync(path.join(os.tmpdir(), prefix)); }

// A fake client folder: World of Warcraft/_forever_/{Wow.exe, Interface/AddOns}.
function fakeClient() {
  const dir = tmpdir('wch-wow-');
  const client = path.join(dir, 'World of Warcraft', '_forever_');
  fs.mkdirSync(path.join(client, 'Interface', 'AddOns'), { recursive: true });
  fs.writeFileSync(path.join(client, 'Wow.exe'), 'MZ');
  return { dir, client, addons: path.join(client, 'Interface', 'AddOns') };
}

// setup.js into a fake client, with config/state/log in a temp folder.
function installed() {
  const w = fakeClient();
  const configFile = path.join(w.dir, 'config.json');
  const lines = [];
  const res = setup(['--wow', w.client, '--config', configFile, '--claude', FAKE], (l) => lines.push(l));
  const logFile = path.join(w.dir, 'fake.log');
  process.env.FAKE_CLAUDE_LOG = logFile;
  process.env.FAKE_CLAUDE_STATE = path.join(w.dir, 'fake-state');
  const events = () => (fs.existsSync(logFile) ? fs.readFileSync(logFile, 'utf8').trim().split('\n').filter(Boolean).map(l => JSON.parse(l)) : []);
  return { ...w, configFile, res, lines, events, stateFile: path.join(w.dir, 'state.json'), workDir: path.join(w.dir, 'cwd') };
}

function makeBridge(w, cfgOver = {}) {
  const cfg = { ...JSON.parse(fs.readFileSync(w.configFile, 'utf8')), batchWindowMs: 50, timeoutMs: 10000, glossaryFile: TERMS, ...cfgOver };
  const logs = [];
  const bridge = B.createBridge(cfg, { stateFile: w.stateFile, workDir: w.workDir, log: (...a) => logs.push(a.join(' ')) });
  return { bridge, logs };
}

const sigFile = (w, kind, n) => path.join(w.addons, 'WoWChatHelper', ...P.signalPath(kind, n).split('/'));
const raised = (w, kind, n) => fs.readFileSync(sigFile(w, kind, n)).length > 0;
const slotSrc = (w, n) => fs.readFileSync(path.join(w.addons, P.slotAddonName(n), 'Inbox.lua'), 'utf8');

// Run a slot file in the Lua VM (as the client would) and read WCH_SlotData back.
function loadSlot(src) {
  const vm = createVM({ files: [], checkSyntax: false });
  vm.run(src);
  return vm.eval('WCH_SlotData');
}

function rec(id, kind, text, extra = {}) {
  return { session: 'sessA', id, kind, channel: 'PARTY', sender: 'Bob', model: '', ctx: '', text, ...extra };
}

// ---------------------------------------------------------------------------
// setup.js / install-slots.js
// ---------------------------------------------------------------------------

test('setup: copies the addon, writes config.json, finds claude, builds slots and signals', () => {
  const w = installed();
  const { res } = w;
  assert.strictEqual(res.client, w.client);
  const dest = path.join(w.addons, 'WoWChatHelper');
  for (const f of fs.readdirSync(path.join(ROOT, 'addon', 'WoWChatHelper'))) {
    assert.ok(fs.existsSync(path.join(dest, f)), 'copied ' + f);
  }
  const cfg = JSON.parse(fs.readFileSync(w.configFile, 'utf8'));
  assert.strictEqual(cfg.wowPath, w.client);
  assert.strictEqual(cfg.claudePath, FAKE);
  assert.strictEqual(cfg.capture.processName, 'Wow');
  assert.strictEqual(cfg.persistent, true);
  assert.deepStrictEqual(cfg.models, { explain: 'haiku', translate: 'haiku', detail: 'sonnet' });
  assert.strictEqual(res.claude.found, true);
  assert.match(res.claude.version, /Claude Code/);
  for (const n of [1, 77, 200]) {
    const name = P.slotAddonName(n);
    const toc = fs.readFileSync(path.join(w.addons, name, name + '.toc'), 'utf8');
    assert.match(toc, /^## Interface: 16001$/m);
    assert.match(toc, /^## LoadOnDemand: 1$/m);
    assert.match(toc, /^Inbox\.lua$/m);
    assert.strictEqual(fs.readFileSync(path.join(w.addons, name, 'Inbox.lua'), 'utf8'), 'WCH_SlotData = nil\n');
  }
  assert.ok(!fs.existsSync(path.join(w.addons, 'WoWChatHelper_S201')));
  const sig = path.join(dest, 'sig');
  assert.strictEqual(fs.readdirSync(path.join(sig, 'ready')).length, 200);
  assert.strictEqual(fs.readdirSync(path.join(sig, 'ack')).length, 200);
  assert.strictEqual(fs.readdirSync(path.join(sig, 'presence')).length, 2000);
  assert.ok(fs.existsSync(path.join(sig, 'ready', '001.wav')) && fs.existsSync(path.join(sig, 'presence', '2000.wav')));
  assert.strictEqual(fs.statSync(path.join(sig, 'ready', '200.wav')).size, 0);
  assert.strictEqual(fs.statSync(path.join(sig, 'ctl', 'empty.wav')).size, 0);
  assert.deepStrictEqual(fs.readFileSync(path.join(sig, 'ctl', 'valid.wav')), SILENT_WAV);
  assert.strictEqual(SILENT_WAV.toString('latin1', 0, 4), 'RIFF');
  assert.strictEqual(SILENT_WAV.toString('latin1', 8, 12), 'WAVE');
});

test('setup: re-running keeps config, generated files and the bridge-owned Inbox.lua', () => {
  const w = installed();
  const inbox = path.join(w.addons, 'WoWChatHelper', 'Inbox.lua');
  fs.writeFileSync(inbox, 'WCH_SlotData = { v = 1 }\n');
  const cfg = JSON.parse(fs.readFileSync(w.configFile, 'utf8'));
  cfg.timeoutMs = 12345;
  fs.writeFileSync(w.configFile, JSON.stringify(cfg));
  const lines = [];
  const res = setup(['--wow', path.join(w.dir, 'World of Warcraft'), '--config', w.configFile], l => lines.push(l));
  assert.strictEqual(res.client, w.client, '--wow may point at the World of Warcraft folder');
  assert.strictEqual(res.made, 0);
  assert.ok(res.kept >= 200 * 4 + 2000 + 2);
  assert.strictEqual(fs.readFileSync(inbox, 'utf8'), 'WCH_SlotData = { v = 1 }\n');
  assert.strictEqual(JSON.parse(fs.readFileSync(w.configFile, 'utf8')).timeoutMs, 12345);
  assert.ok(lines.some(l => /already exists, keeping it/.test(l)));
});

test('setup: a folder that is not a client is refused', () => {
  const dir = tmpdir();
  assert.throws(() => setup(['--wow', dir, '--config', path.join(dir, 'c.json')], () => {}), /does not look like a WoW client/);
});

test('setup: works on a Windows-style path with spaces (cli run)', () => {
  const w = fakeClient();
  const configFile = path.join(w.dir, 'my config', 'config.json');
  const r = spawnSync(process.execPath, [path.join(ROOT, 'setup.js'), '--wow', w.client, '--config', configFile, '--claude', FAKE], { encoding: 'utf8' });
  assert.strictEqual(r.status, 0, r.stderr);
  assert.match(r.stdout, /client {3}: .*World of Warcraft/);
  assert.match(r.stdout, /claude {3}: .*fake-claude\.js {2}\(2\.1\.289 \(Claude Code\)\)/);
  assert.ok(fs.existsSync(path.join(w.addons, 'WoWChatHelper_S200', 'Inbox.lua')));
});

test('install-slots: configurable counts, idempotent', () => {
  const dir = tmpdir();
  const a = installSlots(dir, { slots: 3, presenceMax: 5, tocInterface: '11507' });
  assert.strictEqual(a.made, 3 * 4 + 5 + 2);
  assert.match(fs.readFileSync(path.join(dir, 'WoWChatHelper_S003', 'WoWChatHelper_S003.toc'), 'utf8'), /## Interface: 11507/);
  assert.deepStrictEqual(installSlots(dir, { slots: 3, presenceMax: 5 }), { made: 0, kept: a.made });
});

// ---------------------------------------------------------------------------
// The bridge flow
// ---------------------------------------------------------------------------

test('records -> ack, working, AI, slot files with results, ready signals, state.json', async () => {
  const w = installed();
  const { bridge } = makeBridge(w);
  try {
    bridge.handleRecords([
      rec(1, 'h', 'v=1;stripCorner=TOPLEFT'),
      rec(2, 'x', 'LF1M tank HC DM, inv', { channel: 'CHANNEL:LookingForGroup', sender: 'Grimtusk' }),
      rec(3, 't', '我五分鐘後到', { channel: 'WHISPER', sender: 'Thalric' }),
    ]);
    // Synchronously after receipt: ack for the highest id, working status in every slot.
    assert.ok(raised(w, 'ack', 3), 'ack/003 raised');
    assert.ok(!raised(w, 'ack', 2), 'only the highest id is acked');
    const working = loadSlot(slotSrc(w, 1));
    assert.strictEqual(working.session, 'sessA');
    assert.deepStrictEqual(working.results, [{ id: 2, kind: 'x', status: 'working' }, { id: 3, kind: 't', status: 'working' }]);
    assert.ok(!raised(w, 'ready', 2));
    assert.deepStrictEqual(bridge.state.settings, { v: '1', stripCorner: 'TOPLEFT' });

    await bridge.idle();
    for (const src of [slotSrc(w, 1), slotSrc(w, 200), fs.readFileSync(path.join(w.addons, 'WoWChatHelper', 'Inbox.lua'), 'utf8')]) {
      const data = loadSlot(src);
      assert.strictEqual(data.v, 1);
      assert.strictEqual(typeof data.now, 'number');
      const [x, t] = data.results;
      assert.deepStrictEqual(x, { id: 2, kind: 'x', status: 'done', lang: 'zhTW', tr: '譯：LF1M tank HC DM, inv',
        terms: [{ term: 'LF1M', expansion: 'Looking For 1 More', tr: '還缺一人' }],
        replies: [{ en: 'inv pls', tr: '請邀我', tone: 'casual' }, { en: 'Hi, could I get an invite?', tr: '嗨，可以邀我嗎？', tone: 'polite' }] });
      assert.strictEqual(t.status, 'done');
      assert.strictEqual(t.replies[0].en, 'omw, 5 min');
    }
    assert.ok(raised(w, 'ready', 2) && raised(w, 'ready', 3));
    // Both requests went out as one persistent turn.
    assert.deepStrictEqual(w.events().filter(e => e.event === 'turn').map(e => e.ids), [[2, 3]]);
    const st = JSON.parse(fs.readFileSync(w.stateFile, 'utf8'));
    assert.strictEqual(st.session, 'sessA');
    assert.deepStrictEqual(st.handled, { sessA: [1, 2, 3] });
    assert.deepStrictEqual(st.results.map(r => [r.id, r.status]), [[2, 'done'], [3, 'done']]);
    assert.deepStrictEqual(st.pending, {});
  } finally { bridge.stop(); }
});

test('dedup on (session, id): a re-shown frame is acked again but not re-run', async () => {
  const w = installed();
  const { bridge } = makeBridge(w);
  try {
    const frame = [rec(5, 'x', 'need or greed?')];
    bridge.handleRecords(frame);
    await bridge.idle();
    fs.writeFileSync(sigFile(w, 'ack', 5), '');
    bridge.handleRecords(frame);
    assert.ok(raised(w, 'ack', 5), 'acked again so the strip comes down');
    await bridge.idle();
    assert.strictEqual(w.events().filter(e => e.event === 'turn').length, 1);
    // Same id in another session is a new request.
    bridge.handleRecords([{ ...frame[0], session: 'sessB' }]);
    await bridge.idle();
    assert.strictEqual(w.events().filter(e => e.event === 'turn').length, 2);
    assert.strictEqual(bridge.state.session, 'sessB');
    assert.deepStrictEqual(loadSlot(slotSrc(w, 9)).results.map(r => r.id), [5], 'old session results are not shown');
  } finally { bridge.stop(); }
});

test('dedup survives a bridge restart (state.json)', async () => {
  const w = installed();
  let { bridge } = makeBridge(w);
  bridge.handleRecords([rec(1, 'x', 'gg')]);
  await bridge.idle();
  bridge.stop();
  ({ bridge } = makeBridge(w));
  try {
    bridge.handleRecords([rec(1, 'x', 'gg')]);
    await bridge.idle();
    assert.strictEqual(w.events().filter(e => e.event === 'turn').length, 1);
    assert.deepStrictEqual(loadSlot(bridge.slotSource()).results.map(r => r.status), ['done']);
  } finally { bridge.stop(); }
});

test('requests in flight when the bridge stopped are run again on start', async () => {
  const w = installed();
  fs.writeFileSync(w.stateFile, JSON.stringify({
    session: 'sessA', handled: { sessA: [4] }, results: [{ id: 4, kind: 'x', status: 'working' }],
    pending: { 4: rec(4, 'x', 'brb') },
  }));
  const { bridge } = makeBridge(w);
  try {
    bridge.start({ capture: false, presence: false });
    await bridge.idle();
    assert.deepStrictEqual(loadSlot(slotSrc(w, 1)).results.map(r => [r.id, r.status]), [[4, 'done']]);
    assert.ok(raised(w, 'ready', 4));
  } finally { bridge.stop(); }
});

test('errors are published as status=error with err', async () => {
  const w = installed();
  const { bridge } = makeBridge(w);
  try {
    bridge.handleRecords([rec(1, 'x', 'nope #invalid'), rec(2, 'x', 'login #autherr')]);
    await bridge.idle();
    const results = loadSlot(slotSrc(w, 1)).results;
    assert.deepStrictEqual(results.find(r => r.id === 1), { id: 1, kind: 'x', status: 'error', err: 'invalid reply', lang: 'zhTW' });
    assert.match(results.find(r => r.id === 2).err, /claude not logged in/);
    assert.ok(raised(w, 'ready', 1) && raised(w, 'ready', 2));
  } finally { bridge.stop(); }
});

test('missing claude CLI: every request gets an error result, banner says so', async () => {
  const w = installed();
  const { bridge } = makeBridge(w, { claudePath: path.join(w.dir, 'no-claude.exe') });
  try {
    assert.match(bridge.banner(), /NOT FOUND/);
    bridge.handleRecords([rec(1, 'x', 'hi')]);
    await bridge.idle();
    const r = loadSlot(slotSrc(w, 1)).results[0];
    assert.strictEqual(r.status, 'error');
    assert.match(r.err, /claude CLI not found/);
  } finally { bridge.stop(); }
});

test('slot files are safe for any UTF-8, quotes and newlines, and keep 100 results', async () => {
  const w = installed();
  const { bridge } = makeBridge(w);
  try {
    for (let i = 1; i <= 105; i++) bridge.setResult({ id: i, kind: 'd', status: 'done', detail: `語氣："ok" \\ ]]\n第${i}行 \u0001 🐉` });
    bridge.state.session = 'sess"]]';
    bridge.publishNow();
    const data = loadSlot(slotSrc(w, 123));
    assert.strictEqual(data.session, 'sess"]]');
    assert.strictEqual(data.results.length, 100);
    assert.strictEqual(data.results[0].id, 6);
    assert.strictEqual(data.results[99].detail, '語氣："ok" \\ ]]\n第105行 \u0001 🐉');
    // No temp files left behind by the atomic writes.
    assert.deepStrictEqual(fs.readdirSync(path.join(w.addons, 'WoWChatHelper_S001')).sort(), ['Inbox.lua', 'WoWChatHelper_S001.toc']);
  } finally { bridge.stop(); }
});

test('signal files ahead of a new id are emptied (stale signals from an earlier run)', async () => {
  const w = installed();
  const { bridge } = makeBridge(w);
  try {
    for (const n of [7, 8, 57]) { fs.writeFileSync(sigFile(w, 'ready', n), SILENT_WAV); fs.writeFileSync(sigFile(w, 'ack', n), SILENT_WAV); }
    bridge.handleRecords([rec(7, 'h', '')]);
    bridge.handleRecords([rec(8, 'x', 'hi #slow:50')]);
    assert.ok(!raised(w, 'ready', 8), 'its own ready file is emptied');
    assert.ok(raised(w, 'ack', 8), 'and the ack is raised');
    assert.ok(!raised(w, 'ready', 57) && !raised(w, 'ack', 57), 'the 50 ahead are emptied');
    await bridge.idle();
  } finally { bridge.stop(); }
});

test('presence beats: next file valid, 50 ahead empty, counter persists and wraps', () => {
  const w = installed();
  let { bridge } = makeBridge(w, { presenceMax: 60 });
  fs.writeFileSync(sigFile(w, 'presence', 3), SILENT_WAV);
  bridge.presenceBeat();
  bridge.presenceBeat();
  assert.ok(raised(w, 'presence', 1) && raised(w, 'presence', 2));
  assert.ok(!raised(w, 'presence', 3), 'files ahead of the counter are kept empty');
  bridge.stop();
  ({ bridge } = makeBridge(w, { presenceMax: 60 }));
  bridge.state.presence = 59;
  bridge.presenceBeat();
  bridge.presenceBeat();
  assert.strictEqual(bridge.state.presence, 1, 'wraps at presenceMax');
  assert.strictEqual(JSON.parse(fs.readFileSync(w.stateFile, 'utf8')).presence, 1);
  bridge.stop();
});

test('capture lines: {id,text} and raw {cells} frames are decoded; info/warn/garbage ignored', async () => {
  const w = installed();
  const { bridge, logs } = makeBridge(w);
  try {
    const payload = P.encodeRecords([rec(1, 'h', 'v=1'), rec(2, 'x', '中文 test')]);
    bridge.handleCaptureLine(JSON.stringify({ info: 'attached' }));
    bridge.handleCaptureLine('not json');
    bridge.handleCaptureLine(JSON.stringify({ id: 9, text: payload }));
    const cells = P.encodeFrame(10, P.encodeRecords([rec(3, 'x', 'ty')])).join('');
    bridge.handleCaptureLine(JSON.stringify({ cells }));
    const bad = P.encodeFrame(11, 'zz').map((c, i) => (i === 20 ? (c ^ 1) : c)).join('');
    bridge.handleCaptureLine(JSON.stringify({ cells: bad }));
    await bridge.idle();
    assert.deepStrictEqual(loadSlot(slotSrc(w, 1)).results.map(r => [r.id, r.status]), [[2, 'done'], [3, 'done']]);
    assert.ok(logs.some(l => /capture: attached/.test(l)));
    assert.ok(logs.some(l => /rejected: checksum/.test(l)));
  } finally { bridge.stop(); }
});

test('capture child process: lines from the capture command reach the AI and the slots', async () => {
  const w = installed();
  const lines = path.join(w.dir, 'capture.jsonl');
  fs.writeFileSync(lines, [
    JSON.stringify({ info: 'attached to fake' }),
    JSON.stringify({ id: 1, text: P.encodeRecords([rec(1, 'h', ''), rec(2, 'x', 'omw')]) }),
  ].join('\n') + '\n');
  const { bridge } = makeBridge(w, { capture: { enabled: true, command: [process.execPath, FAKE_CAPTURE, lines] } });
  try {
    bridge.start({ presence: false });
    const t0 = Date.now();
    while (!raised(w, 'ready', 2) && Date.now() - t0 < 8000) await new Promise(r => setTimeout(r, 50));
    assert.ok(raised(w, 'ready', 2));
    assert.strictEqual(loadSlot(slotSrc(w, 1)).results[0].status, 'done');
  } finally { bridge.stop(); }
});

test('cli: --inject runs records through the bridge and exits when done', () => {
  const w = installed();
  const r = spawnSync(process.execPath, [path.join(ROOT, 'bridge', 'bridge.js'), '--config', w.configFile, '--state', w.stateFile, '--inject', INJECT],
    { encoding: 'utf8', env: { ...process.env }, timeout: 30000 });
  assert.strictEqual(r.status, 0, r.stdout + r.stderr);
  assert.match(r.stdout, /WoW Chat Helper bridge/);
  const data = loadSlot(slotSrc(w, 50));
  assert.strictEqual(data.session, 'sessA');
  assert.deepStrictEqual(data.results.map(x => [x.id, x.kind, x.status]), [[2, 'x', 'done'], [3, 't', 'done'], [4, 'd', 'done']]);
  assert.match(data.results[2].detail, /need or greed/);
  for (const id of [2, 3, 4]) assert.ok(raised(w, 'ready', id));
  assert.ok(raised(w, 'ack', 4));
  const starts = w.events().filter(e => e.event === 'start').map(e => [e.mode, e.model]);
  assert.deepStrictEqual(starts.sort(), [['oneshot', 'sonnet'], ['persistent', 'haiku']]);
});

test('cli: missing config exits 2; supervisor does not loop on exit 2', () => {
  const dir = tmpdir();
  const r = spawnSync(process.execPath, [path.join(ROOT, 'bridge', 'bridge.js'), '--config', path.join(dir, 'none.json')], { encoding: 'utf8' });
  assert.strictEqual(r.status, 2);
  assert.match(r.stderr, /No config/);
  const s = spawnSync(process.execPath, [path.join(ROOT, 'bridge', 'supervisor.js'), '--config', path.join(dir, 'none.json')], { encoding: 'utf8', timeout: 10000 });
  assert.strictEqual(s.status, 2);
});

test('supervisor restarts the bridge 3 s after a crash', async () => {
  const dir = tmpdir();
  // wowPath must be a string: path.join throws, the bridge exits 1 (a crash, not exit 2).
  const cfgFile = path.join(dir, 'bad.json');
  fs.writeFileSync(cfgFile, '{"wowPath": 5}');
  const child = spawn(process.execPath, [path.join(ROOT, 'bridge', 'supervisor.js'), '--config', cfgFile], { stdio: ['ignore', 'pipe', 'pipe'] });
  let out = '';
  child.stdout.on('data', d => { out += d; });
  child.stderr.on('data', d => { out += d; });
  const t0 = Date.now();
  while (!/restarting in 3 s[\s\S]*restarting in 3 s/.test(out) && Date.now() - t0 < 9000) await new Promise(r => setTimeout(r, 100));
  child.kill('SIGTERM');
  assert.match(out, /bridge exited \(1\); restarting in 3 s/);
  assert.ok(Date.now() - t0 >= 3000, 'waited 3 s between runs');
});

test('publish survives Windows EPERM renames: retried, slots still written, ready waits for a full publish', async () => {
  const w = installed();
  const { bridge, logs } = makeBridge(w, { publishRetryMs: 100 });
  const realRename = fs.renameSync;
  const eperm = (to) => { const e = new Error(`EPERM: operation not permitted, rename -> ${to}`); e.code = 'EPERM'; return e; };
  let blockedSlot = path.join(w.addons, P.slotAddonName(7), 'Inbox.lua');
  let inboxFails = 2; // a short AV scan: atomicWrite's own retries get past it
  fs.renameSync = (from, to) => {
    if (to === path.join(w.addons, 'WoWChatHelper', 'Inbox.lua') && inboxFails > 0) { inboxFails--; throw eperm(to); }
    if (blockedSlot && to === blockedSlot) throw eperm(to); // held open for longer
    return realRename(from, to);
  };
  try {
    bridge.handleRecords([rec(1, 'x', 'lf1m tank')]);
    assert.strictEqual(inboxFails, 0);
    assert.match(fs.readFileSync(path.join(w.addons, 'WoWChatHelper', 'Inbox.lua'), 'utf8'), /status = "working"/);
    assert.match(slotSrc(w, 8), /status = "working"/, 'slots written although a rename failed');
    await bridge.idle();
    assert.match(slotSrc(w, 8), /status = "done"/);
    assert.ok(!raised(w, 'ready', 1), 'ready waits while slot 7 has not got the result');
    assert.ok(logs.some(l => /publish: 1 file\(s\) not written \(EPERM\)/.test(l)), logs.join('\n'));
    blockedSlot = null; // the scan is over
    await new Promise(r => setTimeout(r, 250));
    assert.match(slotSrc(w, 7), /status = "done"/, 'retried');
    assert.ok(raised(w, 'ready', 1), 'ready raised after the retry reached every slot');
  } finally { fs.renameSync = realRename; bridge.stop(); }
});

test('checkClaude: a logged-out CLI is named in the bridge window at startup', async () => {
  const w = installed();
  const { bridge, logs } = makeBridge(w);
  bridge.runner.checkLogin = async () => ({ ok: false, loggedOut: true, err: 'claude not logged in: Invalid API key' });
  try {
    await bridge.checkClaude();
    assert.ok(logs.some(l => /!! Claude Code CLI is not logged in/.test(l)), logs.join('\n'));
  } finally { bridge.stop(); }
});

// ---------------------------------------------------------------------------
// Language and glossary addons
// ---------------------------------------------------------------------------

test('hello lang=<code> sets the language of every request; client locale is the fallback; zhTW last', async () => {
  const w = installed();
  const { bridge, logs } = makeBridge(w);
  try {
    assert.strictEqual(bridge.locale(), 'zhTW', 'no hello yet');
    bridge.handleRecords([rec(1, 'h', 'addon=0.1;locale=zhTW;lang=deDE'), rec(2, 'x', "ah isn't down for everyone", { channel: 'YELL' })]);
    assert.strictEqual(bridge.locale(), 'deDE');
    await bridge.idle();
    bridge.handleRecords([rec(3, 'h', 'locale=frFR'), rec(4, 'x', 'inv pls')]);
    assert.strictEqual(bridge.locale(), 'frFR', 'client locale when no lang');
    await bridge.idle();
    bridge.handleRecords([rec(5, 'h', 'locale=enUS;lang=xxXX'), rec(6, 'x', 'ty')]);
    assert.strictEqual(bridge.locale(), 'zhTW', 'unsupported -> zhTW');
    assert.ok(logs.some(l => /unsupported lang=xxXX/.test(l)));
    await bridge.idle();
    bridge.handleRecords([rec(7, 'h', 'locale=esMX'), rec(8, 'x', 'ty')]);
    assert.strictEqual(bridge.locale(), 'esES', 'esMX answered in esES');
    await bridge.idle();
    const turns = w.events().filter(e => e.event === 'turn');
    assert.deepStrictEqual(turns.map(t => [t.ids.join(), t.lang]), [['2', 'deDE'], ['4', 'frFR'], ['6', 'zhTW'], ['8', 'esES']]);
    assert.match(turns[0].prompt, /Known WoW terms in this message:\n#2 "ah": AH = Auction House \| Auktionshaus/);
    // Each published result names the language it was written in (the addon files
    // learned terms under it even if the player switched language meanwhile).
    const results = loadSlot(slotSrc(w, 1)).results;
    const x = results.find(r => r.id === 2);
    assert.strictEqual(x.status, 'done');
    assert.strictEqual(x.lang, 'deDE');
    assert.strictEqual(results.find(r => r.id === 4).lang, 'frFR');
    assert.match(bridge.banner(), /language : esES/);
    assert.match(bridge.banner(), /glossary : 9 terms from .*terms\.json/);
  } finally { bridge.stop(); }
});

test('setup: copies every WoWChatHelper_Glossary_<locale> addon and removes the old Glossary.lua', () => {
  const w = fakeClient();
  const src = tmpdir('wch-addon-src-');
  for (const loc of ['zhTW', 'deDE']) {
    const d = path.join(src, 'WoWChatHelper_Glossary_' + loc);
    fs.mkdirSync(d, { recursive: true });
    fs.writeFileSync(path.join(d, `WoWChatHelper_Glossary_${loc}.toc`), '## Interface: 16001\n## LoadOnDemand: 1\nGlossary.lua\n');
    fs.writeFileSync(path.join(d, 'Glossary.lua'), `WCH_Glossary = { locale = "${loc}", terms = {}, phrases = {} }\n`);
  }
  fs.mkdirSync(path.join(src, 'WoWChatHelper'));
  fs.mkdirSync(path.join(src, 'SomethingElse'));
  const r = copyGlossaryAddons(w.client, src);
  assert.deepStrictEqual(r, { names: ['WoWChatHelper_Glossary_deDE', 'WoWChatHelper_Glossary_zhTW'], copied: 4 });
  assert.strictEqual(fs.readFileSync(path.join(w.addons, 'WoWChatHelper_Glossary_deDE', 'Glossary.lua'), 'utf8'), 'WCH_Glossary = { locale = "deDE", terms = {}, phrases = {} }\n');
  assert.ok(!fs.existsSync(path.join(w.addons, 'SomethingElse')));
  // Re-running overwrites with the new build.
  fs.writeFileSync(path.join(src, 'WoWChatHelper_Glossary_zhTW', 'Glossary.lua'), 'WCH_Glossary = { locale = "zhTW", v = 2 }\n');
  copyGlossaryAddons(w.client, src);
  assert.match(fs.readFileSync(path.join(w.addons, 'WoWChatHelper_Glossary_zhTW', 'Glossary.lua'), 'utf8'), /v = 2/);
  // An installed Glossary.lua of an older build goes once the source has none; kept while it does.
  const main = path.join(w.addons, 'WoWChatHelper');
  fs.mkdirSync(main, { recursive: true });
  fs.writeFileSync(path.join(main, 'Glossary.lua'), 'old');
  fs.writeFileSync(path.join(src, 'WoWChatHelper', 'Glossary.lua'), 'still here');
  assert.strictEqual(removeStaleGlossary(w.client, path.join(src, 'WoWChatHelper')), false);
  fs.unlinkSync(path.join(src, 'WoWChatHelper', 'Glossary.lua'));
  assert.strictEqual(removeStaleGlossary(w.client, path.join(src, 'WoWChatHelper')), true);
  assert.ok(!fs.existsSync(path.join(main, 'Glossary.lua')));
  // A source with no glossary addons copies nothing.
  assert.deepStrictEqual(copyGlossaryAddons(w.client, tmpdir('wch-empty-')), { names: [], copied: 0 });
});

test('setup: installs the repo glossary addons that exist and reports them', () => {
  const w = installed();
  const names = fs.readdirSync(path.join(ROOT, 'addon')).filter(n => n.startsWith('WoWChatHelper_Glossary_')).sort();
  assert.deepStrictEqual(w.res.glossary.names, names);
  for (const n of names) assert.ok(fs.existsSync(path.join(w.addons, n, n + '.toc')), 'installed ' + n);
  assert.ok(w.lines.some(l => /^glossary : /.test(l)));
});
