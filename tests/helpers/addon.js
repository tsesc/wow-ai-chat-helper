// Shared setup for the addon_*_test.js suites: boot the WoWChatHelper addon in the
// fengari VM (tests/helpers/lua.js), acknowledge strips, publish slot data.
'use strict';
const fs = require('fs');
const path = require('path');
const { createVM, ROOT } = require('./lua');
const P = require('../../bridge/protocol');

const ADDON_DIR = path.join(ROOT, 'addon', 'WoWChatHelper');
const FILES = ['Codec.lua', 'Locales.lua', 'Core.lua', 'Transport.lua', 'Chat.lua', 'UI.lua'].map(f => path.join(ADDON_DIR, f));
const FONT_DIR = 'Interface\\AddOns\\WoWChatHelper\\Fonts\\';
const FONT = FONT_DIR + 'WCH-CJK.ttf';
const FONTS = { zhTW: FONT, zhCN: FONT_DIR + 'WCH-SC.ttf', koKR: FONT_DIR + 'WCH-KR.ttf' };
const LANGS = ['zhTW', 'zhCN', 'koKR', 'deDE', 'frFR', 'esES', 'ptBR', 'ruRU', 'itIT'];
const glossaryAddon = (lang) => `WoWChatHelper_Glossary_${lang}`;
const realGlossaryFile = (lang) => path.join(ROOT, 'addon', glossaryAddon(lang), 'Glossary.lua');

// Small glossaries with the shape tools/build-glossary.js generates (WCH_Glossary =
// { locale, terms = { { term, expansion, tr, cat, ambiguity } }, phrases = { [key] =
// { tr, terms } } }), so these tests don't depend on the real data. Four languages
// have one; the others are "not installed".
const STUB_TR = {
  zhTW: { LFM: '徵人', LF1M: '還缺一人', HC: '英雄難度', tank: '坦克', inv: '邀請', AH: '拍賣場', ty: '謝謝', omw: '在路上',
    p_ty: '謝謝', p_omw: '我在路上了', p_invpls: '請邀我' },
  zhCN: { LFM: '招人', LF1M: '还缺一人', HC: '英雄难度', tank: '坦克', inv: '邀请', AH: '拍卖行', ty: '谢谢', omw: '在路上',
    p_ty: '谢谢', p_omw: '我在路上了', p_invpls: '请邀请我' },
  koKR: { LFM: '파티원 구함', LF1M: '1명 구함', HC: '영웅 난이도', tank: '탱커', inv: '초대', AH: '경매장', ty: '고마워', omw: '가는 중',
    p_ty: '고마워', p_omw: '가는 중이야', p_invpls: '초대해 줘' },
  deDE: { LFM: 'suchen weitere', LF1M: 'suchen noch 1', HC: 'heroisch', tank: 'Tank', inv: 'Einladung', AH: 'Auktionshaus', ty: 'danke', omw: 'unterwegs',
    p_ty: 'danke', p_omw: 'bin unterwegs', p_invpls: 'lad mich bitte ein' },
};
function stubGlossarySource(lang) {
  const t = STUB_TR[lang];
  const q = (v) => JSON.stringify(v);
  return `WCH_Glossary = {
  locale = ${q(lang)},
  terms = {
    { term = "LFM", expansion = "Looking For More", tr = ${q(t.LFM)}, cat = "lfg", ambiguity = "" },
    { term = "LF1M", expansion = "Looking For 1 More", tr = ${q(t.LF1M)}, cat = "lfg", ambiguity = "" },
    { term = "HC", expansion = "Heroic", tr = ${q(t.HC)}, cat = "raid", ambiguity = "" },
    { term = "tank", expansion = "damage-absorbing role", tr = ${q(t.tank)}, cat = "role", ambiguity = "" },
    { term = "inv", expansion = "invite", tr = ${q(t.inv)}, cat = "lfg", ambiguity = "" },
    { term = "AH", expansion = "Auction House", tr = ${q(t.AH)}, cat = "trade", ambiguity = "lowercase 'ah' may be the interjection" },
  },
  phrases = {
    ["ty"] = { tr = ${q(t.p_ty)}, terms = { { term = "ty", expansion = "thank you", tr = ${q(t.ty)} } } },
    ["omw"] = { tr = ${q(t.p_omw)}, terms = { { term = "omw", expansion = "on my way", tr = ${q(t.omw)} } } },
    ["inv pls"] = { tr = ${q(t.p_invpls)}, terms = { { term = "inv", expansion = "invite", tr = ${q(t.inv)} } } },
  },
}
`;
}
const STUB_GLOSSARY = stubGlossarySource('zhTW');

