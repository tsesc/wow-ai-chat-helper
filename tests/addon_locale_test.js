// Addon languages: the player's language (GetLocale default, /wch lang override saved
// in WCH_DB.lang, sent as lang= in the hello), the per-language glossary addon
// (WoWChatHelper_Glossary_<lang>, load on demand), UI strings (Locales.lua) and the
// font policy. fengari VM.
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { boot, ackStrip, deliver, sample, slotLoads, FONTS, LANGS, glossaryAddon } = require('./helpers/addon');

const hellos = (vm) => { const f = vm.decodeStrip(); return f ? f.records.filter(r => r.kind === 'h') : []; };
const settingsOf = (rec) => Object.fromEntries(rec.text.split(';').map(kv => kv.split('=')));
const glossaryLoads = (vm) => vm.loadLog().filter(l => /^WoWChatHelper_Glossary_/.test(l.name)).map(l => l.name);
const PROMPT = /pick the language for explanations with \/wch lang/;

test('Locales.lua: all 9 languages have every key, with the same format placeholders as zhTW', () => {
  const vm = boot({ login: false });
  assert.deepEqual(vm.eval('WCH.LANGS'), LANGS);
  const all = vm.eval('WCH.Locales');
  const base = all.zhTW;
  const ph = (s) => (String(s).match(/%[sd]/g) || []).join('');
  assert.ok(Object.keys(base).length >= 70, 'zhTW has the full set');
  for (const lang of LANGS) {
    const t = all[lang];
    assert.ok(t, lang);
    assert.deepEqual(Object.keys(t).sort(), Object.keys(base).sort(), `${lang} keys`);
    for (const [k, v] of Object.entries(t)) {
      assert.equal(typeof v, 'string', `${lang}.${k}`);
      assert.ok(v.length > 0, `${lang}.${k} empty`);
      assert.equal(ph(v), ph(base[k]), `${lang}.${k} placeholders`);
      assert.ok(!/[\r\n]/.test(v), `${lang}.${k} has a line break`);
    }
    if (lang !== 'zhTW') assert.notEqual(t.TAG_X, base.TAG_X, `${lang} is translated`);
  }
});

test('default language = client locale: koKR client -> koKR glossary, Korean UI, lang=koKR in the hello, no prompt', () => {
  const vm = boot({ locale: 'koKR', hello: false });
  assert.equal(vm.str('WCH.lang'), 'koKR');
  assert.equal(vm.str('tostring(WCH_DB.lang)'), 'nil', 'the default is not saved as a choice');
  assert.deepEqual(glossaryLoads(vm), [glossaryAddon('koKR')]);
  assert.equal(vm.str('WCH_Glossary.locale'), 'koKR');
  assert.ok(!vm.chatText().some(t => PROMPT.test(t)), 'no language prompt on a supported client');
  vm.advance(2.5);
  const [h] = hellos(vm);
  assert.equal(settingsOf(h).lang, 'koKR');
  assert.equal(settingsOf(h).locale, 'koKR');
  ackStrip(vm);
  // Offline phrase and UI strings in Korean.
  vm.receiveChat('WHISPER', 'ty', 'Bob');
  assert.ok(vm.chatText().some(t => t.includes('[번역·오프라인]|r 고마워')), vm.chatText().join('\n'));
  const off = vm.chatText().find(t => t.includes('[번역·오프라인]'));
  assert.deepEqual(vm.links(off).map(l => l.text), ['[답장]', '[상세]']);
  vm.slash('/wch');
  assert.equal(vm.str('WCHStatus.head:GetText()'), '자동 설명:');
  assert.match(vm.str('WCHStatus.slots:GetText()'), /^남은 slot: 200 \/ 200$/);
  // Same-locale client: its own fonts cover Hangul, so the chat font stays the client's.
  assert.equal(vm.eval('ChatFrame1.font')[0], 'Fonts\\ARIALN.TTF');
  assert.equal(vm.eval('WCHStatus.slots.font')[0], FONTS.koKR, 'own windows use the bundled Hangul font');
});

