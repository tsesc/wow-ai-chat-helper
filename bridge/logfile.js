// Rolling log file: every line the bridge (and the supervisor) prints also goes to
// <logDir>/bridge-YYYY-MM-DD.log, one file per local date, so a problem can be looked
// at after the console window is closed. UTF-8, '\n' line ends. A line that already
// starts with the bridge's local HH:MM:SS gets only the local date in front, any other
// line the local date and time. Files older than logKeepDays dates are removed by prune()
// (the bridge calls it at start). A write that fails never stops the bridge: one
// warning on stderr, then the file is skipped until a write works again.
//
// config.json: logDir (default bridge/logs; a relative path is taken from bridge/),
// logKeepDays (default 7: today and the 6 dates before it are kept).
'use strict';

const fs = require('fs');
const path = require('path');
const util = require('util');

const DEFAULT_DIR = path.join(__dirname, 'logs');
const DEFAULT_KEEP_DAYS = 7;
const NAME = /^bridge-(\d{4}-\d{2}-\d{2})\.log$/;

const pad = (n) => String(n).padStart(2, '0');
function localDate(d) { return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; }
function localTime(d) { return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`; }
const HMS = /^(\d{2}):(\d{2}):(\d{2}) /;
const secs = (h, m, s) => (Number(h) * 60 + Number(m)) * 60 + Number(s);

class LogFile {
  // opts: { dir, keepDays, now () -> Date, warn (msg) }
  constructor(opts = {}) {
    this.dir = opts.dir || DEFAULT_DIR;
    const keep = Math.floor(Number(opts.keepDays));
    this.keepDays = keep >= 1 ? keep : DEFAULT_KEEP_DAYS;
    this.now = opts.now || (() => new Date());
    this.warn = opts.warn || ((m) => { try { process.stderr.write(m + '\n'); } catch {} });
    this.failing = false;
  }

  fileFor(d) { return path.join(this.dir, `bridge-${localDate(d)}.log`); }
  file() { return this.fileFor(this.now()); }

  // text: one or more lines (a trailing newline adds no empty line).
  write(text) {
    let d = this.now();
    const lines = String(text).replace(/\r?\n$/, '').split(/\r?\n/);
    // A line stamped just before midnight but written just after it belongs to the
    // previous date (its file and its date prefix); a time more than 12 h ahead of now
    // can only mean that.
    const m = HMS.exec(lines[0]);
    if (m && secs(m[1], m[2], m[3]) - secs(d.getHours(), d.getMinutes(), d.getSeconds()) > 12 * 3600) {
      d = new Date(d.getFullYear(), d.getMonth(), d.getDate() - 1, 23, 59, 59);
    }
    const file = this.fileFor(d);
    const date = localDate(d), full = `${date} ${localTime(d)}`;
    const body = lines.map(l => `${HMS.test(l) ? date : full} ${l}`).join('\n') + '\n';
    try {
      try { fs.appendFileSync(file, body, 'utf8'); } catch (e) {
        if (e.code !== 'ENOENT') throw e;
        fs.mkdirSync(this.dir, { recursive: true });
        fs.appendFileSync(file, body, 'utf8');
      }
      this.failing = false;
    } catch (e) {
      if (this.failing) return;
      this.failing = true;
      this.warn(`log: cannot write ${file} (${e.code || e.message}); going on without the log file`);
    }
  }

  // Removes bridge-<date>.log files older than keepDays dates. Returns the removed names.
  prune() {
    const n = this.now();
    const cutoff = localDate(new Date(n.getFullYear(), n.getMonth(), n.getDate() - (this.keepDays - 1)));
    const removed = [];
    let names = [];
    try { names = fs.readdirSync(this.dir); } catch { return removed; }
    for (const name of names) {
      const m = NAME.exec(name);
      if (!m || m[1] >= cutoff) continue;
      try { fs.unlinkSync(path.join(this.dir, name)); removed.push(name); } catch {}
    }
    return removed;
  }
}

// A LogFile for a (raw or resolved) config.
function fromConfig(cfg = {}, opts = {}) {
  const dir = cfg.logDir ? path.resolve(__dirname, String(cfg.logDir)) : DEFAULT_DIR;
  return new LogFile({ dir, keepDays: cfg.logKeepDays, ...opts });
}

// console.log / .info / .warn / .error print as before and also go to the log file.
function teeConsole(log, con = console) {
  for (const k of ['log', 'info', 'warn', 'error']) {
    const orig = con[k].bind(con);
    con[k] = (...args) => { orig(...args); log.write(util.format(...args)); };
  }
}

module.exports = { LogFile, fromConfig, teeConsole, localDate, localTime, DEFAULT_DIR, DEFAULT_KEEP_DAYS };
