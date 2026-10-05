#!/usr/bin/env node
// Adapted from wow-ai (MIT) by chelinho139: bridge/install-slots.js (and SILENT_WAV from
// bridge/protocol.js).
//
// Creates the reply-slot addons and signal files the transport needs (spec 3.3, 3.4):
//   Interface/AddOns/WoWChatHelper_S001..S200/{WoWChatHelper_SNNN.toc, Inbox.lua}
//   Interface/AddOns/WoWChatHelper/sig/ready/001..200.wav, sig/ack/001..200.wav,
//   sig/presence/0001..2000.wav (all empty), sig/ctl/empty.wav (empty),
//   sig/ctl/valid.wav (a short silent wav).
// WoW only indexes addon folders and files at launch, so run this once (setup.js does),
// then restart the game. Safe to re-run: existing files are left alone.
//
//   node bridge/install-slots.js [--config <file>] [--addons <Interface/AddOns folder>]
'use strict';

const fs = require('fs');
const path = require('path');
const P = require('./protocol');

const ADDON = 'WoWChatHelper';

// A valid, silent 10 ms 8-bit mono wav: what PlaySoundFile reports as playable.
const SILENT_WAV = (() => {
  const rate = 8000, samples = 80;
  const b = Buffer.alloc(44 + samples);
  b.write('RIFF', 0); b.writeUInt32LE(36 + samples, 4); b.write('WAVE', 8);
  b.write('fmt ', 12); b.writeUInt32LE(16, 16); b.writeUInt16LE(1, 20); b.writeUInt16LE(1, 22);
  b.writeUInt32LE(rate, 24); b.writeUInt32LE(rate, 28); b.writeUInt16LE(1, 32); b.writeUInt16LE(8, 34);
  b.write('data', 36); b.writeUInt32LE(samples, 40);
  b.fill(128, 44);
  return b;
})();

function slotToc(n, iface) {
  return [
    '## Interface: ' + iface,
    '## Title: WoW Chat Helper slot ' + P.pad3(n),
    '## Notes: Reply slot for WoW Chat Helper. Load-on-demand; leave it enabled.',
    '## LoadOnDemand: 1',
    '## Dependencies: ' + ADDON,
    '',
    'Inbox.lua',
    '',
  ].join('\n');
}

// addonsDir = <client>/Interface/AddOns. opts: { slots, presenceMax, tocInterface }.
// -> { made, kept }
function installSlots(addonsDir, opts = {}) {
  const N = opts.slots || P.SLOT_COUNT;
  const PRESENCE = opts.presenceMax || 2000;
  const iface = String(opts.tocInterface || '16001');
  let made = 0, kept = 0;
  const ensure = (file, content) => {
    if (fs.existsSync(file)) { kept++; return; }
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, content);
    made++;
  };
  const sig = (rel) => path.join(addonsDir, ADDON, ...rel.split('/'));
  for (let i = 1; i <= N; i++) {
    const name = P.slotAddonName(i);
    const dir = path.join(addonsDir, name);
    ensure(path.join(dir, name + '.toc'), slotToc(i, iface));
    ensure(path.join(dir, 'Inbox.lua'), P.SLOT_GLOBAL + ' = nil\n');
    ensure(sig(P.signalPath('ready', i)), '');
    ensure(sig(P.signalPath('ack', i)), '');
  }
  for (let k = 1; k <= PRESENCE; k++) ensure(sig(P.signalPath('presence', k)), '');
  ensure(sig(P.signalPath('ctl', 'empty')), '');
  ensure(sig(P.signalPath('ctl', 'valid')), SILENT_WAV);
  return { made, kept };
}

function main(argv) {
  const arg = (name) => { const i = argv.indexOf('--' + name); return i >= 0 ? argv[i + 1] : undefined; };
  let addons = arg('addons');
  let cfg = {};
  if (!addons) {
    const file = path.resolve(arg('config') || path.join(__dirname, 'config.json'));
    try { cfg = JSON.parse(fs.readFileSync(file, 'utf8')); } catch (e) {
      console.error(`cannot read ${file}: ${e.message}. Run node setup.js first, or pass --addons <folder>.`);
      process.exit(1);
    }
    addons = cfg.addonDir || (cfg.wowPath ? path.join(cfg.wowPath, 'Interface', 'AddOns') : '');
  }
  if (!addons || !fs.existsSync(path.join(addons, ADDON, ADDON + '.toc'))) {
    console.error(`${ADDON} addon not found under ${addons || '(no folder)'}; run node setup.js first`);
    process.exit(1);
  }
  const { made, kept } = installSlots(addons, cfg);
  console.log(`slots: ${cfg.slots || P.SLOT_COUNT}  files created: ${made}  already present: ${kept}`);
  if (made > 0) console.log('Now fully quit and relaunch WoW so it sees the new files.');
}

if (require.main === module) main(process.argv.slice(2));

module.exports = { SILENT_WAV, installSlots, slotToc };
