// Tests for bridge/ai.js against tests/fakes/fake-claude.js (no network).
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const childProcess = require('child_process');
const ai = require('../bridge/ai');
const { Glossary } = require('../bridge/glossary');

const FIXTURE_TERMS = require('./fixtures/terms.json');
const glossary = new Glossary(FIXTURE_TERMS);

const FAKE = path.join(__dirname, 'fakes', 'fake-claude.js');

function tmpdir(prefix = 'wch-ai-') { return fs.mkdtempSync(path.join(os.tmpdir(), prefix)); }

// A runner on the fake claude; returns { runner, events() } where events() reads the fake's log.
function setup(cfg = {}) {
  const dir = tmpdir();
  const logFile = path.join(dir, 'fake.log');
  process.env.FAKE_CLAUDE_LOG = logFile;
  process.env.FAKE_CLAUDE_STATE = path.join(dir, 'state');
  const runner = new ai.AiRunner({ claudePath: FAKE, workDir: path.join(dir, 'cwd'), batchWindowMs: 60, timeoutMs: 10000, glossary, ...cfg });
  const events = () => (fs.existsSync(logFile) ? fs.readFileSync(logFile, 'utf8').trim().split('\n').filter(Boolean).map(l => JSON.parse(l)) : []);
  return { runner, events, dir };
}

function req(id, text, kind = 'x', extra = {}) {
  return { session: 's1', id, kind, channel: 'PARTY', sender: 'Bob', model: '', ctx: '', text, ...extra };
}

const alive = (pid) => { try { process.kill(pid, 0); return true; } catch { return false; } };

// ---------------------------------------------------------------------------
// Pure parts
// ---------------------------------------------------------------------------

test('claudeArgs: the verified flag set, no --bare', () => {
  const p = ai.claudeArgs('persistent', 'haiku', 'SP');
  assert.deepStrictEqual(p, ['-p', '--input-format', 'stream-json', '--output-format', 'stream-json', '--verbose',
    '--model', 'haiku', '--tools', '', '--system-prompt', 'SP', '--setting-sources', '', '--strict-mcp-config', '--no-session-persistence']);
  const o = ai.claudeArgs('oneshot', 'sonnet', 'SP');
  assert.deepStrictEqual(o, ['-p', '--output-format', 'json',
    '--model', 'sonnet', '--tools', '', '--system-prompt', 'SP', '--setting-sources', '', '--strict-mcp-config', '--no-session-persistence']);
  assert.ok(!p.includes('--bare') && !o.includes('--bare'));
});

