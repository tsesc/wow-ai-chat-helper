// Addon transport (spec 3.1, 3.3-3.5, 6): strip records, batching, acks and resends,
// signals self-test, slot scheduling, exhaustion. Runs the addon in the fengari VM.
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { boot, ackStrip, publish, deliver, session, lastId, sample, slotLoads, P } = require('./helpers/addon');

test('login: hello record carries the session and k=v settings; ack takes the strip down', () => {
  const vm = boot({ hello: false });
  assert.equal(vm.str('WCH.Transport.run.selftest'), 'passed');
  vm.advance(2.5);
  const f = vm.decodeStrip();
  assert.equal(f.records.length, 1);
  const h = f.records[0];
  assert.equal(h.kind, 'h');
  assert.equal(h.session, session(vm));
  assert.match(h.session, /^[0-9a-f]{8,}$/);
  const s = P.parseSettings(h.text);
  assert.equal(s.corner, 'TOPLEFT');
  assert.equal(s.player, 'Testchar-TestRealm');
  assert.equal(s.signals, 'ok');
  ackStrip(vm);
  assert.equal(vm.decodeStrip(), null);
  assert.deepEqual(vm.sent(), []);
});

test('whisper event -> strip bytes decode (protocol.js) to the expected x record with ctx', () => {
  const vm = boot();
  vm.receiveChat('WHISPER', 'hey there', 'Bob-Stormrage');
  vm.receiveChat('WHISPER_INFORM', 'hi, what is up?', 'Bob-Stormrage');
  vm.receiveChat('WHISPER', 'LF1M tank HC |cff0070dd|Hitem:2140::::::::60:::::|h[Carving Knife]|h|r DM, inv', 'Bob-Stormrage');
  vm.advance(0.6);
  const f = vm.decodeStrip();
  assert.ok(f && !f.error, 'strip decodes');
  const recs = f.records.filter(r => r.kind === 'x');
  assert.equal(recs.length, 2);
  const r = recs[1];
  assert.deepEqual({ ...r, session: undefined }, {
    session: undefined, id: r.id, kind: 'x', channel: 'WHISPER', sender: 'Bob-Stormrage', model: '',
    ctx: 'Bob: hey there\nTestchar: hi, what is up?', text: 'LF1M tank HC [Carving Knife] DM, inv',
  });
  assert.equal(r.session, session(vm));
  assert.equal(f.id, r.id, 'frame id = highest record id');
  assert.ok(f.payload.length <= P.BATCH_BYTES);
});

test('channels map to the spec names; ctx keeps the last 4 lines per conversation', () => {
  const vm = boot();
  vm.receiveChat('PARTY_LEADER', 'pull in 3', 'Lead');
  vm.receiveChat('RAID', 'stack on me', 'Rl');
  vm.receiveChat('OFFICER', 'gbank?', 'Off');
  vm.receiveChat('INSTANCE_CHAT', 'go go', 'Ix');
  for (let i = 1; i <= 6; i++) vm.receiveChat('GUILD', 'line ' + i, 'G' + i);
  vm.receiveChat('WHISPER', 'w from alice', 'Alice');
  vm.advance(0.6);
  const recs = vm.decodeStrip().records;
  const by = (t) => recs.filter(r => r.text === t)[0];
  assert.equal(by('pull in 3').channel, 'PARTY');
  assert.equal(by('stack on me').channel, 'RAID');
  assert.equal(by('gbank?').channel, 'OFFICER');
  assert.equal(by('go go').channel, 'INSTANCE');
  assert.equal(by('line 6').channel, 'GUILD');
  assert.equal(by('line 6').ctx, 'G2: line 2\nG3: line 3\nG4: line 4\nG5: line 5');
  assert.equal(by('w from alice').ctx, '', 'whisper ctx is per sender');
});

