/**
 * utils/embeddings.js
 * ────────────────────────────────────────────────────────────
 * Text embedding service for Cyberbot RAG.
 * Uses Google Gemini embedding model for semantic search.
 * ────────────────────────────────────────────────────────────
 */

const axios = require("axios");

const EMBEDDING_MODEL = "text-embedding-004";
const EMBEDDING_API_URL = `https://generativelanguage.googleapis.com/v1beta/models/${EMBEDDING_MODEL}:embedContent`;

/**
 * Generate embedding for a single text.
 * @param {string} text - Text to embed
 * @returns {Promise<number[]>} - Embedding vector
 */
async function generateEmbedding(text) {
  try {
    const apiKey = process.env.GOOGLE_AI_API_KEY;
    if (!apiKey) {
      console.error(" [Embeddings] GOOGLE_AI_API_KEY not set");
      return null;
    }

    const url = `${EMBEDDING_API_URL}?key=${apiKey}`;
    const response = await axios.post(url, {
      model: EMBEDDING_MODEL,
      content: {
        parts: [{ text }]
      }
    });

    return response.data.embedding.values;
  } catch (err) {
    console.error(" [Embeddings] Error:", err.response?.data || err.message);
    return null;
  }
}

/**
 * Generate embeddings for multiple texts in batch.
 * @param {string[]} texts - Array of texts to embed
 * @returns {Promise<number[][]>} - Array of embedding vectors
 */
async function generateEmbeddings(texts) {
  const embeddings = [];

  for (const text of texts) {
    const embedding = await generateEmbedding(text);
    if (embedding) {
      embeddings.push(embedding);
    } else {
      embeddings.push(null);
    }
  }

  return embeddings;
}

/**
 * Generate embedding with retry logic.
 */
async function generateEmbeddingWithRetry(text, retries = 3) {
  for (let i = 0; i < retries; i++) {
    const embedding = await generateEmbedding(text);
    if (embedding) return embedding;
    await new Promise(r => setTimeout(r, 1000 * (i + 1)));
  }
  return null;
}

module.exports = {
  generateEmbedding,
  generateEmbeddings,
  generateEmbeddingWithRetry,
  EMBEDDING_MODEL
};
