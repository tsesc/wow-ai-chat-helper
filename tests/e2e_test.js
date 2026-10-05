// End to end (spec 8, e2e): the real addon (TOC: Codec, Locales, Core, Transport, Chat,
// UI; the glossary load-on-demand addon for the language) in the fengari VM -> strip cells -> the bridge's own decoder (capture line
// {cells}) -> bridge pipeline with the fake claude -> slot file on disk -> the addon VM
// loads that file as a slot -> annotation / picker -> chat edit box. No network.
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const P = require('../bridge/protocol');
const B = require('../bridge/bridge');
const { setup } = require('../setup');
const { boot } = require('./helpers/addon');

const FAKE = path.join(__dirname, 'fakes', 'fake-claude.js');

// A fake client folder with the addon, slots and signal files installed by setup.js.
function installedClient() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wch-e2e-'));
  const client = path.join(dir, 'World of Warcraft', '_forever_');
  const addons = path.join(client, 'Interface', 'AddOns');
  fs.mkdirSync(addons, { recursive: true });
  fs.writeFileSync(path.join(client, 'Wow.exe'), 'MZ');
  const configFile = path.join(dir, 'config.json');
  setup(['--wow', client, '--config', configFile, '--claude', FAKE], () => {});
  process.env.FAKE_CLAUDE_STATE = path.join(dir, 'fake-state');
  const cfg = { ...JSON.parse(fs.readFileSync(configFile, 'utf8')), batchWindowMs: 50, timeoutMs: 10000 };
  const logs = [];
  const bridge = B.createBridge(cfg, { stateFile: path.join(dir, 'state.json'), workDir: path.join(dir, 'cwd'), log: (...a) => logs.push(a.join(' ')) });
  return { dir, addons, bridge, logs };
}

const sigFile = (w, kind, n) => path.join(w.addons, 'WoWChatHelper', ...P.signalPath(kind, n).split('/'));
const raised = (w, kind, n) => fs.readFileSync(sigFile(w, kind, n)).length > 0;

// Read the strip off the VM like capture.ps1 would and hand the raw cells to the bridge.
// Returns the frame as the addon drew it (decoded in JS for the assertions).
function captureStrip(vm, w) {
  const cells = vm.stripCells();
  assert.ok(cells.length > 0, 'strip is visible');
  w.bridge.handleCaptureLine(JSON.stringify({ cells: cells.join('') }));
  const f = P.decodeFrame(cells);
  assert.ok(f && !f.error, 'strip decodes: ' + (f && f.error));
  return { ...f, records: P.parseRecords(f.payload) };
}

// Mirror the bridge's signal files into the VM (PlaySoundFile playable = file filled).
function mirrorSignal(vm, w, kind, id) {
  assert.ok(raised(w, kind, id), `${kind}/${P.pad3(P.slotNumber(id))}.wav raised by the bridge`);
  vm.raiseSignal(kind, id);
}

// After the AI finishes: the slot file the bridge wrote becomes what every slot addon
// loads; ready is mirrored and the addon gets time to load a slot.
async function deliverFromBridge(vm, w, id) {
  await w.bridge.idle();
  const src = fs.readFileSync(path.join(w.addons, P.slotAddonName(1), 'Inbox.lua'), 'utf8');
  assert.equal(src, fs.readFileSync(path.join(w.addons, P.slotAddonName(200), 'Inbox.lua'), 'utf8'), 'same file in every slot');
  vm.setSlotSource(src);
  mirrorSignal(vm, w, 'ready', id);
  vm.advance(3.6);
  return src;
}

// Boot the addon, let the login hello go through the bridge.
function start(w) {
  const vm = boot({ toc: true, hello: false });
  vm.advance(2.5);
  const hello = captureStrip(vm, w);
  assert.equal(hello.records[0].kind, 'h');
  assert.match(hello.records[0].text, /corner=TOPLEFT/);
  assert.match(hello.records[0].text, /(^|;)lang=zhTW(;|$)/);
  mirrorSignal(vm, w, 'ack', hello.id);
  vm.advance(0.6);
  assert.equal(w.bridge.state.session, vm.str('WCH_DB.session'));
  assert.equal(w.bridge.state.settings.corner, 'TOPLEFT');
  assert.equal(w.bridge.state.settings.lang, 'zhTW');
  return vm;
}