test('batching: one frame <= 3000 bytes, rest queued; acking the top id shows the rest', () => {
  const vm = boot();
  const long = 'x'.repeat(240);
  for (let i = 0; i < 20; i++) vm.receiveChat('GUILD', `${i} ${long}`, 'G' + i);
  vm.advance(0.6);
  const f1 = vm.decodeStrip();
  assert.ok(Buffer.byteLength(f1.payload) <= P.BATCH_BYTES);
  assert.ok(f1.records.length > 3 && f1.records.length < 20, 'some, not all, records in the first frame');
  assert.equal(f1.id, Math.max(...f1.records.map(r => r.id)));
  const ids1 = f1.records.map(r => r.id);
  assert.deepEqual(ids1, [...ids1].sort((a, b) => a - b), 'oldest first');
  vm.raiseSignal('ack', f1.id);
  vm.advance(0.6);
  const f2 = vm.decodeStrip();
  assert.ok(f2.records[0].id === f1.id + 1, 'queue continues after the acked frame');
  const texts = new Set(f1.records.map(r => r.text));
  let f = f2, frames = 1;
  while (f) { frames++; for (const r of f.records) texts.add(r.text); vm.raiseSignal('ack', f.id); vm.advance(0.6); f = vm.decodeStrip(); }
  assert.equal(texts.size, 20, 'every queued record went out');
  assert.ok(frames >= 2);
  assert.equal(vm.decodeStrip(), null);
});

test('a record too big for a frame drops context, then truncates text with … (valid UTF-8)', () => {
  const vm = boot();
  vm.run('WCH.Transport.Request({ kind = "t", channel = "SAY", ctx = string.rep("a: b\\n", 300), text = string.rep("中", 1500) })');
  vm.advance(0.6);
  const f = vm.decodeStrip();
  const r = f.records[0];
  assert.ok(Buffer.byteLength(f.payload) <= P.BATCH_BYTES);
  assert.ok(r.text.endsWith('…'));
  assert.ok(!r.text.includes('�'), 'no split characters');
  assert.equal(r.ctx, '');
});

test('no ack: re-shown 3 times (30 s each), then failed with [重試]; retry sends a new id', () => {
  const vm = boot();
  vm.receiveChat('WHISPER', 'are you there?', 'Bob');
  vm.advance(0.6);
  const id = vm.decodeStrip().records[0].id;
  vm.advance(30);
  assert.equal(vm.num(`WCH.Transport.Get(${id}).tries`), 2);
  assert.ok(vm.decodeStrip(), 'still up after the first timeout');
  vm.advance(62);
  assert.equal(vm.num(`WCH.Transport.Get(${id}).tries`), 4);
  assert.ok(vm.decodeStrip());
  vm.advance(30);
  assert.equal(vm.decodeStrip(), null, 'given up');
  const fail = vm.chatText('ChatFrame1').filter(t => t.includes('失敗'));
  assert.equal(fail.length, 1);
  assert.match(fail[0], /\[譯\].*失敗 \(橋接程式沒有回應\)/);
  const retry = vm.links(fail[0]).find(l => l.text === '[重試]');
  assert.equal(retry.link, `wch:retry:${id}`);
  vm.clickLink(retry.link);
  vm.advance(0.6);
  const r2 = vm.decodeStrip().records[0];
  assert.ok(r2.id > id);
  assert.equal(r2.text, 'are you there?');
  assert.deepEqual(vm.sent(), []);
});

test('ready signal -> one slot load picks up all results; loads are >= 3 s apart', () => {
  const vm = boot();
  vm.receiveChat('WHISPER', 'msg one', 'Bob');
  vm.receiveChat('WHISPER', 'msg two', 'Bob');
  vm.advance(0.6);
  const [a, b] = vm.decodeStrip().records.map(r => r.id);
  ackStrip(vm);
  publish(vm, [sample.x(a, { tr: '第一則' }), { id: b, kind: 'x', status: 'working' }]);
  vm.raiseSignal('ready', a);
  vm.advance(0.6);
  assert.equal(slotLoads(vm).length, 1);
  const t1 = vm.now();
  assert.ok(vm.chatText().some(t => t.includes('第一則')));
  publish(vm, [sample.x(a, { tr: '第一則' }), sample.x(b, { tr: '第二則' })]);
  vm.raiseSignal('ready', b);
  vm.advance(1);
  assert.equal(slotLoads(vm).length, 1, 'waits for the 3 s minimum');
  vm.advance(2.5);
  assert.equal(slotLoads(vm).length, 2);
  assert.ok(vm.now() - t1 >= 3);
  assert.equal(vm.chatText().filter(t => t.includes('第一則')).length, 1, 'a result is shown once');
  assert.ok(vm.chatText().some(t => t.includes('第二則')));
  assert.equal(vm.num('WCH.Transport.PendingCount()'), 0);
});

