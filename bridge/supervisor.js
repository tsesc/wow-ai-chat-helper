#!/usr/bin/env node
// Adapted from wow-ai (MIT) by chelinho139: bridge/supervisor.js
//
// Keeps bridge.js running: restarts it 3 s after any exit (spec 5). Ctrl+C stops both.
// Arguments pass straight through to bridge.js. Exit code 0 (--help, --inject done) or 2
// (config problem) is final: no restart loop. Its own lines also go to the bridge's
// log file (logfile.js; logDir / logKeepDays from the same config.json).
'use strict';
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const logfile = require('./logfile');

const argv = process.argv.slice(2);
const ci = argv.indexOf('--config');
const configFile = path.resolve(ci >= 0 && argv[ci + 1] ? argv[ci + 1] : path.join(__dirname, 'config.json'));
let cfg = {};
try { cfg = JSON.parse(fs.readFileSync(configFile, 'utf8')) || {}; } catch {}
logfile.teeConsole(logfile.fromConfig(cfg && typeof cfg === 'object' ? cfg : {}));

let child = null;
let stopping = false;

function start() {
  child = spawn(process.execPath, [path.join(__dirname, 'bridge.js'), ...argv], { stdio: 'inherit' });
  child.on('exit', (code) => {
    child = null;
    if (stopping) return;
    if (code === 2 || code === 0) process.exit(code);
    console.log(`\nbridge exited (${code}); restarting in 3 s`);
    setTimeout(start, 3000);
  });
}

function stop() {
  stopping = true;
  if (child) child.kill();
  process.exit(0);
}

process.on('SIGINT', stop);
process.on('SIGTERM', stop);
start();
