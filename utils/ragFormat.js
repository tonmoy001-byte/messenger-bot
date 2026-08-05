/**
 * utils/ragFormat.js
 * Shared context formatting so vector and keyword retrieval
 * produce the same [source] shape for the LLM prompt.
 */
function formatVectorContext(matches, scoreThreshold = 0.5) {
  return matches
    .filter(m => m.score > scoreThreshold)
    .map(m => {
      const meta = m.metadata || {};
      return `[${meta.source || "info"}] ${meta.title ? `${meta.title}: ` : ""}${meta.content || ""}`;
    })
    .join("\n\n");
}

function formatKeywordContext(entries, sourceFilter, limit = 3) {
  const filtered = sourceFilter ? entries.filter(e => e.category === sourceFilter) : entries;
  const pool = filtered.length > 0 ? filtered : entries;
  return [...pool]
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map(e => `[${e.category || "knowledge"}] ${e.title}: ${e.content}`)
    .join("\n\n");
}

module.exports = { formatVectorContext, formatKeywordContext };
