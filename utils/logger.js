/**
 * utils/logger.js
 * Minimal structured logger (JSON lines to stdout) with levels.
 */
const LEVELS = { debug: 10, info: 20, warn: 30, error: 40 };

function log(level, message, meta = {}) {
  const entry = {
    ts: new Date().toISOString(),
    level,
    message,
    ...meta,
  };
  const line = JSON.stringify(entry);
  if (level === "error" || level === "warn") process.stderr.write(line + "\n");
  else process.stdout.write(line + "\n");
}

const logger = {
  debug: (m, meta) => log("debug", m, meta),
  info: (m, meta) => log("info", m, meta),
  warn: (m, meta) => log("warn", m, meta),
  error: (m, meta) => log("error", m, meta),
};

module.exports = logger;
