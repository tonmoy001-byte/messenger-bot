const { test } = require("node:test");
const assert = require("node:assert");
const { isWidgetOriginAllowed } = require("../src/utils/tenantResolve");

function req(origin, referer) {
  const headers = {};
  if (origin) headers["origin"] = origin;
  if (referer) headers["referer"] = referer;
  return { headers };
}

test("returns true when PUBLIC_WIDGET_ALLOWED_ORIGINS is unset (backward compatible)", () => {
  delete process.env.PUBLIC_WIDGET_ALLOWED_ORIGINS;
  assert.strictEqual(isWidgetOriginAllowed(req("https://evil.example", "https://evil.example/")), true);
  assert.strictEqual(isWidgetOriginAllowed(req(undefined, undefined)), true);
});

test("allows an Origin in the allowlist", () => {
  process.env.PUBLIC_WIDGET_ALLOWED_ORIGINS = "https://shop.example,http://localhost:3000";
  try {
    assert.strictEqual(isWidgetOriginAllowed(req("https://shop.example", undefined)), true);
    assert.strictEqual(isWidgetOriginAllowed(req(undefined, "http://localhost:3000/some/page")), true);
  } finally {
    delete process.env.PUBLIC_WIDGET_ALLOWED_ORIGINS;
  }
});

test("rejects an Origin not in the allowlist", () => {
  process.env.PUBLIC_WIDGET_ALLOWED_ORIGINS = "https://shop.example";
  try {
    assert.strictEqual(isWidgetOriginAllowed(req("https://evil.example", undefined)), false);
    assert.strictEqual(isWidgetOriginAllowed(req(undefined, "https://evil.example/attack")), false);
  } finally {
    delete process.env.PUBLIC_WIDGET_ALLOWED_ORIGINS;
  }
});

test("rejects requests with no Origin or Referer when allowlist is set", () => {
  process.env.PUBLIC_WIDGET_ALLOWED_ORIGINS = "https://shop.example";
  try {
    assert.strictEqual(isWidgetOriginAllowed(req(undefined, undefined)), false);
  } finally {
    delete process.env.PUBLIC_WIDGET_ALLOWED_ORIGINS;
  }
});

test("matching ignores scheme and trailing slash", () => {
  process.env.PUBLIC_WIDGET_ALLOWED_ORIGINS = "shop.example";
  try {
    assert.strictEqual(isWidgetOriginAllowed(req("https://shop.example", undefined)), true);
    assert.strictEqual(isWidgetOriginAllowed(req("http://shop.example/", undefined)), true);
  } finally {
    delete process.env.PUBLIC_WIDGET_ALLOWED_ORIGINS;
  }
});