test('zhTW client (this user): zhTW, chat font off by default, own windows still use WCH-CJK.ttf', () => {
  const vm = boot({ locale: 'zhTW' });
  assert.equal(vm.str('WCH.lang'), 'zhTW');
  assert.equal(vm.str('tostring(WCH_DB.chatFont)'), 'nil', 'automatic');
  assert.equal(vm.eval('ChatFrame1.font')[0], 'Fonts\\ARIALN.TTF');
  vm.slash('/wch');
  assert.equal(vm.eval('WCHStatus.slots.font')[0], FONTS.zhTW);
  assert.equal(vm.str('tostring(WCHStatus.fontCheck:GetChecked())'), 'false');
  vm.slash('/wch font on');
  assert.equal(vm.eval('ChatFrame1.font')[0], FONTS.zhTW);
  assert.equal(vm.eval('WCH_DB.chatFont'), true);
  vm.slash('/wch font auto');
  assert.equal(vm.str('tostring(WCH_DB.chatFont)'), 'nil');
  assert.equal(vm.eval('ChatFrame1.font')[0], 'Fonts\\ARIALN.TTF');
  assert.ok(vm.chatText().some(t => t.includes('聊天框字型改回自動（目前：關）')));
});

test('unsupported client locale (enUS): zhTW until chosen, one-time English prompt, chat font on (CJK not covered)', () => {
  const vm = boot();
  assert.equal(vm.str('WCH.lang'), 'zhTW');
  assert.equal(vm.chatText().filter(t => PROMPT.test(t)).length, 1);
  assert.equal(vm.eval('ChatFrame1.font')[0], FONTS.zhTW);
  const vm2 = vm.reload();
  vm2.login();
  assert.equal(vm2.chatText().filter(t => PROMPT.test(t)).length, 0, 'asked once, not on every login');
});

test('esMX client maps to esES; a missing glossary addon is reported once and nothing breaks', () => {
  const vm = boot({ locale: 'esMX' });
  assert.equal(vm.str('WCH.lang'), 'esES');
  assert.deepEqual(vm.loadLog().filter(l => l.name === glossaryAddon('esES')).map(l => [l.ok, l.reason]), [[false, 'MISSING']]);
  assert.equal(vm.str('type(WCH_Glossary)'), 'nil');
  const warn = vm.chatText().filter(t => t.includes(glossaryAddon('esES')));
  assert.equal(warn.length, 1);
  assert.match(warn[0], /No se encuentra el addon de glosario/);
  // No offline table: a known phrase goes to the AI instead.
  vm.receiveChat('WHISPER', 'ty', 'Bob');
  vm.advance(0.6);
  const r = vm.decodeStrip().records.at(-1);
  assert.deepEqual([r.kind, r.text], ['x', 'ty']);
  assert.deepEqual(vm.eval('WCH.UI.SearchGlossary("")'), {});
  vm.slash('/wch g');
  assert.equal(vm.str('WCHGlossary.title:GetText()'), 'Glosario');
});

