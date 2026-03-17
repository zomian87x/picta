'use strict';

const fs = require('fs');
const path = require('path');

class Logger {
  constructor(logDir) {
    this.logDir = logDir;
    this.logFile = path.join(logDir, 'picta.log');
    this.maxSize = 5 * 1024 * 1024; // 5MB
    if (!fs.existsSync(logDir)) {
      fs.mkdirSync(logDir, { recursive: true });
    }
  }

  _rotate() {
    try {
      const stat = fs.statSync(this.logFile);
      if (stat.size > this.maxSize) {
        const old = this.logFile + '.old';
        if (fs.existsSync(old)) fs.unlinkSync(old);
        fs.renameSync(this.logFile, old);
      }
    } catch {
      // File doesn't exist yet — nothing to rotate
    }
  }

  log(level, message, meta = {}) {
    this._rotate();
    const entry = JSON.stringify({
      t: new Date().toISOString(),
      level,
      msg: message,
      ...meta,
    });
    try {
      fs.appendFileSync(this.logFile, entry + '\n');
    } catch {
      // Best-effort logging — don't crash the app
    }
  }

  info(msg, meta) { this.log('info', msg, meta); }
  warn(msg, meta) { this.log('warn', msg, meta); }
  error(msg, meta) { this.log('error', msg, meta); }
}

module.exports = { Logger };
