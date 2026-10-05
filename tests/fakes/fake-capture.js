#!/usr/bin/env node
// A stand-in for capture.ps1, for tests: prints the lines of a file (JSON lines, as
// capture.ps1 would emit them) with a short pause between them, then stays alive the
// way the real capture loop does until it is killed.
'use strict';
const fs = require('fs');
const lines = fs.readFileSync(process.argv[2], 'utf8').split(/\r?\n/).filter(Boolean);
let i = 0;
const next = () => {
  if (i < lines.length) { process.stdout.write(lines[i++] + '\n'); setTimeout(next, 30); }
};
next();
setInterval(() => {}, 1000);
