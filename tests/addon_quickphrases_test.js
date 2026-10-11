// Quick phrases (QuickPhrases.lua + the WCHQuick window): data completeness, /wch say
// and /wch q, clicking a phrase fills the chat box (never sends). fengari VM.
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const { boot, LANGS } = require('./helpers/addon');
const { parseToc, ROOT } = require('./helpers/lua');

const CATS = ['greet', 'group', 'wait', 'thanks', 'leave', 'trade'];

test('QuickPhrases.lua: 6 categories, 4-6 phrases each, English set, every phrase and title in all 9 languages, no duplicates', () => {
  const vm = boot({ login: false });
  const qp = vm.eval('WCH_QuickPhrases');
  assert.deepEqual(qp.categories.map(c => c.key), CATS);
  const seen = new Set();
  for (const c of qp.categories) {
    for (const lang of LANGS) assert.ok(typeof c.title[lang] === 'string' && c.title[lang].trim(), `${c.key} title ${lang}`);
    assert.deepEqual(Object.keys(c.title).sort(), [...LANGS].sort(), `${c.key} title languages`);
    assert.ok(c.phrases.length >= 4 && c.phrases.length <= 6, `${c.key}: ${c.phrases.length} phrases`);
    for (const p of c.phrases) {
      assert.equal(typeof p.en, 'string');
      assert.ok(p.en.trim().length > 0, `${c.key}: empty English`);
      assert.ok(!/^[\s/]/.test(p.en) && !p.en.includes('|') && !/[\r\n]/.test(p.en), `${p.en}: no slash command, escape or line break`);
      const k = p.en.toLowerCase();
      assert.ok(!seen.has(k), `duplicate: ${p.en}`);
      seen.add(k);
      assert.deepEqual(Object.keys(p.tr).sort(), [...LANGS].sort(), `${p.en} languages`);
      for (const lang of LANGS) {
        assert.ok(typeof p.tr[lang] === 'string' && p.tr[lang].trim(), `${p.en} ${lang}`);
        assert.ok(!p.tr[lang].includes('|') && !/[\r\n]/.test(p.tr[lang]), `${p.en} ${lang}: no escape/line break`);
      }
    }
  }
});

test('the TOC loads QuickPhrases.lua before UI.lua', () => {
  const { files } = parseToc(path.join(ROOT, 'addon', 'WoWChatHelper', 'WoWChatHelper.toc'));
  const names = files.map(f => path.basename(f));
  assert.ok(names.includes('QuickPhrases.lua'));
  assert.ok(names.indexOf('QuickPhrases.lua') < names.indexOf('UI.lua'));
  const vm = boot({ toc: true });
  assert.equal(vm.str('type(WCH_QuickPhrases)'), 'table');
});

test('/wch say opens the window: category buttons left, phrases right (English + translation); a click fills the box, never sends', () => {
  const vm = boot({ locale: 'zhTW' });
  vm.slash('/wch say');
  assert.equal(vm.str('tostring(WCHQuick:IsShown())'), 'true');
  assert.match(vm.str('WCHQuick.title:GetText()'), /^快速語句 → 說/);
  assert.equal(vm.str('WCHQuickCat1:GetText()'), vm.str('WCH_QuickPhrases.categories[1].title.zhTW'));
  // First category shown by default.
  assert.equal(vm.str('WCHQuickPhrase1.en:GetText()'), vm.str('WCH_QuickPhrases.categories[1].phrases[1].en'));
  // Switch to "wait".
  vm.run('WCHQuickCat3:Click()');
  const wait = vm.eval('WCH_QuickPhrases.categories[3]');
  assert.equal(wait.key, 'wait');
  for (let i = 1; i <= 6; i++) {
    const p = wait.phrases[i - 1];
    assert.equal(vm.str(`tostring(WCHQuickPhrase${i}:IsShown())`), p ? 'true' : 'false');
    if (p) {
      assert.equal(vm.str(`WCHQuickPhrase${i}.en:GetText()`), p.en);
      assert.equal(vm.str(`WCHQuickPhrase${i}.gloss:GetText()`), p.tr.zhTW);
    }
  }
  vm.run('ChatFrame1EditBox:SetAttribute("chatType", "PARTY")');
  vm.run('WCHQuickPhrase2:Click()');
  const c = vm.openChatCalls().at(-1);
  assert.equal(c.text, wait.phrases[1].en);
  assert.equal(c.chatType, 'PARTY', 'stays on the box channel');
  assert.equal(vm.str('ChatFrame1EditBox:GetText()'), wait.phrases[1].en);
  assert.equal(vm.str('tostring(WCHQuick:IsShown())'), 'false');
  assert.deepEqual(vm.sent(), [], 'nothing sent');
});

