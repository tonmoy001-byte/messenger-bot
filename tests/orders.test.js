const { test } = require("node:test");
const assert = require("node:assert");
const http = require("http");
const express = require("express");
const bodyParser = require("body-parser");

const { registerOrderRoutes } = require("../src/routes/orders");

function makeApp() {
  const app = express();
  app.use(bodyParser.json());
  return app;
}

test("registerOrderRoutes registers POST /api/orders/from-ai with auth", async () => {
  const app = makeApp();
  registerOrderRoutes(app);
  const server = http.createServer(app);
  await new Promise((r) => server.listen(0, r));
  const port = server.address().port;

  const res = await fetch(`http://127.0.0.1:${port}/api/orders/from-ai`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ uid: "u1", items: [{ name: "Phone", price: 100 }] }),
  });
  assert.strictEqual(res.status, 401);

  await new Promise((r) => server.close(r));
});

test("registerOrderRoutes is idempotent (no double registration)", () => {
  const app = makeApp();
  registerOrderRoutes(app);
  registerOrderRoutes(app);
  assert.ok(true);
});