// Lua run before the addon: register the glossary LoD addons. real = use the
// generated addon/WoWChatHelper_Glossary_<lang>/Glossary.lua where it exists.
function glossaryAddonsLua(real) {
  const out = [];
  for (const lang of LANGS) {
    let src = null;
    if (real && fs.existsSync(realGlossaryFile(lang))) src = fs.readFileSync(realGlossaryFile(lang), 'utf8');
    else if (STUB_TR[lang]) src = stubGlossarySource(lang);
    if (src) out.push(`STUB.lodAddons[${P.luaString(glossaryAddon(lang))}] = ${P.luaString(src)}`);
  }
  return out.join('\n') + '\n';
}

// opts: signals (default true: ctl/valid.wav playable), hello (default true: wait for
// the login hello and ack it), toc (true: load the real TOC incl. Inbox.lua, and the
// real generated glossary addons where present), locale (what GetLocale() returns;
// default the stub's "enUS"), glossaries (default true: register the glossary LoD
// addons), before (extra Lua run before the addon), preLogin (Lua run before login,
// not repeated on reload), saved, login (default true).
function boot(opts = {}) {
  const { signals = true, hello = true, toc = false, before = '', login = true, preLogin, locale, glossaries = true, ...rest } = opts;
  const pre = (locale ? `STUB.locale = ${P.luaString(locale)}\n` : '') + (glossaries ? glossaryAddonsLua(toc) : '') + before;
  const vmOpts = toc
    ? { before: pre, ...rest }
    : { files: FILES, savedVariableNames: ['WCH_DB'], addonName: 'WoWChatHelper', before: pre, ...rest };
  const vm = createVM(vmOpts);
  if (signals) vm.setPlayable('sig/ctl/valid.wav');
  if (preLogin) vm.run(preLogin); // unlike `before`, not repeated by vm.reload()
  if (!login) return vm;
  vm.login();
  if (hello) {
    vm.advance(2.5);
    if (signals) ackStrip(vm);
    else vm.advance(25); // the hello is dropped after 20 s without an ack
  }
  return vm;
}

// LoadAddOn calls for result slots only (the glossary addon loads at login too).
function slotLoads(vm) { return vm.loadLog().filter(l => /^WoWChatHelper_S\d{3}$/.test(l.name)); }

// Raise ack for the strip's frame id (= highest record id in it) and let a tick see it.
function ackStrip(vm) {
  const f = vm.decodeStrip();
  if (!f || f.error) return null;
  vm.raiseSignal('ack', f.id);
  vm.advance(0.6);
  return f;
}

function session(vm) { return vm.str('WCH_DB.session'); }

// Make every slot addon load `results` (spec 3.3) for this VM's session.
function publish(vm, results, extra = {}) {
  const src = P.renderSlotFile({ now: vm.num('time()'), session: session(vm), results, ...extra });
  vm.setSlotSource(src);
  return src;
}

// Publish, raise ready for `id`, and let the addon load a slot (respecting 3 s spacing).
function deliver(vm, id, results) {
  publish(vm, results);
  vm.raiseSignal('ready', id);
  vm.advance(3.6);
}

function lastId(vm) { return vm.num('WCH_DB.lastId'); }

const sample = {
  x(id, extra = {}) {
    return {
      id, kind: 'x', status: 'done', tr: '徵 1 名坦克打英雄難度死亡礦坑，有意者密我邀請',
      terms: [{ term: 'LF1M', expansion: 'Looking For 1 More', tr: '還缺一人' }, { term: 'HC', expansion: 'Heroic', tr: '英雄難度' }],
      replies: [
        { en: 'inv pls, tank here', tr: '請邀我，我是坦', tone: 'casual' },
        { en: 'Hi! I can tank, could I get an invite?', tr: '嗨，我可以坦，能邀我嗎？', tone: 'polite' },
        { en: 'tank lf inv', tr: '坦克求邀', tone: 'short' },
      ],
      ...extra,
    };
  },
  t(id, extra = {}) {
    return { id, kind: 't', status: 'done', replies: [{ en: 'omw, 5 min', tr: '我在路上，5 分鐘', tone: 'short' }, { en: "I'll be there in 5", tr: '我五分鐘後到', tone: 'polite' }], ...extra };
  },
};

module.exports = { boot, ackStrip, publish, deliver, session, lastId, sample, slotLoads, FONT, FONTS, FILES, LANGS, STUB_GLOSSARY, glossaryAddon, stubGlossarySource, P };
