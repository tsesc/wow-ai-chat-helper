// Adapted from wow-ai (MIT) by chelinho139: tests/addon_test.js (the fengari VM setup
// and strip reader).
//
// Lua test harness: runs addon Lua files (as listed in a TOC) in a fengari VM on top
// of tests/wow_stub.lua, a stub of the WoW: Forever client API.
//
// ===========================================================================
// HELPER API
// ===========================================================================
//
//   const { createVM } = require('./helpers/lua');
//   const vm = createVM(opts);
//
// opts (all optional):
//   toc        path to a .toc (default addon/WoWChatHelper/WoWChatHelper.toc). Its file
//              lines are loaded in order; `## SavedVariables[PerCharacter]:` names are
//              what vm.savedVariables() reads back.
//   files      explicit list of Lua file paths instead of a TOC (then addonName defaults
//              to 'WoWChatHelper' and `savedVariableNames` may be given)
//   addonName  the name passed as `...` to each file (default: TOC basename)
//   saved      { WCH_DB: <JS value> } assigned AFTER the files run, as the client does
//   before     Lua source run after the stub but before the addon files (extend the stub)
//   login      true -> vm.login() right away (default false)
//   checkSyntax  default true: every addon file is parsed by luaparse as Lua 5.1 first,
//              so 5.2+ syntax (goto, //, bit ops, \z, \u{}) fails the test like the client
//   sandbox    default true: io, os, require, package, dofile, loadfile, debug, utf8 are
//              removed from _G before the addon runs (the WoW sandbox has none of them)
//
// Running Lua:
//   vm.run(code, ...args)       run a chunk; JS args arrive as `...` (serialized with
//                               protocol.luaSerialize: strings, numbers, booleans, arrays,
//                               plain objects). Errors throw with the Lua message.
//   vm.eval(expr)               evaluate one Lua expression -> JS value (tables via JSON:
//                               sequences -> arrays, other tables -> objects with string
//                               keys, functions dropped, empty table -> {})
//   vm.str(expr) / vm.num(expr) tostring(expr) as a JS string (null for nil) / Number
//   vm.call(fnExpr, ...args)    call a Lua function with JS args -> its first result
//   vm.L                        the raw fengari state
//
// Lifecycle and clock:
//   vm.login()                  ADDON_LOADED(addonName), VARIABLES_LOADED, PLAYER_LOGIN,
//                               PLAYER_ENTERING_WORLD(true, false), then due timers
//   vm.fireEvent(ev, ...args)   STUB.FireEvent: every frame that registered `ev`
//   vm.advance(seconds, step)   move GetTime() forward (step default 0.1 s), running
//                               OnUpdate scripts and due C_Timer.After/NewTimer/NewTicker
//   vm.runTimers() / vm.tick()  wow-ai style: run all pending one-shot timers / every
//                               ticker once, without moving the clock
//   vm.now()                    GetTime()
//   vm.savedVariables()         { name: value } for the TOC's SavedVariables
//   vm.reload()                 a NEW vm with the same opts and saved = savedVariables()
//                               (what /reload does); the old vm is untouched
//
// Chat:
//   vm.receiveChat(ev, text, sender, opts)  simulate an incoming message ('WHISPER' or
//                               'CHAT_MSG_WHISPER'): message filters run per chat frame,
//                               a formatted line is added to ChatFrame1, then the event is
//                               fired to addon frames. opts: { channel: 'Trade - City',
//                               channelIndex: 2, lineID, guid, frames: <Lua expr list> }.
//                               Returns the lineID.
//   vm.chat(frame?)             AddMessage entries [{ frame, text, r, g, b, id, print,
//                               event?, lineID?, sender? }], optionally for one frame name
//   vm.chatText(frame?)         just the texts
//   vm.clearChat()              forget recorded chat lines and prints
//   vm.prints()                 print() output (print also goes to DEFAULT_CHAT_FRAME)
//   vm.links(line)              [{ link, text }] for every |H..|h..|h in a string
//   vm.clickLink(link, text?, button?)  click a hyperlink ("wch:r:12" or "|Hwch:r:12|h[x]|h"):
//                               ChatFrame1's OnHyperlinkClick, then the global SetItemRef
//                               (so hooksecurefunc("SetItemRef", ...) hooks fire)
//   vm.openChatCalls()          every ChatFrame_OpenChat / ChatFrameUtil.OpenChat call:
//                               [{ line, text, chatType, tellTarget, channelTarget, frame }]
//                               (a leading /w Name, /p, /g, /1 ... is parsed like the client)
//   vm.sent()                   SendChatMessage calls (should always be [])
//   vm.slash(line)              run "/wch g tank" via SlashCmdList; true if a command matched
//   vm.escape()                 hide shown UISpecialFrames (Esc)
//
// Transport:
//   vm.setPlayable(path, v=true) make PlaySoundFile(path) report playable (path compare is
//                               case-insensitive, / == \). Relative paths are taken under
//                               Interface\AddOns\WoWChatHelper\.
//   vm.raiseSignal(kind, n)     setPlayable for protocol.signalPath(kind, n): ('ready', id),
//                               ('ack', id), ('presence', k), ('ctl', 'valid')
//   vm.soundCalls()             [{ path, channel, ok }]
//   vm.setSlotSource(src)       Lua source every slot addon executes when loaded (e.g.
//                               protocol.renderSlotFile(data)); vm.setSlotFile(name, src)
//                               for one slot only
//   vm.loadLog()                [{ name, ok, reason }] for every C_AddOns.LoadAddOn call
//   vm.stripCells(frame='WCHStrip', opts)  cells read off the strip frame's visible
//                               textures, like the capture script: textures positioned with
//                               SetPoint("TOPLEFT", strip, "TOPLEFT", col*4, -row*4) and
//                               colored with SetColorTexture (or SetVertexColor); a channel
//                               >= 0.5 is on. opts: { cell: 4, perRow: 200 }. [] when the
//                               frame is missing or hidden.
//   vm.decodeStrip(frame='WCHStrip', opts)  protocol.decodeFrame(stripCells) plus
//                               `records` = protocol.parseRecords(payload); null if no strip
//
// Lua 5.3 caveats (fengari, not 5.1): 3/1 is a float, so tostring(3/1) == "3.0" and
// "x" .. 3/1 == "x3.0"; string.format("%d", 2.5) errors. Use math.floor for integers.
// ===========================================================================
'use strict';
const fs = require('fs');
const path = require('path');
const fengari = require('fengari');
const luaparse = require('luaparse');
const protocol = require('../../bridge/protocol');