test('signals self-test fails -> schedule-only polling at 4, 8, 14, 22, 34, 50, then every 30 s', () => {
  const vm = boot({ signals: false });
  assert.notEqual(vm.str('WCH.Transport.run.selftest'), 'passed');
  const before = slotLoads(vm).length;
  vm.receiveChat('WHISPER', 'slow one', 'Bob');
  const t0 = vm.now();
  const times = [];
  vm.run('STUB.onLoadAddOn = function(name) table.insert(LOADS, GetTime()) end; LOADS = {}');
  vm.advance(112);
  for (const t of vm.eval('LOADS')) times.push(Math.round(t - t0));
  assert.equal(before, slotLoads(vm).length - times.length);
  assert.deepEqual(times, [4, 8, 14, 22, 34, 50, 80, 110]);
});

test('without signals a "working" result in a slot counts as the ack (no false failure)', () => {
  const vm = boot({ signals: false });
  vm.receiveChat('WHISPER', 'hello?', 'Bob');
  vm.advance(0.6);
  const id = vm.decodeStrip().records.find(r => r.kind === 'x').id;
  publish(vm, [{ id, kind: 'x', status: 'working' }]);
  vm.advance(5);
  assert.equal(vm.decodeStrip(), null, 'strip down once the bridge shows it has the record');
  publish(vm, [sample.x(id)]);
  vm.advance(10);
  assert.ok(vm.chatText().some(t => t.startsWith('|cff8fa9c8[譯]|r 徵 1 名坦克')));
  assert.ok(!vm.chatText().some(t => t.includes('失敗')));
});

test('wrap-around: a ready file valid before the request is ignored for it (falls back to polls)', () => {
  const vm = boot();
  const next = lastId(vm) + 1;
  vm.raiseSignal('ready', next); // left over from id next-200
  vm.receiveChat('WHISPER', 'wrap', 'Bob');
  vm.advance(0.6);
  assert.equal(vm.str(`tostring(WCH.Transport.Get(${next}).readyStale)`), 'true');
  ackStrip(vm);
  const loads0 = slotLoads(vm).length;
  publish(vm, [sample.x(next, { tr: '繞回' })]);
  vm.advance(2);
  assert.equal(slotLoads(vm).length, loads0, 'no load from the stale signal');
  vm.advance(3);
  assert.equal(slotLoads(vm).length, loads0 + 1, 'scheduled poll ~4 s after the ack');
  assert.ok(vm.chatText().some(t => t.includes('繞回')));
});

test('results of another session are ignored', () => {
  const vm = boot();
  vm.receiveChat('WHISPER', 'mine', 'Bob');
  vm.advance(0.6);
  const id = vm.decodeStrip().records[0].id;
  ackStrip(vm);
  vm.setSlotSource(P.renderSlotFile({ now: vm.num('time()'), session: 'someoneelse', results: [sample.x(id, { tr: '別人的' })] }));
  vm.raiseSignal('ready', id);
  vm.advance(1);
  assert.ok(!vm.chatText().some(t => t.includes('別人的')));
  assert.equal(vm.num('WCH.Transport.PendingCount()'), 1);
});

test('slot economy: warning at 20 left, stop at 0 and ask for /reload (never reloads)', () => {
  const vm = boot({ preLogin: 'for i = 1, 179 do STUB.loaded[string.format("WoWChatHelper_S%03d", i)] = true end' });
  assert.equal(vm.num('WCH.Transport.SlotsLeft()'), 21);
  vm.receiveChat('WHISPER', 'one', 'Bob');
  vm.advance(0.6);
  const id = vm.decodeStrip().records[0].id;
  ackStrip(vm);
  deliver(vm, id, [sample.x(id)]);
  assert.equal(vm.num('WCH.Transport.SlotsLeft()'), 20);
  assert.ok(vm.chatText().some(t => t.includes('只剩 20 個')), 'warned');
  assert.equal(slotLoads(vm).at(-1).name, 'WoWChatHelper_S180');
  vm.run('for i = 181, 199 do STUB.loaded[string.format("WoWChatHelper_S%03d", i)] = true end');
  vm.receiveChat('WHISPER', 'two', 'Bob');
  vm.advance(0.6);
  const id2 = vm.decodeStrip().records[0].id;
  ackStrip(vm);
  deliver(vm, id2, [sample.x(id2)]);
  assert.equal(vm.num('WCH.Transport.SlotsLeft()'), 0);
  assert.ok(vm.chatText().some(t => t.includes('/reload')));
  const n = slotLoads(vm).length;
  vm.receiveChat('WHISPER', 'three', 'Bob');
  vm.advance(0.6);
  const id3 = vm.decodeStrip().records[0].id;
  ackStrip(vm);
  vm.raiseSignal('ready', id3);
  vm.advance(120);
  assert.equal(slotLoads(vm).length, n, 'no more loads');
  assert.equal(vm.str('tostring(STUB.reloaded)'), 'false');
  // /reload resets the pool.
  const vm2 = vm.reload();
  vm2.setPlayable('sig/ctl/valid.wav');
  vm2.login();
  assert.equal(vm2.num('WCH.Transport.SlotsLeft()'), 200);
  assert.ok(vm2.num('WCH_DB.lastId') >= id3, 'ids keep increasing across reloads');
});

