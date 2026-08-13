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
const { getTenantContext } = require("./tenantContext");
const { KnowledgeBase } = require("../src/config/db");
const { formatVectorContext, formatKeywordContext } = require("./ragFormat");

/**
 * Search for relevant context given a user query.
 * @param {string} query - User's message
 * @param {string} sourceFilter - Optional: "product", "faq", "instruction"
 * @returns {Promise<string>} - Formatted context string
 */
async function retrieveContext(query, sourceFilter = null) {
  const ctx = getTenantContext();
  try {
    // Try vector search first
    const queryEmbedding = await generateEmbedding(query);
    if (queryEmbedding) {
      const filter = sourceFilter ? { source: sourceFilter } : {};
      const matches = await queryVectors(queryEmbedding, filter, ctx ? ctx.tenant_id : null);

      if (matches.length > 0) {
        const contexts = formatVectorContext(matches);
        if (contexts) return contexts;
      }
    }

    // Fallback: direct text search against Supabase knowledge base
    if (!ctx || !ctx.tenant_id) return "";

    const queryLower = query.toLowerCase();
    const keywords = queryLower.split(/\s+/).filter(w => w.length > 2);

    if (keywords.length === 0) return "";

    const { data: entries, error } = await KnowledgeBase.client
      .from("knowledge_base")
      .select("title, content, category")
      .eq("isActive", true)
      .eq("tenant_id", ctx.tenant_id);

    if (error || !entries || entries.length === 0) return "";

    // Score entries by keyword overlap
    const scored = entries.map(entry => {
      const text = `${entry.title} ${entry.content}`.toLowerCase();
      const score = keywords.filter(k => text.includes(k)).length / keywords.length;
      return { ...entry, score };
    }).filter(e => e.score > 0.2);

    if (scored.length === 0) return "";

    return formatKeywordContext(scored, sourceFilter);
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
      id: `kb-${entry.id}`,
      values: embedding,
      metadata: {
        source: "knowledge",
        content: entry.content,
        title: entry.title || "",
        category: entry.category || "",
        tags: (entry.tags || []).join(", "),
        tenant_id: entry.tenant_id || null,
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
      id: `product-${product.id}`,
      values: embedding,
      metadata: {
        source: "product",
        content,
        productId: product.id,
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
    const { Product } = require("../src/config/db");
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