const { lua, lauxlib, lualib, to_luastring, to_jsstring } = fengari;
const ROOT = path.join(__dirname, '..', '..');
const STUB_FILE = path.join(__dirname, '..', 'wow_stub.lua');
const DEFAULT_TOC = path.join(ROOT, 'addon', 'WoWChatHelper', 'WoWChatHelper.toc');
const ADDON_SIG_ROOT = 'Interface\\AddOns\\WoWChatHelper\\';

// TOC -> { files: [abs paths], savedVariables: [names], metadata: {} }
function parseToc(tocPath) {
  const dir = path.dirname(tocPath);
  const files = [], savedVariables = [], metadata = {};
  for (const raw of fs.readFileSync(tocPath, 'utf8').replace(/^﻿/, '').split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    const meta = line.match(/^##\s*([^:]+):\s*(.*)$/);
    if (meta) {
      const [, k, v] = meta;
      metadata[k.trim()] = v.trim();
      if (/^SavedVariables(PerCharacter)?$/.test(k.trim())) savedVariables.push(...v.split(',').map(s => s.trim()).filter(Boolean));
      continue;
    }
    if (line.startsWith('#')) continue;
    files.push(path.join(dir, ...line.split(/[\\/]/)));
  }
  return { files, savedVariables, metadata };
}

function checkLua51(src, file) {
  try {
    luaparse.parse(src, { luaVersion: '5.1', comments: false, locations: false });
  } catch (e) {
    throw new Error(`${path.relative(ROOT, file)}: not valid Lua 5.1: ${e.message}`);
  }
}

function createVM(opts = {}) {
  let files, savedNames, addonName, metadata = {};
  if (opts.files) {
    files = opts.files.map(f => path.resolve(ROOT, f));
    savedNames = opts.savedVariableNames || [];
    addonName = opts.addonName || 'WoWChatHelper';
  } else {
    const toc = path.resolve(ROOT, opts.toc || DEFAULT_TOC);
    const parsed = parseToc(toc);
    files = parsed.files; savedNames = parsed.savedVariables; metadata = parsed.metadata;
    addonName = opts.addonName || path.basename(toc, '.toc');
  }

  const L = lauxlib.luaL_newstate();
  lualib.luaL_openlibs(L);

  const errMsg = () => {
    const s = lua.lua_tostring(L, -1);
    lua.lua_pop(L, 1);
    return s ? to_jsstring(s) : '(non-string error)';
  };

  // Load `src` as chunk `name` and call it with the given Lua argument expressions.
  const exec = (src, name, argExprs = []) => {
    if (lauxlib.luaL_loadbuffer(L, to_luastring(src), null, to_luastring('@' + name)) !== lua.LUA_OK) {
      throw new Error('Lua load: ' + errMsg());
    }
    for (const a of argExprs) {
      if (lauxlib.luaL_loadstring(L, to_luastring('return ' + a)) !== lua.LUA_OK) throw new Error('Lua arg: ' + errMsg());
      if (lua.lua_pcall(L, 0, 1, 0) !== lua.LUA_OK) throw new Error('Lua arg: ' + errMsg());
    }
    if (lua.lua_pcall(L, argExprs.length, 0, 0) !== lua.LUA_OK) throw new Error('Lua error: ' + errMsg());
  };

  const run = (code, ...args) => exec(code, 'test', args.map(a => protocol.luaSerialize(a)));
  const eval_ = (expr) => {
    exec(`__WCH_RESULT = STUB.ToJSON((${expr}))`, 'eval');
    lua.lua_getglobal(L, to_luastring('__WCH_RESULT'));
    const s = to_jsstring(lua.lua_tostring(L, -1));
    lua.lua_pop(L, 1);
    return JSON.parse(s);
  };
  const str = (expr) => {
    exec(`local v = (${expr}); if v == nil then __WCH_RESULT = nil else __WCH_RESULT = tostring(v) end`, 'eval');
    lua.lua_getglobal(L, to_luastring('__WCH_RESULT'));
    const out = lua.lua_isnil(L, -1) ? null : to_jsstring(lua.lua_tostring(L, -1));
    lua.lua_pop(L, 1);
    return out;
  };

  exec(fs.readFileSync(STUB_FILE, 'utf8'), 'wow_stub.lua');
  run('local name, meta = ...; STUB.addonMetadata[name] = meta; STUB.loaded[name] = true', addonName, metadata);
  if (opts.sandbox !== false) {
    exec('io, os, require, package, dofile, loadfile, debug, utf8 = nil, nil, nil, nil, nil, nil, nil, nil', 'sandbox');
  }
  if (opts.before) exec(opts.before, 'before');

  for (const file of files) {
    const src = fs.readFileSync(file, 'utf8');
    if (opts.checkSyntax !== false) checkLua51(src, file);
    exec(src, path.relative(ROOT, file), [protocol.luaString(addonName), `STUB.AddonNamespace(${protocol.luaString(addonName)})`]);
  }
  for (const [name, value] of Object.entries(opts.saved || {})) {
    if (value !== undefined) exec(`${name} = ...`, 'saved', [protocol.luaSerialize(value)]);
  }

  const vm = {
    L, addonName, files, savedNames,
    run, eval: eval_, str,
    num: (expr) => Number(str(expr)),
    call: (fnExpr, ...args) => eval_(`(${fnExpr})(${args.map(a => protocol.luaSerialize(a)).join(', ')})`),

    login() {
      run(`local n = ...
        STUB.FireEvent("ADDON_LOADED", n)
        STUB.FireEvent("VARIABLES_LOADED")
        STUB.FireEvent("PLAYER_LOGIN")
        STUB.FireEvent("PLAYER_ENTERING_WORLD", true, false)
        STUB.RunDue()`, addonName);
      return vm;
    },
    fireEvent: (ev, ...args) => run('STUB.FireEvent(...)', ev, ...args),
    advance: (seconds, step) => run('STUB.Advance(...)', seconds, step ?? 0.1),
    runTimers: () => run('STUB.RunTimers()'),
    tick: () => run('STUB.Tick()'),
    now: () => vm.num('GetTime()'),
    savedVariables() {
      const out = {};
      for (const n of savedNames) out[n] = eval_(n);
      return out;
    },
    reload: () => createVM({ ...opts, saved: vm.savedVariables() }),

    receiveChat: (ev, text, sender, o = {}) => {
      const { frames, ...rest } = o;
      if (frames) return vm.num(`STUB.ReceiveChat(${protocol.luaString(ev)}, ${protocol.luaString(text)}, ${protocol.luaString(sender ?? '')}, (function(o) o.frames = { ${frames.join(', ')} }; return o end)(${protocol.luaSerialize(rest)}))`);
      return vm.num(`STUB.ReceiveChat(${protocol.luaString(ev)}, ${protocol.luaString(text)}, ${protocol.luaString(sender ?? '')}, ${protocol.luaSerialize(rest)})`);
    },
    chat: (frame) => {
      const all = eval_('STUB.chat');
      const list = Array.isArray(all) ? all : [];
      return frame ? list.filter(e => e.frame === frame) : list;
    },
    chatText: (frame) => vm.chat(frame).map(e => e.text),
    clearChat: () => run('wipe(STUB.chat); wipe(STUB.prints); for _, f in ipairs(STUB.chatFrames) do f.messages = {} end'),
    prints: () => { const p = eval_('STUB.prints'); return Array.isArray(p) ? p : []; },
    links: (line) => { const l = eval_(`STUB.Links(${protocol.luaString(line)})`); return Array.isArray(l) ? l : []; },
    clickLink: (link, text, button) => run('STUB.ClickLink(...)', link, text ?? null, button ?? 'LeftButton'),
    openChatCalls: () => { const v = eval_('STUB.openChat'); return Array.isArray(v) ? v : []; },
    sent: () => { const v = eval_('STUB.sent'); return Array.isArray(v) ? v : []; },
    slash: (line) => eval_(`STUB.Slash(${protocol.luaString(line)})`),
    escape: () => eval_('STUB.PressEscape()'),

    setPlayable(p, v = true) {
      const full = /^interface[\\/]/i.test(p) ? p : ADDON_SIG_ROOT + p.replace(/\//g, '\\');
      run('STUB.SetPlayable(...)', full, v);
    },
    raiseSignal: (kind, n) => vm.setPlayable(protocol.signalPath(kind, n)),
    soundCalls: () => { const v = eval_('STUB.soundCalls'); return Array.isArray(v) ? v : []; },
    setSlotSource: (src) => run('STUB.slotSource = ...', src),
    setSlotFile: (name, src) => run('local n, s = ...; STUB.slotFiles[n] = s', name, src),
    loadLog: () => { const v = eval_('STUB.loadLog'); return Array.isArray(v) ? v : []; },

    stripCells(frame = 'WCHStrip', o = {}) {
      const cell = o.cell || protocol.CELL, perRow = o.perRow || protocol.CELLS_PER_ROW;
      const s = str(`(function(f, cell, perRow)
        if not f or not f:IsVisible() then return "" end
        local parts = {}
        for _, t in ipairs(f.textures) do
          local c = t.color or t.vertexColor
          if t.shown and c then
            local col, row = math.floor((t.x or 0) / cell + 0.5), math.floor(-(t.y or 0) / cell + 0.5)
            local v = (c[1] >= 0.5 and 4 or 0) + (c[2] >= 0.5 and 2 or 0) + (c[3] >= 0.5 and 1 or 0)
            parts[#parts + 1] = string.format("%d:%d", row * perRow + col, v)
          end
        end
        return table.concat(parts, ",")
      end)(_G[${protocol.luaString(frame)}], ${cell}, ${perRow})`);
      const cells = [];
      if (!s) return cells;
      for (const p of s.split(',')) { const [i, v] = p.split(':').map(Number); cells[i] = v; }
      for (let i = 0; i < cells.length; i++) if (cells[i] === undefined) cells[i] = 0;
      return cells;
    },
    decodeStrip(frame = 'WCHStrip', o = {}) {
      const cells = vm.stripCells(frame, o);
      if (!cells.length) return null;
      const f = protocol.decodeFrame(cells);
      if (!f || f.error) return f;
      return { ...f, records: protocol.parseRecords(f.payload) };
    },
  };
  if (opts.login) vm.login();
  return vm;
}

module.exports = { createVM, parseToc, checkLua51, ROOT };