test('presence beats drive the bridge light', () => {
  const vm = boot({ hello: false });
  vm.advance(1);
  assert.equal(vm.str('(WCH.Transport.BridgeState())'), 'unknown');
  for (let k = 1; k <= 3; k++) vm.raiseSignal('presence', k);
  vm.advance(1);
  assert.equal(vm.str('(WCH.Transport.BridgeState())'), 'ok');
  vm.advance(120);
  assert.equal(vm.str('(WCH.Transport.BridgeState())'), 'stale');
  vm.raiseSignal('presence', 4);
  vm.advance(1);
  assert.equal(vm.str('(WCH.Transport.BridgeState())'), 'ok');
});

test('strip corner TOPRIGHT is honored', () => {
  const vm = boot({ hello: false, saved: { WCH_DB: { stripCorner: 'TOPRIGHT' } } });
  vm.advance(2.5);
  assert.equal(vm.str('WCHStrip.points[#WCHStrip.points][1]'), 'TOPRIGHT');
  assert.ok(vm.decodeStrip().records[0].text.includes('corner=TOPRIGHT'));
});

test('/wch corner moves the strip and saves WCH_DB.stripCorner; old settings.stripCorner migrates', () => {
  const vm = boot();
  assert.equal(vm.str('WCH_DB.stripCorner'), 'TOPLEFT');
  vm.slash('/wch corner topright');
  assert.equal(vm.str('WCH_DB.stripCorner'), 'TOPRIGHT');
  assert.equal(vm.str('WCHStrip.points[#WCHStrip.points][1]'), 'TOPRIGHT');
  vm.slash('/wch corner bogus');
  assert.equal(vm.str('WCH_DB.stripCorner'), 'TOPRIGHT');
  const old = boot({ hello: false, saved: { WCH_DB: { settings: { stripCorner: 'TOPRIGHT', chatFont: false } } } });
  assert.equal(old.str('WCH_DB.stripCorner'), 'TOPRIGHT');
  assert.equal(old.str('tostring(WCH_DB.chatFont)'), 'false');
  assert.equal(old.str('tostring(WCH_DB.settings.stripCorner)'), 'nil');
});

test('every load starts a new session, so ids reused after a crash are never deduped by the bridge', () => {
  const vm = boot();
  const saved = vm.savedVariables(); // what the client last wrote (clean logout / reload)
  const s1 = session(vm);
  vm.receiveChat('WHISPER', 'first message', 'Bob');
  vm.advance(0.6);
  const r1 = vm.decodeStrip().records[0];
  ackStrip(vm);
  // The client crashes: nothing is saved, the next login reads the old WCH_DB.
  const vm2 = boot({ saved, hello: false });
  const s2 = session(vm2);
  assert.notEqual(s2, s1);
  vm2.advance(2.5);
  const r2 = vm2.decodeStrip().records[0]; // the login hello takes the rolled-back id
  assert.equal(r2.id, r1.id, 'lastId rolled back (precondition)');
  assert.equal(r2.session, s2);
  assert.notEqual(`${r2.session}/${r2.id}`, `${r1.session}/${r1.id}`, 'dedup key differs');
  // A result the bridge kept for the old session is not applied to the new request.
  vm2.setSlotSource(P.renderSlotFile({ now: vm2.num('time()'), session: s1, results: [sample.x(r1.id, { tr: '舊的答案' })] }));
  ackStrip(vm2);
  vm2.receiveChat('WHISPER', 'totally different message', 'Eve');
  vm2.advance(0.6);
  const r3 = vm2.decodeStrip().records[0];
  ackStrip(vm2);
  vm2.raiseSignal('ready', r3.id);
  vm2.advance(3.6);
  assert.ok(!vm2.chatText().some(t => t.includes('舊的答案')));
});