test('e2e: whisper -> strip -> bridge + fake claude -> slot -> annotation -> [回覆] -> edit box /w sender', async () => {
  const w = installedClient();
  try {
    const vm = start(w);
    vm.clearChat();
    vm.receiveChat('WHISPER', 'LF1M tank HC DM, inv', 'Grimtusk-Stormrage');
    vm.advance(0.6);

    const frame = captureStrip(vm, w);
    const rec = frame.records.at(-1);
    assert.deepEqual(
      { kind: rec.kind, channel: rec.channel, sender: rec.sender, text: rec.text, session: rec.session },
      { kind: 'x', channel: 'WHISPER', sender: 'Grimtusk-Stormrage', text: 'LF1M tank HC DM, inv', session: vm.str('WCH_DB.session') });
    // Receipt: ack for the frame's highest id and a "working" publish, synchronously.
    mirrorSignal(vm, w, 'ack', frame.id);
    vm.advance(0.6);
    assert.equal(vm.stripCells().length, 0, 'strip comes down after the ack');

    const src = await deliverFromBridge(vm, w, rec.id);
    assert.match(src, /WCH_SlotData = /);
    assert.ok(vm.loadLog().some(l => l.ok && /^WoWChatHelper_S\d{3}$/.test(l.name)), 'a slot addon was loaded');

    const lines = vm.chatText('ChatFrame1');
    const i = lines.findIndex(t => t.includes('[譯]') && t.includes('譯：LF1M tank HC DM, inv'));
    assert.ok(i >= 0, 'annotation printed:\n' + lines.join('\n'));
    assert.ok(lines[i - 1].includes('LF1M tank HC DM, inv'), 'right after the original line');
    const links = vm.links(lines[i]);
    assert.deepEqual(links, [{ link: `wch:r:${rec.id}`, text: '[回覆]' }, { link: `wch:d:${rec.id}`, text: '[詳細]' }]);
    assert.ok(lines[i + 1].includes('LF1M=還缺一人'), 'terms line');

    vm.clickLink(links[0].link);
    assert.equal(vm.str('tostring(WCHPicker:IsShown())'), 'true');
    assert.equal(vm.str('WCHPickerButton1.en:GetText()'), 'inv pls');
    vm.run('WCHPickerButton2:Click()');
    const call = vm.openChatCalls().at(-1);
    assert.deepEqual({ line: call.line, chatType: call.chatType, tellTarget: call.tellTarget }, {
      line: '/w Grimtusk-Stormrage Hi, could I get an invite?', chatType: 'WHISPER', tellTarget: 'Grimtusk-Stormrage',
    });
    assert.equal(vm.str('ChatFrame1EditBox:GetText()'), 'Hi, could I get an invite?');
    assert.deepEqual(vm.sent(), [], 'the addon never sends chat');
    // The learned AI term (LF1M is built in, so nothing new) and no stray errors.
    assert.ok(!w.logs.some(l => /failed|error/i.test(l)), w.logs.join('\n'));
  } finally { w.bridge.stop(); }
});

test('e2e: /tr 中文 -> strip t record -> bridge -> slot -> picker -> edit box with whisper target', async () => {
  const w = installedClient();
  try {
    const vm = start(w);
    // A whisper just came in (offline phrase, so no AI request): it sets the /tr target.
    vm.receiveChat('WHISPER', 'ty', 'Thalric');
    vm.advance(0.6);
    assert.ok(vm.chatText().some(t => t.includes('[譯·離線]')), 'offline short-circuit');
    assert.equal(vm.stripCells().length, 0, 'no request for an offline phrase');

    assert.ok(vm.slash('/tr 我五分鐘後到'));
    vm.advance(0.6);
    const frame = captureStrip(vm, w);
    const rec = frame.records.at(-1);
    assert.deepEqual({ kind: rec.kind, channel: rec.channel, sender: rec.sender, text: rec.text },
      { kind: 't', channel: 'WHISPER', sender: 'Thalric', text: '我五分鐘後到' });
    mirrorSignal(vm, w, 'ack', frame.id);
    vm.advance(0.6);

    await deliverFromBridge(vm, w, rec.id);
    assert.equal(vm.str('tostring(WCHPicker:IsShown())'), 'true', 'translate result opens the picker');
    assert.equal(vm.str('WCHPickerButton1.en:GetText()'), 'omw, 5 min');
    vm.run('WCHPickerButton1:Click()');
    const call = vm.openChatCalls().at(-1);
    assert.deepEqual({ line: call.line, chatType: call.chatType, tellTarget: call.tellTarget },
      { line: '/w Thalric omw, 5 min', chatType: 'WHISPER', tellTarget: 'Thalric' });
    assert.deepEqual(vm.sent(), []);
  } finally { w.bridge.stop(); }
});

test('e2e: /wch lang koKR -> hello lang=koKR -> the bridge answers in koKR; the annotation uses Korean labels', async () => {
  const w = installedClient();
  try {
    const vm = start(w);
    vm.slash('/wch lang koKR');
    vm.advance(0.6);
    const hello = captureStrip(vm, w);
    const h = hello.records.find(r => r.kind === 'h');
    assert.ok(h, 'a new hello after the language switch');
    assert.match(h.text, /(^|;)lang=koKR(;|$)/);
    mirrorSignal(vm, w, 'ack', hello.id);
    vm.advance(0.6);
    assert.equal(w.bridge.state.settings.lang, 'koKR');
    assert.equal(w.bridge.locale(), 'koKR');

    vm.clearChat();
    vm.receiveChat('WHISPER', 'LF1M tank', 'Grimtusk');
    vm.advance(0.6);
    const frame = captureStrip(vm, w);
    const rec = frame.records.at(-1);
    mirrorSignal(vm, w, 'ack', frame.id);
    vm.advance(0.6);
    await deliverFromBridge(vm, w, rec.id);
    const line = vm.chatText('ChatFrame1').find(t => t.includes('[번역]'));
    assert.ok(line, 'annotation with the Korean tag:\n' + vm.chatText('ChatFrame1').join('\n'));
    assert.deepEqual(vm.links(line).map(l => l.text), ['[답장]', '[상세]']);
    assert.deepEqual(vm.sent(), []);
  } finally { w.bridge.stop(); }
});