test('/wch lang deDE: loads that glossary addon, saves the choice, sends a hello with lang=deDE, German UI', () => {
  const vm = boot();
  vm.clearChat();
  vm.slash('/wch g');
  vm.slash('/wch lang dede');
  assert.equal(vm.str('WCH.lang'), 'deDE');
  assert.equal(vm.str('WCH_DB.lang'), 'deDE');
  assert.deepEqual(glossaryLoads(vm), [glossaryAddon('zhTW'), glossaryAddon('deDE')]);
  assert.equal(vm.str('WCH_Glossary.locale'), 'deDE');
  assert.ok(vm.chatText().some(t => t.includes('Erklärungssprache ist jetzt Deutsch deDE')));
  vm.advance(0.6);
  const [h] = hellos(vm);
  assert.ok(h, 'a fresh hello is on the strip');
  assert.equal(settingsOf(h).lang, 'deDE');
  ackStrip(vm);
  // The open glossary window follows the language.
  assert.equal(vm.str('WCHGlossary.title:GetText()'), 'Glossar');
  assert.ok(vm.eval('WCH.UI.GlossaryRows()').some(r => r === 'AH — Auction House — Auktionshaus  |cff9a9a9aintegriert|r'));
  // Offline phrase, failure line and status window in German.
  vm.receiveChat('WHISPER', 'ty', 'Bob');
  assert.ok(vm.chatText().some(t => t.includes('[Übers.·offline]|r danke')));
  vm.slash('/wch');
  assert.equal(vm.str('WCHStatus.head:GetText()'), 'Automatisch erklären:');
  assert.equal(vm.str('WCHStatus.fontCheck.label:GetText()'), 'Mitgelieferte Schrift im Chat verwenden');
  vm.slash('/wch help');
  assert.ok(vm.chatText().some(t => t.includes('/wch lang <Code>|auto — Sprache der Erklärungen')));
  // Latin language: client fonts in chat (automatic), and in our own windows.
  assert.equal(vm.eval('ChatFrame1.font')[0], 'Fonts\\ARIALN.TTF', 'bundled CJK font taken off the chat frames');
  assert.equal(vm.eval('WCHStatus.slots.font')[0], 'Fonts\\ARIALN.TTF', "the client's chat font (ChatFontNormal)");
  // Saved: the next login starts in German with the German glossary.
  const vm2 = vm.reload();
  vm2.setPlayable('sig/ctl/valid.wav');
  vm2.login();
  assert.equal(vm2.str('WCH.lang'), 'deDE');
  assert.deepEqual(glossaryLoads(vm2), [glossaryAddon('deDE')]);
  vm2.advance(2.5);
  assert.equal(settingsOf(hellos(vm2)[0]).lang, 'deDE');
});

test('/wch lang zhCN: offline phrase in Simplified Chinese, the SC font on an enUS client; switching back reuses the loaded table', () => {
  const vm = boot();
  vm.slash('/wch lang zhCN');
  vm.receiveChat('PARTY', 'inv pls', 'Ann');
  assert.ok(vm.chatText().some(t => t.includes('[译·离线]|r 请邀请我')), vm.chatText().join('\n'));
  const off = vm.chatText().find(t => t.includes('[译·离线]'));
  assert.match(vm.chatText()[vm.chatText().indexOf(off) + 1], /inv=邀请/);
  assert.equal(vm.eval('ChatFrame1.font')[0], FONTS.zhCN);
  vm.slash('/wch lang zhTW');
  assert.equal(vm.eval('ChatFrame1.font')[0], FONTS.zhTW);
  assert.equal(vm.str('WCH_Glossary.locale'), 'zhTW', 'the zhTW table again, though its addon ran before zhCN');
  vm.slash('/wch lang zhCN');
  assert.equal(vm.str('WCH_Glossary.locale'), 'zhCN');
  assert.equal(glossaryLoads(vm).filter(n => n === glossaryAddon('zhCN')).length, 1, 'cached, not loaded again');
  vm.receiveChat('WHISPER', 'omw', 'Bob');
  assert.ok(vm.chatText().some(t => t.includes('[译·离线]|r 我在路上了')));
});

test('/wch lang: no argument shows the current one, unknown codes are refused, auto goes back to the client locale', () => {
  const vm = boot({ locale: 'frFR' });
  vm.clearChat();
  vm.slash('/wch lang');
  assert.ok(vm.chatText().some(t => t.includes('Langue des explications : Français frFR (suit la langue du jeu)')));
  assert.ok(vm.chatText().some(t => t.includes('zhTW 繁體中文') && t.includes('itIT Italiano')));
  vm.slash('/wch lang klingon');
  assert.ok(vm.chatText().some(t => t.includes('Code de langue non pris en charge : klingon')));
  assert.equal(vm.str('WCH.lang'), 'frFR');
  vm.slash('/wch lang ruRU');
  assert.equal(vm.str('WCH.lang'), 'ruRU');
  assert.ok(vm.chatText().some(t => t.includes('Язык объяснений: Русский ruRU')));
  vm.slash('/wch lang auto');
  assert.equal(vm.str('tostring(WCH_DB.lang)'), 'nil');
  assert.equal(vm.str('WCH.lang'), 'frFR');
});

