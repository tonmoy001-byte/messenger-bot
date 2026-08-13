#!/usr/bin/env node
/**
 * scripts/route-audit.js
 * Route-map equality check for the Phase 2 monolith split.
 *   node scripts/route-audit.js snapshot   # scan index.js + src/routes/*.js -> scripts/route-snapshot.json
 *   node scripts/route-audit.js diff       # scan again, compare multiset to snapshot, exit 1 on mismatch
 */
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const SNAPSHOT_PATH = path.join(__dirname, "route-snapshot.json");
const ROUTES_DIR = path.join(ROOT, "src", "routes");
const INDEX_PATH = path.join(ROOT, "index.js");

const METHOD_RE = /app\.(get|post|put|patch|delete)\(\s*["'`]([^"'`]+)["'`]/g;

function scan() {
  const routes = [];
  const files = [
    INDEX_PATH,
    ...fs.readdirSync(ROUTES_DIR)
      .filter((f) => f.endsWith(".js"))
      .map((f) => path.join(ROUTES_DIR, f)),
  ];
  for (const file of files) {
    if (!fs.existsSync(file)) continue;
    const src = fs.readFileSync(file, "utf8");
    let m;
    while ((m = METHOD_RE.exec(src)) !== null) {
      routes.push(`${m[1].toUpperCase()} ${m[2]}`);
    }
  }
  return routes.sort();
}

function main() {
  const mode = process.argv[2] || "diff";
  if (mode === "snapshot") {
    fs.writeFileSync(SNAPSHOT_PATH, JSON.stringify(scan(), null, 2));
    console.log(`Route snapshot written: ${SNAPSHOT_PATH}`);
    return;
  }
  if (mode === "diff") {
    const before = JSON.parse(fs.readFileSync(SNAPSHOT_PATH, "utf8"));
    const after = scan();
    const count = (arr) => arr.reduce((acc, r) => { acc[r] = (acc[r] || 0) + 1; return acc; }, {});
    const b = count(before);
    const a = count(after);
    const keys = new Set([...Object.keys(b), ...Object.keys(a)]);
    const problems = [];
    for (const k of keys) {
      if ((b[k] || 0) !== (a[k] || 0)) {
        problems.push(`  ${k}: snapshot=${b[k] || 0} now=${a[k] || 0}`);
      }
    }
    if (problems.length === 0) {
      console.log(`Route audit OK: ${after.length} routes match snapshot.`);
      return;
    }
    console.error("Route audit MISMATCH:");
    problems.forEach((p) => console.error(p));
    process.exit(1);
  }
  console.error(`Unknown mode: ${mode} (use snapshot|diff)`);
  process.exit(1);
}

main();