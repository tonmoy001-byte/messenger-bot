const { test } = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const { scanForDirectSupabase } = require("../scripts/check-tenant-scope");

function makeFixture(files) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "tenant-scope-"));
  for (const [rel, content] of Object.entries(files)) {
    const full = path.join(dir, rel);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, content);
  }
  return dir;
}

test("flags direct @supabase/supabase-js require outside supabaseClient.js", () => {
  const dir = makeFixture({
    "src/config/supabaseClient.js": `const { createClient } = require("@supabase/supabase-js");`,
    "src/routes/bad.js": `const { createClient } = require("@supabase/supabase-js");`,
  });
  const offenders = scanForDirectSupabase(dir);
  assert.deepStrictEqual(offenders, ["src/routes/bad.js"]);
});

test("flags createClient( calls outside supabaseClient.js", () => {
  const dir = makeFixture({
    "src/config/supabaseClient.js": `const supabase = createClient(url, key);`,
    "utils/sneaky.js": `const supabase = createClient(url, key);`,
  });
  const offenders = scanForDirectSupabase(dir);
  assert.deepStrictEqual(offenders, ["utils/sneaky.js"]);
});

test("returns empty array when only supabaseClient.js uses the client", () => {
  const dir = makeFixture({
    "src/config/supabaseClient.js": `const supabase = createClient(url, key);`,
    "src/routes/clean.js": `module.exports = {};`,
    "utils/clean.js": `module.exports = {};`,
  });
  assert.deepStrictEqual(scanForDirectSupabase(dir), []);
});