test('learned terms are kept per language: re-learning in koKR adds a Korean entry, the zhTW one stays; old entries migrate', () => {
  const vm = boot({ saved: { WCH_DB: { learned: { zg: { term: 'ZG', expansion: "Zul'Gurub", zh: '祖爾格拉布', t: 1790000001 } } } } });
  assert.equal(vm.str('WCH_DB.learned.zg.tr'), '祖爾格拉布');
  assert.equal(vm.str('WCH_DB.learned.zg.locale'), 'zhTW');
  assert.deepEqual(vm.eval('WCH.UI.SearchGlossary("zul")').map(e => [e.term, e.tr, e.source]), [['ZG', '祖爾格拉布', 'AI']]);
  vm.slash('/wch lang koKR');
  assert.deepEqual(vm.eval('WCH.UI.SearchGlossary("zul")'), {}, 'not shown in another language');
  vm.receiveChat('WHISPER', 'ZG tonight?', 'Bob');
  vm.advance(0.6);
  const id = vm.decodeStrip().records.at(-1).id;
  ackStrip(vm);
  deliver(vm, id, [sample.x(id, { tr: '오늘 밤 줄구룹?', terms: [{ term: 'ZG', expansion: "Zul'Gurub", tr: '줄구룹' }] })]);
  assert.ok(vm.chatText().some(t => t.includes('[번역]|r 오늘 밤 줄구룹?')));
  assert.ok(vm.chatText().some(t => t.includes('ZG=줄구룹')));
  const zg = vm.eval('WCH_DB.learned["zg\\31koKR"]');
  assert.deepEqual([zg.tr, zg.locale], ['줄구룹', 'koKR']);
  assert.deepEqual([vm.str('WCH_DB.learned.zg.tr'), vm.str('WCH_DB.learned.zg.locale')], ['祖爾格拉布', 'zhTW'], 'zhTW entry untouched');
  assert.deepEqual(vm.eval('WCH.UI.SearchGlossary("zul")').map(e => [e.term, e.tr]), [['ZG', '줄구룹']]);
  // Reply gloss and tone label in Korean.
  vm.clickLink(`wch:r:${id}`);
  assert.match(vm.str('WCHPickerButton2.gloss:GetText()'), /· 정중$/);
  assert.match(vm.str('WCHPicker.title:GetText()'), /^답장 선택 → 귓속말 Bob/);
  // Back in zhTW the Traditional Chinese entry is still there.
  vm.slash('/wch lang zhTW');
  assert.deepEqual(vm.eval('WCH.UI.SearchGlossary("zul")').map(e => [e.term, e.tr]), [['ZG', '祖爾格拉布']]);
});

test('a result that arrives after /wch lang is learned under the language it was written in', () => {
  const vm = boot({ locale: 'zhTW' });
  vm.receiveChat('WHISPER', 'BRD later?', 'Bob');
  vm.advance(0.6);
  const id = vm.decodeStrip().records.at(-1).id;
  ackStrip(vm);
  vm.slash('/wch lang koKR'); // while the request runs
  ackStrip(vm);
  deliver(vm, id, [sample.x(id, { tr: '晚點打黑石深淵？', terms: [{ term: 'BRDX', expansion: 'Blackrock Depths', tr: '黑石深淵' }] })]);
  assert.equal(vm.str('WCH_DB.learned.brdx.locale'), 'zhTW', 'request language, not the current one');
  assert.equal(vm.str('type(WCH_DB.learned["brdx\\31koKR"])'), 'nil');
  // The bridge's lang on the result wins.
  vm.receiveChat('WHISPER', 'MCX tonight', 'Bob');
  vm.advance(0.6);
  const id2 = vm.decodeStrip().records.at(-1).id;
  ackStrip(vm);
  deliver(vm, id2, [{ ...sample.x(id2, { tr: '오늘 밤 MC', terms: [{ term: 'MCX', expansion: 'Molten Core', tr: '화심' }] }), lang: 'koKR' }]);
  assert.equal(vm.str('WCH_DB.learned["mcx\\31koKR"].tr'), '화심');
});

