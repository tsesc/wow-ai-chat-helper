// bridge/logfile.js: the rolling log file (one file per local date, UTF-8, '\n' lines,
// old dates pruned, a failing write warns once and never throws). Temp folders and a
// fake clock.
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const util = require('util');
const { LogFile, fromConfig, teeConsole, localDate, DEFAULT_DIR, DEFAULT_KEEP_DAYS } = require('../bridge/logfile');

const tmpdir = () => fs.mkdtempSync(path.join(os.tmpdir(), 'wch-log-'));
const clock = (d) => { const c = { t: d, now: () => c.t }; return c; };

test('write: creates the folder, appends UTF-8 lines with a local date-time prefix, one \\n each', () => {
  const dir = path.join(tmpdir(), 'nested', 'logs');
  const c = clock(new Date(2026, 9, 11, 9, 5, 7));
  const log = new LogFile({ dir, now: c.now });
  log.write('hello sessA #1 (player=測試者-Realm); language zhTW');
  log.write('WoW Chat Helper bridge\r\n  addons   : C:\\Games\\WoW\\Interface\\AddOns\n');
  assert.strictEqual(log.file(), path.join(dir, 'bridge-2026-10-11.log'));
  const text = fs.readFileSync(log.file(), 'utf8');
  assert.strictEqual(text,
    '2026-10-11 09:05:07 hello sessA #1 (player=測試者-Realm); language zhTW\n' +
    '2026-10-11 09:05:07 WoW Chat Helper bridge\n' +
    '2026-10-11 09:05:07   addons   : C:\\Games\\WoW\\Interface\\AddOns\n');
});

test('a line that starts with the bridge\'s HH:MM:SS gets only the date; just after midnight it stays in the old day', () => {
  const dir = tmpdir();
  const c = clock(new Date(2026, 9, 11, 14, 6, 2));
  const log = new LogFile({ dir, now: c.now });
  log.write('14:06:01 hello sessA #1; signals off (selftest validunplayable)');
  log.write('banner line');
  assert.strictEqual(fs.readFileSync(path.join(dir, 'bridge-2026-10-11.log'), 'utf8'),
    '2026-10-11 14:06:01 hello sessA #1; signals off (selftest validunplayable)\n' +
    '2026-10-11 14:06:02 banner line\n');
  // Stamped 23:59:59 by the bridge, written at 00:00:00: the old day's file and date.
  c.t = new Date(2026, 9, 12, 0, 0, 0);
  log.write('23:59:59 result #9: done');
  log.write('00:00:00 result #10: done');
  assert.match(fs.readFileSync(path.join(dir, 'bridge-2026-10-11.log'), 'utf8'), /\n2026-10-11 23:59:59 result #9: done\n$/);
  assert.strictEqual(fs.readFileSync(path.join(dir, 'bridge-2026-10-12.log'), 'utf8'), '2026-10-12 00:00:00 result #10: done\n');
});

test('a long run switches to the next file at local midnight', () => {
  const dir = tmpdir();
  const c = clock(new Date(2026, 9, 11, 23, 59, 59));
  const log = new LogFile({ dir, now: c.now });
  log.write('before midnight');
  c.t = new Date(2026, 9, 12, 0, 0, 1);
  log.write('after midnight');
  assert.deepStrictEqual(fs.readdirSync(dir).sort(), ['bridge-2026-10-11.log', 'bridge-2026-10-12.log']);
  assert.match(fs.readFileSync(path.join(dir, 'bridge-2026-10-11.log'), 'utf8'), /^2026-10-11 23:59:59 before midnight\n$/);
  assert.match(fs.readFileSync(path.join(dir, 'bridge-2026-10-12.log'), 'utf8'), /^2026-10-12 00:00:01 after midnight\n$/);
});

test('prune: keeps today and the keepDays-1 dates before it; leaves other files alone', () => {
  const dir = tmpdir();
  const names = ['bridge-2026-09-30.log', 'bridge-2026-10-04.log', 'bridge-2026-10-05.log', 'bridge-2026-10-11.log',
    'bridge-2026-10-12.log', 'notes.txt', 'bridge-latest.log'];
  for (const n of names) fs.writeFileSync(path.join(dir, n), 'x');
  const log = new LogFile({ dir, now: () => new Date(2026, 9, 11, 12, 0, 0) });
  assert.strictEqual(log.keepDays, DEFAULT_KEEP_DAYS);
  assert.deepStrictEqual(log.prune().sort(), ['bridge-2026-09-30.log', 'bridge-2026-10-04.log']);
  assert.deepStrictEqual(fs.readdirSync(dir).sort(), ['bridge-2026-10-05.log', 'bridge-2026-10-11.log', 'bridge-2026-10-12.log', 'bridge-latest.log', 'notes.txt']);
  // Across a month boundary, keepDays 1 = today only.
  const one = new LogFile({ dir, keepDays: 1, now: () => new Date(2026, 9, 12, 0, 0, 0) });
  assert.deepStrictEqual(one.prune().sort(), ['bridge-2026-10-05.log', 'bridge-2026-10-11.log']);
  assert.deepStrictEqual(new LogFile({ dir: path.join(dir, 'missing') }).prune(), []);
});

test('a write that fails warns once, never throws, and works again once the folder is writable', () => {
  const base = tmpdir();
  const dir = path.join(base, 'logs');
  fs.writeFileSync(dir, 'a file where the folder should be');
  const warnings = [];
  const log = new LogFile({ dir, now: () => new Date(2026, 9, 11, 8, 0, 0), warn: (m) => warnings.push(m) });
  log.write('one');
  log.write('two');
  assert.strictEqual(warnings.length, 1);
  assert.match(warnings[0], /^log: cannot write .*bridge-2026-10-11\.log \(\w+\); going on without the log file$/);
  fs.unlinkSync(dir);
  log.write('three');
  assert.strictEqual(fs.readFileSync(log.file(), 'utf8'), '2026-10-11 08:00:00 three\n');
});

test('fromConfig: logDir (relative to bridge/) and logKeepDays; defaults bridge/logs and 7', () => {
  assert.strictEqual(fromConfig({}).dir, DEFAULT_DIR);
  assert.strictEqual(DEFAULT_DIR, path.join(__dirname, '..', 'bridge', 'logs'));
  assert.strictEqual(fromConfig({}).keepDays, 7);
  const abs = tmpdir();
  assert.strictEqual(fromConfig({ logDir: abs, logKeepDays: 3 }).dir, abs);
  assert.strictEqual(fromConfig({ logDir: abs, logKeepDays: 3 }).keepDays, 3);
  assert.strictEqual(fromConfig({ logDir: 'mylogs' }).dir, path.join(__dirname, '..', 'bridge', 'mylogs'));
  assert.strictEqual(fromConfig({ logKeepDays: 0 }).keepDays, 7);
  assert.strictEqual(localDate(new Date(2026, 0, 2)), '2026-01-02');
});

test('teeConsole: console lines still print and also reach the log file', () => {
  const printed = [];
  const con = { log: (...a) => printed.push(util.format(...a)), info() {}, warn() {}, error: (...a) => printed.push('E ' + util.format(...a)) };
  const written = [];
  teeConsole({ write: (t) => written.push(t) }, con);
  con.log('%s request #%d', '12:00:00', 3, { a: 1 });
  con.error(new Error('boom').message);
  assert.deepStrictEqual(printed, ['12:00:00 request #3 { a: 1 }', 'E boom']);
  assert.deepStrictEqual(written, ['12:00:00 request #3 { a: 1 }', 'boom']);
});
