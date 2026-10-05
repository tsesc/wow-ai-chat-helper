#!/usr/bin/env node
// Adapted from wow-ai (MIT) by chelinho139: bridge/supervisor.js
//
// Keeps bridge.js running: restarts it 3 s after any exit (spec 5). Ctrl+C stops both.
// Arguments pass straight through to bridge.js. Exit code 0 (--help, --inject done) or 2
// (config problem) is final: no restart loop.
'use strict';
const { spawn } = require('child_process');
const path = require('path');

let child = null;
let stopping = false;

function start() {
  child = spawn(process.execPath, [path.join(__dirname, 'bridge.js'), ...process.argv.slice(2)], { stdio: 'inherit' });
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