test('saved learned entries of another language under a plain key move to "<term>\\31<lang>"', () => {
  const vm = boot({ locale: 'koKR', saved: { WCH_DB: { learned: { hr: { term: 'hr', tr: '하드 예약', locale: 'koKR', t: 5 }, sr: { term: 'sr', tr: '軟預訂', locale: 'zhTW', t: 6 } } } } });
  assert.equal(vm.str('type(WCH_DB.learned.hr)'), 'nil');
  assert.equal(vm.str('WCH_DB.learned["hr\\31koKR"].tr'), '하드 예약');
  assert.equal(vm.str('WCH_DB.learned.sr.tr'), '軟預訂');
});

test('font setting migration: a saved true from before (the old default) becomes automatic; false stays', () => {
  const on = boot({ locale: 'zhTW', saved: { WCH_DB: { chatFont: true } } });
  assert.equal(on.str('tostring(WCH_DB.chatFont)'), 'nil');
  assert.equal(on.eval('WCH_DB.fontPolicy'), 2);
  assert.equal(on.eval('ChatFrame1.font')[0], 'Fonts\\ARIALN.TTF');
  // Once migrated, an explicit on is kept.
  on.slash('/wch font on');
  const again = on.reload();
  again.login();
  assert.equal(again.eval('WCH_DB.chatFont'), true);
  assert.equal(again.eval('ChatFrame1.font')[0], 'Interface\\AddOns\\WoWChatHelper\\Fonts\\WCH-CJK.ttf');
  const off = boot({ saved: { WCH_DB: { chatFont: false } } });
  assert.equal(off.eval('WCH_DB.chatFont'), false);
  assert.equal(off.eval('ChatFrame1.font')[0], 'Fonts\\ARIALN.TTF');
});

test('koKR / zhCN on a zhTW client: the chat frames keep the client font (its Chinese stays readable); a notice says how to opt in', () => {
  const vm = boot({ locale: 'zhTW' });
  assert.equal(vm.eval('ChatFrame1.font')[0], 'Fonts\\ARIALN.TTF');
  vm.slash('/wch lang koKR');
  assert.equal(vm.eval('ChatFrame1.font')[0], 'Fonts\\ARIALN.TTF', 'no Han-less KR subset on a Chinese client');
  assert.notEqual((vm.eval('ChatFrame1EditBox.font') || [])[0], FONTS.koKR);
  const notice = (t) => t.includes('/wch font on') && t.includes('네모');
  assert.equal(vm.chatText().filter(notice).length, 1, 'one notice');
  vm.slash('/wch lang zhCN');
  assert.equal(vm.eval('ChatFrame1.font')[0], 'Fonts\\ARIALN.TTF');
  // The player can still opt in.
  vm.slash('/wch font on');
  assert.equal(vm.eval('ChatFrame1.font')[0], FONTS.zhCN);
  vm.slash('/wch lang zhTW');
  assert.equal(vm.eval('ChatFrame1.font')[0], FONTS.zhTW, 'explicit on is kept');
  vm.slash('/wch font auto');
  assert.equal(vm.eval('ChatFrame1.font')[0], 'Fonts\\ARIALN.TTF', 'original font restored');
  // A Latin client has no CJK script of its own to lose: koKR gets the Hangul font.
  const en = boot({ locale: 'enUS', saved: { WCH_DB: { lang: 'koKR' } } });
  assert.equal(en.eval('ChatFrame1.font')[0], FONTS.koKR);
});

test('no glossary addons installed at all: login still works, translate and explain still go to the AI', () => {
  const vm = boot({ glossaries: false, locale: 'zhTW' });
  assert.equal(vm.str('type(WCH_Glossary)'), 'nil');
  assert.ok(vm.chatText().some(t => t.includes('找不到術語表插件 WoWChatHelper_Glossary_zhTW（MISSING）')));
  vm.slash('/wtr 我五分鐘後到');
  vm.advance(0.6);
  assert.equal(vm.decodeStrip().records.at(-1).kind, 't');
  assert.deepEqual(slotLoads(vm), []);
});
