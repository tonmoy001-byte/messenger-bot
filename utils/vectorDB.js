/**
 * utils/vectorDB.js
 * ────────────────────────────────────────────────────────────
 * Pinecone vector database client for Cyberbot RAG.
 * Stores and retrieves semantic embeddings for knowledge base,
 * products, and FAQs.
 * ────────────────────────────────────────────────────────────
 */

const { Pinecone } = require("@pinecone-database/pinecone");

let pinecone = null;
let index = null;

const INDEX_NAME = process.env.PINECONE_INDEX || "cyberbot-knowledge";
const NAMESPACE = "default";
const TOP_K = 5;

/**
 * Initialize Pinecone connection.
 */
async function initPinecone() {
  if (pinecone) return index;

  const apiKey = process.env.PINECONE_API_KEY;
  if (!apiKey) {
    console.warn(" [VectorDB] PINECONE_API_KEY not set. Using in-memory fallback.");
    return null;
  }

  try {
    pinecone = new Pinecone({ apiKey });
    index = pinecone.index(INDEX_NAME);
    console.log(` [VectorDB] Connected to Pinecone index: ${INDEX_NAME}`);
    return index;
  } catch (err) {
    console.error(" [VectorDB] Pinecone connection error:", err.message);
    return null;
  }
}

/**
 * Upsert vectors into Pinecone.
 * @param {Array} vectors - [{ id, values: number[], metadata: {} }]
 */
async function upsertVectors(vectors) {
  const idx = await initPinecone();
  if (!idx) return { success: false, error: "Pinecone not initialized" };

  try {
    // Pinecone has a limit of 100 vectors per upsert request
    const batchSize = 100;
    for (let i = 0; i < vectors.length; i += batchSize) {
      const batch = vectors.slice(i, i + batchSize);
      await idx.namespace(NAMESPACE).upsert(batch);
    }
    return { success: true, count: vectors.length };
  } catch (err) {
    console.error(" [VectorDB] Upsert error:", err.message);
    return { success: false, error: err.message };
  }
}

/**
 * Query vectors by similarity.
 * @param {number[]} queryVector - The embedding to search for
 * @param {object} filter - Optional metadata filter
 * @returns {Array} - Top matching results
 */
async function queryVectors(queryVector, filter = {}) {
  const idx = await initPinecone();
  if (!idx) return [];

  try {
    const response = await idx.namespace(NAMESPACE).query({
      vector: queryVector,
      topK: TOP_K,
      includeMetadata: true,
      filter: Object.keys(filter).length > 0 ? filter : undefined
    });

    return response.matches || [];
  } catch (err) {
    console.error(" [VectorDB] Query error:", err.message);
    return [];
  }
}

/**
 * Delete vectors by ID or filter.
 */
async function deleteVectors(ids = null, filter = {}) {
  const idx = await initPinecone();
  if (!idx) return { success: false, error: "Pinecone not initialized" };

  try {
    if (ids && ids.length > 0) {
      await idx.namespace(NAMESPACE).deleteMany(ids);
    } else if (Object.keys(filter).length > 0) {
      await idx.namespace(NAMESPACE).deleteAll(filter);
    }
    return { success: true };
  } catch (err) {
    console.error(" [VectorDB] Delete error:", err.message);
    return { success: false, error: err.message };
  }
}

/**
 * Get index stats.
 */
async function getIndexStats() {
  const idx = await initPinecone();
  if (!idx) return { totalVectors: 0 };

  try {
    const stats = await idx.describeIndexStats();
    return {
      totalVectors: stats.totalRecordCount || 0,
      namespaces: stats.namespaces || {}
    };
  } catch (err) {
    return { totalVectors: 0 };
  }
}

module.exports = {
  initPinecone,
  upsertVectors,
  queryVectors,
  deleteVectors,
  getIndexStats
};
