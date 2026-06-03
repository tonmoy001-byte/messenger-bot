/**
 * utils/rag.js
 * ────────────────────────────────────────────────────────────
 * RAG (Retrieval Augmented Generation) pipeline for Cyberbot.
 * Retrieves relevant context from vector DB and injects into
 * LLM prompts for better, more accurate responses.
 * ────────────────────────────────────────────────────────────
 */

const { generateEmbedding } = require("./embeddings");
const { queryVectors, upsertVectors, deleteVectors } = require("./vectorDB");
const { KnowledgeBase } = require("../db");

/**
 * Search for relevant context given a user query.
 * @param {string} query - User's message
 * @param {string} sourceFilter - Optional: "product", "faq", "instruction"
 * @returns {Promise<string>} - Formatted context string
 */
async function retrieveContext(query, sourceFilter = null) {
  try {
    // Generate query embedding
    const queryEmbedding = await generateEmbedding(query);
    if (!queryEmbedding) return "";

    // Build filter
    const filter = sourceFilter ? { source: sourceFilter } : {};

    // Search vector DB
    const matches = await queryVectors(queryEmbedding, filter);

    if (matches.length === 0) return "";

    // Format results into context
    const contexts = matches
      .filter(m => m.score > 0.5) // Only relevant matches
      .map(m => {
        const meta = m.metadata || {};
        return `[${meta.source || "info"}] ${meta.content || ""}`;
      })
      .join("\n\n");

    return contexts;
  } catch (err) {
    console.error(" [RAG] Retrieve context error:", err.message);
    return "";
  }
}

/**
 * Index a knowledge base entry into the vector DB.
 * @param {object} entry - Knowledge base entry
 */
async function indexKnowledgeEntry(entry) {
  try {
    const embedding = await generateEmbedding(entry.content);
    if (!embedding) return { success: false, error: "Failed to generate embedding" };

    const vectors = [{
      id: `kb-${entry._id}`,
      values: embedding,
      metadata: {
        source: "knowledge",
        content: entry.content,
        title: entry.title || "",
        category: entry.category || "",
        tags: (entry.tags || []).join(", "),
        updatedAt: entry.updatedAt?.toISOString() || new Date().toISOString()
      }
    }];

    return await upsertVectors(vectors);
  } catch (err) {
    console.error(" [RAG] Index knowledge error:", err.message);
    return { success: false, error: err.message };
  }
}

/**
 * Index a product into the vector DB.
 * @param {object} product - Product document
 */
async function indexProduct(product) {
  try {
    const content = `${product.name}. ${product.description || ""}. Price: ${product.price}. Category: ${product.category}. Keywords: ${(product.keywords || []).join(", ")}.`;
    const embedding = await generateEmbedding(content);
    if (!embedding) return { success: false, error: "Failed to generate embedding" };

    const vectors = [{
      id: `product-${product._id}`,
      values: embedding,
      metadata: {
        source: "product",
        content,
        productId: product._id.toString(),
        name: product.name,
        price: product.price,
        category: product.category,
        inStock: product.inStock
      }
    }];

    return await upsertVectors(vectors);
  } catch (err) {
    console.error(" [RAG] Index product error:", err.message);
    return { success: false, error: err.message };
  }
}

/**
 * Index all products into the vector DB.
 */
async function indexAllProducts() {
  try {
    const { Product } = require("../db");
    const products = await Product.find({ isActive: true });

    let indexed = 0;
    let failed = 0;

    for (const product of products) {
      const result = await indexProduct(product);
      if (result.success) indexed++;
      else failed++;
    }

    return { success: true, indexed, failed, total: products.length };
  } catch (err) {
    console.error(" [RAG] Index all products error:", err.message);
    return { success: false, error: err.message };
  }
}

/**
 * Index all knowledge base entries.
 */
async function indexAllKnowledge() {
  try {
    const entries = await KnowledgeBase.find({ isActive: true });

    let indexed = 0;
    let failed = 0;

    for (const entry of entries) {
      const result = await indexKnowledgeEntry(entry);
      if (result.success) indexed++;
      else failed++;
    }

    return { success: true, indexed, failed, total: entries.length };
  } catch (err) {
    console.error(" [RAG] Index all knowledge error:", err.message);
    return { success: false, error: err.message };
  }
}

/**
 * Delete indexed entry from vector DB.
 */
async function unindexEntry(id, type = "kb") {
  return deleteVectors([`${type}-${id}`]);
}

/**
 * Build RAG-enhanced system prompt.
 * Injects retrieved context into the prompt.
 */
function buildRAGPrompt(basePrompt, retrievedContext) {
  if (!retrievedContext) return basePrompt;

  return `${basePrompt}

RELEVANT CONTEXT FROM KNOWLEDGE BASE:
${retrievedContext}

Use the above context to provide accurate, specific answers. If the context doesn't contain relevant information, rely on your general knowledge but mention that you're not certain.`;
}

module.exports = {
  retrieveContext,
  indexKnowledgeEntry,
  indexProduct,
  indexAllProducts,
  indexAllKnowledge,
  unindexEntry,
  buildRAGPrompt
};