test('/wch q after a whisper: the phrase goes to that person (picker target rule); Esc closes', () => {
  const vm = boot();
  vm.receiveChat('WHISPER', 'hey', 'Bob-Stormrage');
  vm.advance(0.6);
  vm.slash('/wch q');
  assert.match(vm.str('WCHQuick.title:GetText()'), /密語 Bob-Stormrage/);
  vm.run('WCHQuickCat4:Click(); WCHQuickPhrase1:Click()');
  const c = vm.openChatCalls().at(-1);
  assert.deepEqual([c.chatType, c.tellTarget, c.text], ['WHISPER', 'Bob-Stormrage', vm.str('WCH_QuickPhrases.categories[4].phrases[1].en')]);
  vm.slash('/wch q');
  vm.escape();
  assert.equal(vm.str('tostring(WCHQuick:IsShown())'), 'false');
  assert.deepEqual(vm.sent(), []);
});

test('status window button opens quick phrases; translations follow /wch lang', () => {
  const vm = boot();
  vm.slash('/wch');
  assert.equal(vm.str('WCHStatusQuick:GetText()'), '快速語句');
  vm.run('WCHStatusQuick:Click()');
  assert.equal(vm.str('tostring(WCHQuick:IsShown())'), 'true');
  vm.slash('/wch lang deDE');
  assert.equal(vm.str('WCHStatusQuick:GetText()'), 'Schnellsätze');
  assert.equal(vm.str('WCHQuickCat1:GetText()'), vm.str('WCH_QuickPhrases.categories[1].title.deDE'));
  assert.equal(vm.str('WCHQuickPhrase1.gloss:GetText()'), vm.str('WCH_QuickPhrases.categories[1].phrases[1].tr.deDE'));
  assert.match(vm.str('WCHQuick.title:GetText()'), /^Schnellsätze → /);
});

test('the target is taken again at click time: a newer whisper, or 2 minutes passing, changes it', () => {
  const vm = boot();
  vm.receiveChat('WHISPER', 'hey', 'Bob');
  vm.advance(0.6);
  vm.slash('/wch q');
  assert.match(vm.str('WCHQuick.title:GetText()'), /密語 Bob/);
  vm.receiveChat('WHISPER', 'yo', 'Carol');
  vm.advance(0.6);
  vm.run('WCHQuickPhrase1:Click()');
  let c = vm.openChatCalls().at(-1);
  assert.deepEqual([c.chatType, c.tellTarget], ['WHISPER', 'Carol']);
  assert.match(vm.str('WCHQuick.title:GetText()'), /密語 Carol/);
  // Open, then wait past the 2 minutes: back to the box's channel.
  vm.slash('/wch q');
  vm.run('ChatFrame1EditBox:SetAttribute("chatType", "GUILD")');
  vm.advance(130);
  vm.run('WCHQuickPhrase1:Click()');
  c = vm.openChatCalls().at(-1);
  assert.equal(c.chatType, 'GUILD');
  assert.match(c.line, /^\/g /, 'no /w Carol any more');
  assert.deepEqual(vm.sent(), []);
});
