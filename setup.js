#!/usr/bin/env node
// Adapted from wow-ai (MIT) by chelinho139: setup.js
//
// One-shot installer:
//
//   node setup.js [--wow "<client folder>"] [--config <file>] [--claude "<path to claude>"]
//
// Finds the WoW: Forever client, copies addon/WoWChatHelper into Interface\AddOns, writes
// bridge/config.json from config.example.json (if missing), reports whether the Claude
// Code CLI was found, and builds the slot pool + signal files (bridge/install-slots.js).
// Re-running is safe: an existing config.json and generated files are kept.
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = __dirname;
const ADDON = 'WoWChatHelper';
const ADDON_SRC = path.join(ROOT, 'addon', ADDON);
const BRIDGE = path.join(ROOT, 'bridge');
const EXAMPLE = path.join(BRIDGE, 'config.example.json');

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) args[a.slice(2)] = argv[i + 1] !== undefined && !argv[i + 1].startsWith('--') ? argv[++i] : true;
  }
  return args;
}

function gameExe(dir) {
  try { return fs.readdirSync(dir).find(f => /^Wow.*\.exe$/i.test(f)) || null; } catch { return null; }
}

// A client folder has Interface\ and a Wow*.exe next to it.
function isClient(dir) {
  return !!dir && fs.existsSync(path.join(dir, 'Interface')) && !!gameExe(dir);
}

const FLAVORS = ['_forever_', '_classic_beta_', '_retail_', '_classic_era_', '_classic_', '_beta_', '_ptr_'];

function findClient(wow, env = process.env, platform = process.platform) {
  if (wow) {
    if (isClient(wow)) return path.resolve(wow);
    // Pointed at "World of Warcraft" itself: look for a flavor folder inside it.
    for (const f of FLAVORS) if (isClient(path.join(wow, f))) return path.resolve(wow, f);
    throw new Error(`--wow "${wow}" does not look like a WoW client folder (needs Interface\\ and Wow*.exe)`);
  }
  let roots;
  if (platform === 'win32') {
    roots = [env['ProgramFiles(x86)'], env.ProgramFiles, 'C:\\', 'D:\\', 'E:\\', 'C:\\Games', 'D:\\Games', 'E:\\Games']
      .filter(Boolean).map(r => path.join(r, 'World of Warcraft'));
  } else {
    roots = [env.WINEPREFIX, path.join(os.homedir(), '.wine')].filter(Boolean)
      .flatMap(p => ['Program Files (x86)', 'Program Files'].map(pf => path.join(p, 'drive_c', pf, 'World of Warcraft')));
  }
  for (const root of roots) for (const f of FLAVORS) if (isClient(path.join(root, f))) return path.join(root, f);
  throw new Error('Could not find the WoW client. Pass --wow "<path to World of Warcraft\\_forever_>" (the folder with Wow.exe)');
}

// Copies the addon folder (recursively: Fonts\ too). Inbox.lua and sig\ belong to the
// bridge once it runs, so an existing Inbox.lua is kept and sig\ is never touched.
function copyAddon(client, src = ADDON_SRC) {
  const dest = path.join(client, 'Interface', 'AddOns', ADDON);
  let copied = 0;
  const walk = (from, to, top) => {
    fs.mkdirSync(to, { recursive: true });
    for (const ent of fs.readdirSync(from, { withFileTypes: true })) {
      if (top && ent.name === 'sig') continue;
      const a = path.join(from, ent.name), b = path.join(to, ent.name);
      if (ent.isDirectory()) { walk(a, b, false); continue; }
      if (top && ent.name === 'Inbox.lua' && fs.existsSync(b)) continue;
      fs.copyFileSync(a, b);
      copied++;
    }
  };
  walk(src, dest, true);
  return { dest, copied };
}

function writeConfig(configFile, client, args, log) {
  if (fs.existsSync(configFile)) {
    const cfg = JSON.parse(fs.readFileSync(configFile, 'utf8'));
    const notes = [];
    if (cfg.wowPath !== client) { cfg.wowPath = client; notes.push('wowPath'); }
    if (typeof args.claude === 'string' && cfg.claudePath !== args.claude) { cfg.claudePath = args.claude; notes.push('claudePath'); }
    if (notes.length) {
      fs.writeFileSync(configFile, JSON.stringify(cfg, null, 2) + '\n');
      log(`config   : ${configFile} updated (${notes.join(', ')}); everything else kept`);
    } else log(`config   : ${configFile} already exists, keeping it`);
    return cfg;
  }
  const cfg = JSON.parse(fs.readFileSync(EXAMPLE, 'utf8'));
  cfg.wowPath = client;
  if (typeof args.claude === 'string') cfg.claudePath = args.claude;
  const exe = gameExe(client);
  if (exe) cfg.capture.processName = exe.replace(/\.exe$/i, '');
  fs.mkdirSync(path.dirname(configFile), { recursive: true });
  fs.writeFileSync(configFile, JSON.stringify(cfg, null, 2) + '\n');
  log(`config   : wrote ${configFile}`);
  return cfg;
}

// Is the Claude Code CLI there, and which version? (No model call.)
function claudeReport(cfg) {
  const ai = require(path.join(BRIDGE, 'ai.js'));
  const cmd = ai.resolveCommand(cfg.claudePath || '');
  if (!cmd.found) return { found: false, line: 'NOT FOUND - ' + cmd.note };
  const r = spawnSync(cmd.file, [...cmd.args, '--version'], { encoding: 'utf8', timeout: 20000, windowsHide: true });
  const version = String(r.stdout || '').trim().split('\n')[0];
  return { found: true, cmd, version, line: [cmd.file, ...cmd.args].join(' ') + (version ? `  (${version})` : '') };
}

function setup(argv, log = console.log) {
  const args = parseArgs(argv);
  const configFile = path.resolve(typeof args.config === 'string' ? args.config : path.join(BRIDGE, 'config.json'));
  const client = findClient(typeof args.wow === 'string' ? args.wow : '');
  log(`client   : ${client}`);
  const { dest, copied } = copyAddon(client);
  log(`addon    : ${copied} file(s) -> ${dest}`);
  const cfg = writeConfig(configFile, client, args, log);
  const claude = claudeReport(cfg);
  log(`claude   : ${claude.line}`);
  log('slots    : building the reply-slot pool and signal files...');
  const { installSlots } = require(path.join(BRIDGE, 'install-slots.js'));
  const addons = path.join(client, 'Interface', 'AddOns');
  const { made, kept } = installSlots(addons, cfg);
  log(`slots    : ${cfg.slots || 200} slot addons; files created: ${made}, already present: ${kept}`);
  log(`
Done. Next:
  1. Fully quit and relaunch World of Warcraft (it only discovers new addon files at launch).
  2. At character select > AddOns, enable "WoW Chat Helper" (leave the "slot ###" entries enabled).
  3. Start the bridge:  npm start   (or double-click bridge\\start-window.cmd for its own window)
  4. In game:  /wch
${claude.found ? '' : '\n  !! Install Claude Code and log in first (https://claude.com/claude-code, then run `claude` once).\n'}`);
  return { client, configFile, cfg, addonDest: dest, copied, made, kept, claude };
}

if (require.main === module) {
  try { setup(process.argv.slice(2)); } catch (e) {
    console.error('setup failed:', e.message);
    process.exit(1);
  }
}

module.exports = { setup, findClient, isClient, copyAddon, writeConfig, parseArgs, claudeReport };
