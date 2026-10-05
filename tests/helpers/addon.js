// Shared setup for the addon_*_test.js suites: boot the WoWChatHelper addon in the
// fengari VM (tests/helpers/lua.js), acknowledge strips, publish slot data.
'use strict';
const path = require('path');
const { createVM, ROOT } = require('./lua');
const P = require('../../bridge/protocol');

const ADDON_DIR = path.join(ROOT, 'addon', 'WoWChatHelper');
const FILES = ['Codec.lua', 'Core.lua', 'Transport.lua', 'Chat.lua', 'UI.lua'].map(f => path.join(ADDON_DIR, f));
const FONT = 'Interface\\AddOns\\WoWChatHelper\\Fonts\\WCH-CJK.ttf';

// A small glossary with the shape Glossary.lua provides, so these tests don't depend
// on its exact content.
const STUB_GLOSSARY = `WCH_Glossary = {
  terms = {
    { term = "LFM", expansion = "Looking For More", zh = "徵人", cat = "lfg" },
    { term = "LF1M", expansion = "Looking For 1 More", zh = "還缺一人", cat = "lfg" },
    { term = "HC", expansion = "Heroic", zh = "英雄難度", cat = "raid" },
    { term = "tank", expansion = "damage-absorbing role", zh = "坦克", cat = "role" },
    { term = "inv", expansion = "invite", zh = "邀請", cat = "lfg" },
  },
  phrases = {
    ["ty"] = { zh = "謝謝", terms = { { term = "ty", expansion = "thank you", zh = "謝謝" } } },
    ["omw"] = { zh = "我在路上了", terms = { { term = "omw", expansion = "on my way", zh = "在路上" } } },
    ["inv pls"] = { zh = "請邀我", terms = { { term = "inv", expansion = "invite", zh = "邀請" } } },
  },
}
`;

// opts: signals (default true: ctl/valid.wav playable), hello (default true: wait for
// the login hello and ack it), toc (true: load the real TOC incl. Glossary.lua and
// Inbox.lua), before (extra Lua run before the addon), preLogin (Lua run before login,
// not repeated on reload), saved, login (default true).
function boot(opts = {}) {
  const { signals = true, hello = true, toc = false, before = '', login = true, preLogin, ...rest } = opts;
  const vmOpts = toc
    ? { before, ...rest }
    : { files: FILES, savedVariableNames: ['WCH_DB'], addonName: 'WoWChatHelper', before: STUB_GLOSSARY + '\n' + before, ...rest };
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
      id, kind: 'x', status: 'done', zh: '徵 1 名坦克打英雄難度死亡礦坑，有意者密我邀請',
      terms: [{ term: 'LF1M', expansion: 'Looking For 1 More', zh: '還缺一人' }, { term: 'HC', expansion: 'Heroic', zh: '英雄難度' }],
      replies: [
        { en: 'inv pls, tank here', zh: '請邀我，我是坦', tone: 'casual' },
        { en: 'Hi! I can tank, could I get an invite?', zh: '嗨，我可以坦，能邀我嗎？', tone: 'polite' },
        { en: 'tank lf inv', zh: '坦克求邀', tone: 'short' },
      ],
      ...extra,
    };
  },
  t(id, extra = {}) {
    return { id, kind: 't', status: 'done', replies: [{ en: 'omw, 5 min', zh: '我在路上，5 分鐘', tone: 'short' }, { en: "I'll be there in 5", zh: '我五分鐘後到', tone: 'polite' }], ...extra };
  },
};

module.exports = { boot, ackStrip, publish, deliver, session, lastId, sample, FONT, FILES, STUB_GLOSSARY, P };