test('without signals, one poll schedule for all pending requests (anchored to the oldest)', () => {
  const vm = boot({ signals: false });
  const before = slotLoads(vm).length;
  // Bridge down, a party line every 6 s for 2 minutes, then 2 more quiet minutes.
  for (let i = 0; i < 20; i++) { vm.receiveChat('PARTY', 'line number ' + i + ' lf healer', 'Bob'); vm.advance(6); }
  vm.advance(120);
  const loads = slotLoads(vm).length - before;
  // 4, 8, 14, 22, 34, 50, 80, ..., 230 s after the first: about 12 (not one per 3 s).
  assert.ok(loads <= 14, `slot loads: ${loads}`);
  assert.ok(loads >= 9, `still polling: ${loads}`);
});

test('while other requests are in flight a ready load waits 8 s so their results ride along', () => {
  const vm = boot();
  for (const m of ['one', 'two', 'three']) vm.receiveChat('PARTY', 'msg ' + m, 'Bob');
  vm.advance(0.6);
  const [a, b, c] = vm.decodeStrip().records.map(r => r.id);
  ackStrip(vm);
  const working = (id) => ({ id, kind: 'x', status: 'working' });
  publish(vm, [sample.x(a, { tr: '一' }), working(b), working(c)]);
  vm.raiseSignal('ready', a);
  vm.advance(0.6);
  const n = slotLoads(vm).length;
  const t1 = vm.now();
  publish(vm, [sample.x(a, { tr: '一' }), sample.x(b, { tr: '二' }), working(c)]);
  vm.raiseSignal('ready', b);
  vm.advance(5);
  assert.equal(slotLoads(vm).length, n, 'c is still in flight: no load at 3 s');
  // c's result arrives too: nothing left in flight, so the load happens right away.
  publish(vm, [sample.x(a, { tr: '一' }), sample.x(b, { tr: '二' }), sample.x(c, { tr: '三' })]);
  vm.raiseSignal('ready', c);
  vm.advance(0.6);
  assert.equal(slotLoads(vm).length, n + 1, 'one load for both');
  assert.ok(vm.now() - t1 < 8);
  assert.ok(vm.chatText().some(t => t.includes('二')) && vm.chatText().some(t => t.includes('三')));
  // A lone in-flight request delays a ready load by at most 8 s.
  vm.receiveChat('PARTY', 'msg four', 'Bob');
  vm.receiveChat('PARTY', 'msg five', 'Bob');
  vm.advance(0.6);
  const [d, e] = vm.decodeStrip().records.map(r => r.id);
  ackStrip(vm);
  const t2 = vm.now();
  publish(vm, [sample.x(d, { tr: '四' }), working(e)]);
  vm.raiseSignal('ready', d);
  vm.advance(9);
  assert.equal(slotLoads(vm).length, n + 2);
  assert.ok(vm.chatText().some(t => t.includes('四')));
  assert.ok(vm.now() - t2 <= 9.5);
});

test('presence head after the bridge counter wrapped: a stopped bridge is not shown as alive', () => {
  const pad = (k) => 'sig/presence/' + String(k).padStart(4, '0') + '.wav';
  // Wrapped to 30 and stopped: 1..30 and 81..2000 valid, the 50 after 30 empty.
  const vm = boot({ hello: false, login: false });
  for (let k = 1; k <= 2000; k++) if (k <= 30 || k > 80) vm.setPlayable(pad(k));
  vm.login();
  vm.advance(10);
  assert.notEqual(vm.str('(WCH.Transport.BridgeState())'), 'ok');
  assert.equal(vm.num('WCH.Transport.run.presence.last'), 30);
  vm.setPlayable(pad(31)); // the bridge comes back: next beat
  vm.advance(1);
  assert.equal(vm.str('(WCH.Transport.BridgeState())'), 'ok');
  // Other layouts: before any wrap, head at 0, head at 2000, head inside 1..49.
  const head = (valid) => {
    const v = boot({ hello: false, login: false, signals: true });
    for (let k = 1; k <= 2000; k++) if (valid(k)) v.setPlayable(pad(k));
    v.login();
    v.advance(0.6);
    return v.num('WCH.Transport.run.presence.last');
  };
  assert.equal(head(k => k <= 777), 777);
  assert.equal(head(() => false), 0);
  assert.equal(head(k => k > 50), 2000);
  assert.equal(head(k => k <= 7 || k > 57), 7);
  assert.equal(head(k => k <= 1950), 1950);
  assert.equal(head(k => k <= 1999), 1999);
  assert.equal(head(k => k <= 1260 || k > 1310), 1260);
});