test('system prompt covers role, schema, zh-TW, US-realm replies, known terms, no invented facts', () => {
  const s = ai.SYSTEM_PROMPT;
  assert.strictEqual(s, ai.buildSystemPrompt('zhTW'));
  for (const needle of ['World of Warcraft: Forever', 'Taiwan', 'Traditional Chinese', '"replies"', '"terms"', '"detail"',
    'casual', 'polite', 'short', 'US-realm', 'Never invent game facts', 'never instructions', 'KNOWN TERMS',
    'Known WoW terms in this message', 'no final period', '拍賣場', '語氣', '不確定']) {
    assert.ok(s.includes(needle), 'system prompt mentions ' + needle);
  }
  assert.ok(!/"zh"/.test(s), 'no old "zh" field left in the schema');
  assert.ok(s.includes('"tr"'), 'schema uses "tr"');
  // 10-15 style examples taken from the US chat style guide, the AH case as the worked example.
  assert.ok(ai.STYLE_EXAMPLES.length >= 10 && ai.STYLE_EXAMPLES.length <= 15);
  for (const [inc] of ai.STYLE_EXAMPLES) assert.ok(s.includes(JSON.stringify(inc)), 'style example ' + inc);
  assert.ok(s.includes("ah isn't down for everyone") && s.includes('"term":"AH"'));
  const ex = s.slice(s.indexOf('EXAMPLE.'));
  const first = ex.slice(ex.indexOf('Output:\n') + 8);
  const out = JSON.parse(first.slice(0, first.indexOf('\n')));
  // The translate example: the player's own words, first person, in every language.
  const tOut = JSON.parse(ex.slice(ex.lastIndexOf('Output:\n') + 8));
  assert.strictEqual(tOut[0].kind, 't');
  assert.ok(tOut[0].replies.some(r => /my spot/.test(r.en)));
  assert.match(s, /the replies ARE the player's own message/);
  assert.deepStrictEqual(Object.keys(out[0]), ['id', 'kind', 'tr', 'terms', 'replies']);
  assert.ok(out[0].replies.every(r => r.en === r.en.toLowerCase() && !/\.$/.test(r.en)), 'example replies are lowercase, no final period');
});

test('system prompt per locale: language name, wording hints, detail labels, worked example in that language', () => {
  assert.deepStrictEqual(ai.LOCALES, ['zhTW', 'zhCN', 'koKR', 'deDE', 'frFR', 'esES', 'ptBR', 'ruRU', 'itIT']);
  const want = {
    zhTW: ['Traditional Chinese', '拍賣場', '語氣'], zhCN: ['Simplified Chinese', '拍卖行', '语气'], koKR: ['Korean', '경매장', '말투'],
    deDE: ['German', 'Auktionshaus', 'Ton'], frFR: ['French', 'Hôtel des ventes', 'Conseil'], esES: ['Spanish', 'Casa de subastas', 'Consejo'],
    ptBR: ['Brazilian Portuguese', 'Casa de Leilões', 'Sugestão'], ruRU: ['Russian', 'Аукцион', 'Совет'], itIT: ['Italian', "Casa d'aste", 'Consiglio'],
  };
  const seen = new Set();
  for (const loc of ai.LOCALES) {
    const s = ai.buildSystemPrompt(loc);
    seen.add(s);
    for (const needle of want[loc]) assert.ok(s.includes(needle), `${loc} prompt mentions ${needle}`);
    // English replies stay the same in every language.
    assert.ok(s.includes('"oh weird, mine\'s still broken"') || s.includes("oh weird, mine's still broken"), loc + ' keeps the English replies');
    assert.ok(s.includes('Every reply "en" is English'), loc);
  }
  assert.strictEqual(seen.size, 9, 'nine different prompts');
  assert.strictEqual(ai.buildSystemPrompt('esMX'), ai.buildSystemPrompt('esES'), 'esMX uses esES');
  assert.strictEqual(ai.buildSystemPrompt('xxXX'), ai.SYSTEM_PROMPT, 'unknown -> zhTW');
});

test('buildPrompt: known-terms block from the glossary, in the player language; the requests JSON stays last', () => {
  const r = req(12, "ah isn't down for everyone", 'x', { channel: 'YELL', ctx: 'Mira: wts [Black Lotus] in IF' });
  const p = ai.buildPrompt([r], { locale: 'zhTW', glossary });
  assert.match(p, /^Player language: zhTW, Traditional Chinese/);
  assert.match(p, /Known WoW terms in this message:\n/);
  assert.match(p, /#12 "ah": AH = Auction House \| 拍賣場 \| note: lowercase 'ah' may be the interjection/);
  assert.match(p, /#12 "down": down = /);
  assert.match(p, /#12 "IF": IF = Ironforge \| 鐵爐堡 .*\(ctx\)/, 'ctx hits are marked');
  const arr = JSON.parse(p.slice(p.indexOf('[', p.indexOf('Requests'))));
  assert.deepStrictEqual(arr, [{ id: 12, kind: 'x', channel: 'YELL', sender: 'Bob', ctx: 'Mira: wts [Black Lotus] in IF', text: "ah isn't down for everyone" }]);
  // Another language: same hits, that language's translation; the locale comes from req.lang too.
  const de = ai.buildPrompt([{ ...r, lang: 'deDE' }], { glossary });
  assert.match(de, /^Player language: deDE, German/);
  assert.match(de, /AH = Auction House \| Auktionshaus/);
  // Nothing found -> no block; no glossary -> no block.
  assert.ok(!ai.buildPrompt([req(1, 'hello there')], { glossary }).includes('Known WoW terms'));
  assert.ok(!ai.buildPrompt([r]).includes('Known WoW terms'));
});

test('buildPrompt / userTurnLine', () => {
  const p = ai.buildPrompt([req(3, 'ty "gg"\nok')]);
  const arr = JSON.parse(p.slice(p.indexOf('[', p.indexOf('Requests'))));
  assert.deepStrictEqual(arr, [{ id: 3, kind: 'x', channel: 'PARTY', sender: 'Bob', ctx: '', text: 'ty "gg"\nok' }]);
  const line = ai.userTurnLine('hello');
  assert.ok(line.endsWith('\n'));
  assert.deepStrictEqual(JSON.parse(line), { type: 'user', message: { role: 'user', content: [{ type: 'text', text: 'hello' }] } });
});

test('extractJson: plain, fenced, prose around, single object, garbage', () => {
  assert.deepStrictEqual(ai.extractJson('[{"id":1}]'), [{ id: 1 }]);
  assert.deepStrictEqual(ai.extractJson('```json\n[{"id":1}]\n```'), [{ id: 1 }]);
  assert.deepStrictEqual(ai.extractJson('Here you go:\n[{"id":2}]\nhope it helps'), [{ id: 2 }]);
  assert.deepStrictEqual(ai.extractJson('{"id":3,"kind":"d"}'), [{ id: 3, kind: 'd' }]);
  assert.strictEqual(ai.extractJson('no json here'), null);
  assert.strictEqual(ai.extractJson(''), null);
});

test('validateItem: x / t / d rules and normalization', () => {
  const x = { id: 1, kind: 'x', tr: '譯', terms: [{ term: 'HC', expansion: 'Heroic', tr: '英雄' }, { term: 'bad' }],
    replies: [{ en: 'a', tr: '一', tone: 'Casual' }, { en: 'b', tr: '二', tone: 'weird' }, { en: 'c', tr: '三', tone: 'short' }, { en: 'd', tr: '四', tone: 'polite' }] };
  const r = ai.validateItem(x, req(1, ''));
  assert.deepStrictEqual(r, { id: 1, kind: 'x', status: 'done', tr: '譯', terms: [{ term: 'HC', expansion: 'Heroic', tr: '英雄' }],
    replies: [{ en: 'a', tr: '一', tone: 'casual' }, { en: 'b', tr: '二', tone: 'casual' }, { en: 'c', tr: '三', tone: 'short' }] });
  assert.strictEqual(ai.validateItem({ ...x, tr: '' }, req(1, '')), null, 'x needs tr');
  assert.strictEqual(ai.validateItem({ ...x, replies: [{ en: 'a' }] }, req(1, '')), null, 'x needs 2 replies');
  assert.strictEqual(ai.validateItem({ ...x, id: 2 }, req(1, '')), null, 'id must match');
  assert.strictEqual(ai.validateItem({ ...x, id: '1' }, req(1, ''))?.id, 1, 'numeric string id accepted');
  assert.deepStrictEqual(ai.validateItem({ id: 5, replies: [{ en: 'omw' }, { en: 'on my way', tone: 'polite' }] }, req(5, '', 't')),
    { id: 5, kind: 't', status: 'done', replies: [{ en: 'omw', tr: '', tone: 'casual' }, { en: 'on my way', tr: '', tone: 'polite' }] });
  assert.deepStrictEqual(ai.validateItem({ id: 6, detail: ' 語氣：… ' }, req(6, '', 'd')), { id: 6, kind: 'd', status: 'done', detail: '語氣：…' });
  assert.strictEqual(ai.validateItem({ id: 6, detail: '' }, req(6, '', 'd')), null);
  assert.strictEqual(ai.validateItem(null, req(6, '', 'd')), null);
});

test('matchResults: matches by id regardless of order; missing ids fail', () => {
  const reqs = [req(10, 'a'), req(11, 'b'), req(12, 'c')];
  const rep = (id) => ({ id, kind: 'x', tr: 'z' + id, terms: [], replies: [{ en: 'a' }, { en: 'b' }] });
  const { done, failed } = ai.matchResults(JSON.stringify([rep(12), rep(10)]), reqs);
  assert.deepStrictEqual([...done.keys()].sort(), [10, 12]);
  assert.strictEqual(done.get(12).tr, 'z12');
  assert.deepStrictEqual(failed.map(r => r.id), [11]);
});

test('claudeError: login problems are named', () => {
  assert.match(ai.claudeError({ result: 'Invalid API key · Please run /login' }), /^claude not logged in/);
  assert.match(ai.claudeError({ result: 'Overloaded' }), /^claude: Overloaded/);
});

test('claudeEnv: thinking off by default, configurable, null leaves env alone', () => {
  assert.strictEqual(ai.claudeEnv({}).MAX_THINKING_TOKENS, '0');
  assert.strictEqual(ai.claudeEnv({ maxThinkingTokens: 2048 }).MAX_THINKING_TOKENS, '2048');
  const saved = process.env.MAX_THINKING_TOKENS;
  delete process.env.MAX_THINKING_TOKENS;
  assert.strictEqual(ai.claudeEnv({ maxThinkingTokens: null }).MAX_THINKING_TOKENS, undefined);
  if (saved !== undefined) process.env.MAX_THINKING_TOKENS = saved;
});

// ---------------------------------------------------------------------------
// resolveCommand
// ---------------------------------------------------------------------------

test('resolveCommand: configured .js runs with node; missing path is reported', () => {
  const r = ai.resolveCommand(FAKE);
  assert.deepStrictEqual(r, { file: process.execPath, args: [FAKE], found: true });
  const m = ai.resolveCommand(path.join(os.tmpdir(), 'nope', 'claude.exe'));
  assert.strictEqual(m.found, false);
  assert.match(m.note, /does not exist/);
});

test('resolveCommand: npm .cmd shim is unwrapped to the native claude.exe (Windows layout)', () => {
  const dir = tmpdir('wch-shim-');
  const npm = path.join(dir, 'npm');
  const exe = path.join(npm, 'node_modules', '@anthropic-ai', 'claude-code', 'bin', 'claude.exe');
  fs.mkdirSync(path.dirname(exe), { recursive: true });
  fs.writeFileSync(exe, 'MZ');
  // What npm writes for a package whose bin is a native exe.
  const shim = path.join(npm, 'claude.cmd');
  fs.writeFileSync(shim, '@ECHO off\r\nGOTO start\r\n:find_dp0\r\nSET dp0=%~dp0\r\nEXIT /b\r\n:start\r\nSETLOCAL\r\nCALL :find_dp0\r\n' +
    '"%dp0%\\node_modules\\@anthropic-ai\\claude-code\\bin\\claude.exe"   %*\r\n');
  assert.deepStrictEqual(ai.resolveCommand(shim), { file: exe, args: [], found: true });
  // Found on PATH (APPDATA\npm is searched too) on win32.
  const r = ai.resolveCommand('', { platform: 'win32', env: { PATH: path.join(dir, 'empty'), APPDATA: dir }, home: path.join(dir, 'home') });
  assert.deepStrictEqual(r, { file: exe, args: [], found: true });
  // A .js launcher behind the shim runs with node.
  const js = path.join(npm, 'node_modules', '@anthropic-ai', 'claude-code', 'cli.js');
  fs.writeFileSync(js, '');
  fs.writeFileSync(shim, '@ECHO off\r\n"%dp0%\\node.exe"  "%dp0%\\node_modules\\@anthropic-ai\\claude-code\\cli.js" %*\r\n');
  assert.deepStrictEqual(ai.resolveCommand(shim), { file: process.execPath, args: [js], found: true });
  // ~/.local/bin/claude.exe (native installer) wins.
  const local = path.join(dir, 'home', '.local', 'bin', 'claude.exe');
  fs.mkdirSync(path.dirname(local), { recursive: true });
  fs.writeFileSync(local, 'MZ');
  assert.strictEqual(ai.resolveCommand('', { platform: 'win32', env: { PATH: '' }, home: path.join(dir, 'home') }).file, local);
  // Nothing anywhere.
  const none = ai.resolveCommand('', { platform: 'win32', env: { PATH: '' }, home: path.join(dir, 'nobody') });
  assert.strictEqual(none.found, false);
  assert.match(none.note, /claude/);
});

test('resolveCommand: posix PATH lookup', { skip: process.platform === 'win32' && 'simulates POSIX paths' }, () => {
  const dir = tmpdir('wch-path-');
  fs.writeFileSync(path.join(dir, 'claude'), '');
  const r = ai.resolveCommand('', { platform: 'linux', env: { PATH: dir }, home: path.join(dir, 'home') });
  assert.deepStrictEqual(r, { file: path.join(dir, 'claude'), args: [], found: true });
});

test('killTree on Windows runs taskkill /pid <pid> /T /F', () => {
  const calls = [];
  const orig = childProcess.spawn;
  childProcess.spawn = (cmd, args) => { calls.push([cmd, args]); return { on() {} }; };
  try { ai.killTree({ pid: 4242, exitCode: null, signalCode: null, kill() {} }, 'win32'); } finally { childProcess.spawn = orig; }
  assert.deepStrictEqual(calls, [['taskkill', ['/pid', '4242', '/T', '/F']]]);
});

// ---------------------------------------------------------------------------
// The runner against the fake claude
// ---------------------------------------------------------------------------

test('persistent: requests within the batch window go out as one turn; ids matched', async () => {
  const { runner, events } = setup();
  try {
    const out = await Promise.all([runner.request(req(1, 'LF1M tank HC DM, inv')), runner.request(req(2, 'need or greed?')), runner.request(req(3, 'ty', 't'))]);
    assert.deepStrictEqual(out.map(r => [r.id, r.kind, r.status]), [[1, 'x', 'done'], [2, 'x', 'done'], [3, 't', 'done']]);
    assert.strictEqual(out[0].tr, '譯：LF1M tank HC DM, inv');
    assert.deepStrictEqual(out[0].terms, [{ term: 'LF1M', expansion: 'Looking For 1 More', tr: '還缺一人' }]);
    assert.strictEqual(out[2].replies.length, 3);
    const ev = events();
    assert.strictEqual(ev.filter(e => e.event === 'start').length, 1);
    const turns = ev.filter(e => e.event === 'turn');
    assert.deepStrictEqual(turns.map(t => t.ids), [[1, 2, 3]]);
    const start = ev.find(e => e.event === 'start');
    assert.strictEqual(start.mode, 'persistent');
    assert.strictEqual(start.model, 'haiku');
    assert.strictEqual(start.thinking, '0', 'MAX_THINKING_TOKENS=0 passed');
    assert.deepStrictEqual(start.flags, { tools: '', settingSources: '', strictMcp: true, noSession: true, verbose: true, systemPrompt: ai.SYSTEM_PROMPT.length });
    assert.strictEqual(path.basename(start.cwd), 'cwd');
  } finally { runner.stop(); }
});

test('persistent: later requests reuse the process; restart after persistentMaxTurns', async () => {
  const { runner, events } = setup({ persistentMaxTurns: 2 });
  try {
    for (let i = 1; i <= 3; i++) assert.strictEqual((await runner.request(req(i, 'hi ' + i))).status, 'done');
    const ev = events();
    assert.deepStrictEqual(ev.filter(e => e.event === 'turn').map(t => t.ids), [[1], [2], [3]]);
    const starts = ev.filter(e => e.event === 'start');
    assert.strictEqual(starts.length, 2, 'third turn ran in a fresh process');
    assert.strictEqual(ev.find(e => e.event === 'turn' && e.ids[0] === 3).pid, starts[1].pid);
  } finally { runner.stop(); }
});

test('an invalid item in a batch is retried once alone (one-shot); the rest stay done', async () => {
  const { runner, events } = setup();
  try {
    const out = await Promise.all([runner.request(req(1, 'ok')), runner.request(req(2, 'bad #invalid-once')), runner.request(req(3, 'later #omit'))]);
    assert.deepStrictEqual(out.map(r => r.status), ['done', 'done', 'done']);
    const ev = events();
    const oneshots = ev.filter(e => e.event === 'start' && e.mode === 'oneshot');
    assert.strictEqual(oneshots.length, 2);
    const turns = ev.filter(e => e.event === 'turn').map(t => t.ids);
    assert.deepStrictEqual(turns[0], [1, 2, 3]);
    assert.deepStrictEqual(turns.slice(1).map(t => t.join()).sort(), ['2', '3']);
  } finally { runner.stop(); }
});

test('an item that stays invalid becomes status=error after one retry', async () => {
  const { runner, events } = setup();
  try {
    const r = await runner.request(req(7, 'always #invalid'));
    assert.deepStrictEqual(r, { id: 7, kind: 'x', status: 'error', err: 'invalid reply' });
    assert.strictEqual(events().filter(e => e.event === 'turn').length, 2, 'first try + one retry');
  } finally { runner.stop(); }
});

test('a garbage reply restarts the persistent process and retries one-shot', async () => {
  const { runner, events } = setup();
  try {
    const r = await runner.request(req(1, 'say #garbage'));
    assert.strictEqual(r.status, 'error');
    const r2 = await runner.request(req(2, 'fine now'));
    assert.strictEqual(r2.status, 'done');
    const persistentStarts = events().filter(e => e.event === 'start' && e.mode === 'persistent');
    assert.strictEqual(persistentStarts.length, 2, 'fresh process after the parse failure');
  } finally { runner.stop(); }
});

test('timeout kills the whole process tree, retries once, then status=error timeout', async () => {
  const { runner, events } = setup({ timeoutMs: 700 });
  try {
    const t0 = Date.now();
    const r = await runner.request(req(1, 'wait #hang'));
    assert.deepStrictEqual(r, { id: 1, kind: 'x', status: 'error', err: 'timeout' });
    assert.ok(Date.now() - t0 >= 1400, 'two attempts of 700 ms');
    await new Promise(res => setTimeout(res, 300));
    const ev = events();
    const pids = ev.filter(e => e.event === 'start').map(e => e.pid);
    const grandchildren = ev.filter(e => e.event === 'grandchild').map(e => e.grandchild);
    assert.strictEqual(pids.length, 2);
    assert.strictEqual(grandchildren.length, 2);
    for (const pid of [...pids, ...grandchildren]) assert.ok(!alive(pid), `pid ${pid} was killed`);
  } finally { runner.stop(); }
});

test('one-shot mode: a batch is one call; fenced JSON is accepted', async () => {
  const { runner, events } = setup({ persistent: false });
  try {
    const out = await Promise.all([runner.request(req(1, 'a #fence')), runner.request(req(2, 'b'))]);
    assert.deepStrictEqual(out.map(r => r.status), ['done', 'done']);
    const ev = events();
    assert.deepStrictEqual(ev.filter(e => e.event === 'start').map(e => e.mode), ['oneshot']);
    assert.deepStrictEqual(ev.filter(e => e.event === 'turn').map(t => t.ids), [[1, 2]]);
  } finally { runner.stop(); }
});

test('detail and any sonnet request run one-shot; record model overrides the default', async () => {
  const { runner, events } = setup();
  try {
    const d = await runner.request(req(5, 'ty for the run gg', 'd'));
    assert.strictEqual(d.status, 'done');
    assert.match(d.detail, /^語氣/);
    const x = await runner.request(req(6, 'hi', 'x', { model: 'sonnet' }));
    assert.strictEqual(x.status, 'done');
    const starts = events().filter(e => e.event === 'start');
    assert.deepStrictEqual(starts.map(s => [s.mode, s.model]), [['oneshot', 'sonnet'], ['oneshot', 'sonnet']], 'sonnet never runs persistent');
  } finally { runner.stop(); }
});

test('not logged in -> error naming it; missing CLI -> error without spawning', async () => {
  const { runner } = setup();
  try {
    const r = await runner.request(req(1, 'x #autherr'));
    assert.strictEqual(r.status, 'error');
    assert.match(r.err, /claude not logged in/);
  } finally { runner.stop(); }
  const missing = new ai.AiRunner({ claudePath: path.join(os.tmpdir(), 'no-such-claude.exe') });
  const m = await missing.request(req(2, 'hi'));
  assert.strictEqual(m.status, 'error');
  assert.match(m.err, /claude CLI not found/);
});

test('a crashing process is reported and replaced', async () => {
  const { runner, events } = setup();
  try {
    const r = await runner.request(req(1, 'die #crash'));
    assert.strictEqual(r.status, 'error');
    assert.match(r.err, /claude exited \(1\).*boom/);
    assert.strictEqual((await runner.request(req(2, 'hello'))).status, 'done');
    assert.strictEqual(events().filter(e => e.event === 'start' && e.mode === 'persistent').length, 2);
  } finally { runner.stop(); }
});

test('unknown tones and extra replies are normalized', async () => {
  const { runner } = setup();
  try {
    const r = await runner.request(req(1, 'x #tone'));
    assert.strictEqual(r.status, 'done');
    assert.strictEqual(r.replies.length, 3);
    assert.ok(r.replies.every(x => ai.TONES.has(x.tone)));
  } finally { runner.stop(); }
});

test('stop() resolves queued and in-flight requests as errors and kills the processes', async () => {
  const { runner, events } = setup({ timeoutMs: 30000 });
  const inflight = runner.request(req(1, 'wait #hang'));
  const detail = runner.request(req(2, 'wait #hang', 'd'));
  await new Promise(r => setTimeout(r, 400));
  const queued = runner.request(req(3, 'later'));
  runner.stop();
  const out = await Promise.all([inflight, detail, queued]);
  assert.deepStrictEqual(out.map(r => [r.id, r.status, r.err]), [[1, 'error', 'bridge stopping'], [2, 'error', 'bridge stopping'], [3, 'error', 'bridge stopping']]);
  await new Promise(r => setTimeout(r, 300));
  for (const e of events().filter(e => e.event === 'start')) assert.ok(!alive(e.pid), 'killed ' + e.mode);
});

test('a retry runs off the queue: a later request does not wait for it (no head-of-line blocking)', async () => {
  const { runner } = setup();
  try {
    const t0 = Date.now();
    const order = [];
    const a = runner.request(req(1, 'bad one #invalid #slow:1500')).then((r) => { order.push('A'); return r; });
    await new Promise(r => setTimeout(r, 1800)); // A's batch has failed; its retry is running
    const tb = Date.now();
    const b = await runner.request(req(2, 'lf1m tank'));
    order.push('B');
    const bMs = Date.now() - tb;
    assert.strictEqual(b.status, 'done');
    const ra = await a;
    assert.strictEqual(ra.status, 'error');
    assert.deepStrictEqual(order, ['B', 'A'], `B took ${bMs} ms, A ${Date.now() - t0} ms`);
  } finally { runner.stop(); }
});

test('checkLogin: startup probe reports a logged-out CLI; ok otherwise; missing CLI without spawning', async () => {
  const { runner } = setup();
  try {
    assert.deepStrictEqual(await runner.checkLogin(), { ok: true });
    const r = await runner.checkLogin('ping #autherr');
    assert.strictEqual(r.ok, false);
    assert.strictEqual(r.loggedOut, true);
    assert.match(r.err, /claude not logged in/);
  } finally { runner.stop(); }
  const missing = new ai.AiRunner({ claudePath: path.join(os.tmpdir(), 'no-such-claude.exe') });
  const m = await missing.checkLogin();
  assert.strictEqual(m.ok, false);
  assert.match(m.err, /claude CLI not found/);
});

// ---------------------------------------------------------------------------
// Language and glossary through the runner
// ---------------------------------------------------------------------------

test('runner: the turn carries the known-terms block and the request language; results use tr', async () => {
  const { runner, events } = setup();
  try {
    const r = await runner.request(req(1, "ah isn't down for everyone", 'x', { lang: 'koKR' }));
    assert.strictEqual(r.status, 'done');
    assert.strictEqual(r.tr, "譯：ah isn't down for everyone");
    assert.ok(r.replies.every(x => 'tr' in x && !('zh' in x)));
    const ev = events();
    const turn = ev.find(e => e.event === 'turn');
    assert.strictEqual(turn.lang, 'koKR');
    assert.match(turn.prompt, /#1 "ah": AH = Auction House \| 경매장/);
    const start = ev.find(e => e.event === 'start');
    assert.strictEqual(start.flags.systemPrompt, ai.buildSystemPrompt('koKR').length, 'Korean system prompt');
    assert.strictEqual(start.promptHead, ai.buildSystemPrompt('koKR').slice(0, 400));
  } finally { runner.stop(); }
});

test('runner: requests in different languages go out in separate turns, each with its own system prompt', async () => {
  const { runner, events } = setup();
  try {
    const out = await Promise.all([
      runner.request(req(1, 'inv pls', 'x', { lang: 'deDE' })),
      runner.request(req(2, 'ty', 'x', { lang: 'frFR' })),
      runner.request(req(3, 'gg', 'x', { lang: 'deDE' })),
      runner.request(req(4, 'k', 'x')),
    ]);
    assert.deepStrictEqual(out.map(r => r.status), ['done', 'done', 'done', 'done']);
    const turns = events().filter(e => e.event === 'turn').map(t => [t.lang, t.ids.join()]).sort();
    assert.deepStrictEqual(turns, [['deDE', '1,3'], ['frFR', '2'], ['zhTW', '4']]);
    // Each language started with its own prompt (a later language stops the older process
    // of the same model, so there can be up to one start per language).
    const lens = new Set(events().filter(e => e.event === 'start').map(e => e.flags.systemPrompt));
    for (const loc of ['deDE', 'frFR', 'zhTW']) assert.ok(lens.has(ai.buildSystemPrompt(loc).length), loc);
  } finally { runner.stop(); }
});

test('runner: detail (one-shot) and retries use the request language too', async () => {
  const { runner, events } = setup();
  try {
    const d = await runner.request(req(5, 'need or greed?', 'd', { lang: 'ruRU' }));
    assert.strictEqual(d.status, 'done');
    const r = await runner.request(req(6, 'ah prices #invalid-once', 'x', { lang: 'itIT' }));
    assert.strictEqual(r.status, 'done');
    const ev = events();
    assert.deepStrictEqual(ev.filter(e => e.event === 'turn').map(t => [t.ids.join(), t.lang]), [['5', 'ruRU'], ['6', 'itIT'], ['6', 'itIT']]);
    const oneshots = ev.filter(e => e.event === 'start' && e.mode === 'oneshot');
    assert.deepStrictEqual(oneshots.map(s => s.flags.systemPrompt), [ai.buildSystemPrompt('ruRU').length, ai.buildSystemPrompt('itIT').length]);
  } finally { runner.stop(); }
});

test('runner: a fixed systemPrompt overrides the per-language prompts; default glossary loads from data/', () => {
  const r1 = new ai.AiRunner({ claudePath: FAKE, systemPrompt: 'SP', glossary });
  assert.strictEqual(r1.systemPromptFor('deDE'), 'SP');
  const logs = [];
  const r2 = new ai.AiRunner({ claudePath: FAKE, glossaryFile: path.join(__dirname, 'fixtures', 'terms.json'), log: l => logs.push(l) });
  assert.strictEqual(r2.glossary.size, FIXTURE_TERMS.length);
  const r3 = new ai.AiRunner({ claudePath: FAKE, glossaryFile: path.join(os.tmpdir(), 'no-such-terms.json'), log: l => logs.push(l) });
  assert.strictEqual(r3.glossary.size, 0);
  assert.ok(logs.some(l => /no glossary file found/.test(l)));
  assert.ok(!ai.buildPrompt([req(1, 'ah is down')], { glossary: r3.glossary }).includes('Known WoW terms'));
});
