// tests/rag.test.js
const { test } = require("node:test");
const assert = require("node:assert");
const { formatVectorContext, formatKeywordContext } = require("../utils/ragFormat");

test("formatVectorContext renders [source] title: content", () => {
  const out = formatVectorContext([{ score: 0.8, metadata: { source: "knowledge", title: "Pricing", content: "Plans start at $10" } }]);
  assert.match(out, /\[knowledge\]/);
  assert.match(out, /Pricing/);
  assert.match(out, /Plans start at \$10/);
});

test("formatVectorContext filters out low-score matches", () => {
  const out = formatVectorContext([
    { score: 0.8, metadata: { source: "knowledge", content: "Keep me" } },
    { score: 0.3, metadata: { source: "knowledge", content: "Drop me" } },
  ]);
  assert.match(out, /Keep me/);
  assert.doesNotMatch(out, /Drop me/);
});

test("formatKeywordContext filters by source and renders [category] title: content", () => {
  const entries = [
    { title: "Pricing", content: "Plans start at $10", category: "faq", score: 0.5 },
    { title: "Product X", content: "The phone", category: "product", score: 0.8 },
  ];
  const out = formatKeywordContext(entries, "faq");
  assert.match(out, /\[faq\]/);
  assert.doesNotMatch(out, /Product X/);
});

test("formatKeywordContext without filter returns all sorted by score, capped at 3", () => {
  const entries = [
    { title: "A", content: "1", category: "faq", score: 0.2 },
    { title: "B", content: "2", category: "faq", score: 0.9 },
    { title: "C", content: "3", category: "product", score: 0.5 },
    { title: "D", content: "4", category: "faq", score: 0.4 },
  ];
  const out = formatKeywordContext(entries, null);
  const lines = out.split("\n\n").filter(Boolean);
  assert.strictEqual(lines.length, 3);
  assert.match(lines[0], /\[faq\] B/);
});

test("formatKeywordContext falls back to unfiltered best-effort when sourceFilter matches nothing", () => {
  const entries = [
    { title: "A", content: "1", category: "faq", score: 0.8 },
    { title: "B", content: "2", category: "faq", score: 0.2 },
  ];
  const out = formatKeywordContext(entries, "product");
  assert.match(out, /\[faq\] A/);
});

test("formatKeywordContext does not mutate its input", () => {
  const entries = [
    { title: "A", content: "1", category: "faq", score: 0.2 },
    { title: "B", content: "2", category: "faq", score: 0.9 },
  ];
  const snapshot = entries.map(e => ({ ...e }));
  formatKeywordContext(entries, null);
  assert.deepStrictEqual(entries, snapshot);
});