test('a stale ack file does not take the login hello down before the bridge read it', () => {
  const vm = boot({ hello: false, login: false });
  for (let k = 1; k <= 200; k++) vm.raiseSignal('ack', k);
  vm.login();
  vm.advance(2.2);
  assert.ok(vm.decodeStrip(), 'hello up');
  vm.advance(5);
  const f = vm.decodeStrip();
  assert.ok(f && f.records[0].kind === 'h', 'still up after several ticks');
  vm.advance(20);
  assert.equal(vm.decodeStrip(), null, 'dropped after HELLO_WAIT');
});

test('the strip is not under UIParent: hiding the UI (Alt+Z) keeps it visible', () => {
  const vm = boot();
  vm.run('UIParent:Hide()');
  vm.receiveChat('WHISPER', 'are you there?', 'Bob');
  vm.advance(0.6);
  const f = vm.decodeStrip();
  assert.ok(f && f.records.some(r => r.text === 'are you there?'));
});

// Review fix: the language only reaches the bridge in a hello; a hello that expired
// unread (bridge not running yet, or restarting during /wch lang) must be sent again.
const helloRecs = (vm) => { const f = vm.decodeStrip(); return f && !f.error ? f.records.filter(r => r.kind === 'h') : []; };
const langOf = (rec) => P.parseSettings(rec.text).lang;

test('bridge down at login: the expired hello is sent again when the bridge shows up', () => {
  const vm = boot({ hello: false, locale: 'deDE' });
  vm.advance(2.5);
  assert.equal(helloRecs(vm).length, 1, 'login hello up');
  vm.advance(25); // nobody acks it: dropped
  assert.equal(vm.decodeStrip(), null);
  vm.raiseSignal('presence', 1); // the bridge starts
  vm.advance(1.2);
  const h = helloRecs(vm);
  assert.equal(h.length, 1, 'hello re-sent');
  assert.equal(langOf(h[0]), 'deDE');
  ackStrip(vm);
  assert.equal(vm.decodeStrip(), null);
  vm.raiseSignal('presence', 2);
  vm.advance(1.2);
  assert.equal(vm.decodeStrip(), null, 'no further hello once one was read');
});

test('/wch lang while the bridge is away: the next request carries a fresh hello first', () => {
  const vm = boot();
  vm.slash('/wch lang frFR');
  vm.advance(0.6);
  assert.equal(langOf(helloRecs(vm)[0]), 'frFR');
  vm.advance(25); // the bridge was restarting: unread
  assert.equal(vm.decodeStrip(), null);
  vm.receiveChat('WHISPER', 'ah isnt down for everyone', 'Bob');
  vm.advance(0.6);
  const recs = vm.decodeStrip().records;
  assert.deepEqual(recs.map(r => r.kind), ['h', 'x'], 'hello before the request');
  assert.equal(langOf(recs[0]), 'frFR');
  assert.ok(recs[0].id < recs[1].id);
});

test('without signals a hello is acked by a later record\'s slot result (no hello per request)', () => {
  const vm = boot({ signals: false });
  vm.receiveChat('WHISPER', 'one', 'Bob');
  vm.advance(0.6);
  const recs = vm.decodeStrip().records;
  assert.deepEqual(recs.map(r => r.kind), ['h', 'x']);
  publish(vm, [{ id: recs[1].id, kind: 'x', status: 'working' }]);
  vm.advance(5);
  assert.equal(vm.decodeStrip(), null, 'hello and request both taken down');
  vm.receiveChat('WHISPER', 'two', 'Bob');
  vm.advance(0.6);
  assert.deepEqual(vm.decodeStrip().records.map(r => r.kind), ['x'], 'no second hello');
});
