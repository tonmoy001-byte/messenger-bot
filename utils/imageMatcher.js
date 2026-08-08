/**
 * utils/imageMatcher.js
 * ────────────────────────────────────────────────────────────
 * Image-to-Product Matching for Cyberbot.
 * Takes AI-detected items from an image and matches them to the product catalog.
 * ────────────────────────────────────────────────────────────
 */

const { Product } = require("../src/config/db");

/**
 * Match detected items from an image to products in the catalog.
 * @param {string[]} detectedItems - Items detected by AI vision model
 * @returns {Promise<{matched: Array, suggestions: Array}>}
 */
async function matchProducts(detectedItems) {
  try {
    const products = await Product.find({ isActive: true });
    if (!products.length) return { matched: [], suggestions: [] };

    const matched = [];
    const suggestions = [];

    for (const item of detectedItems) {
      const itemLower = item.toLowerCase().trim();
      
      // Find exact or close matches
      for (const product of products) {
        const nameLower = product.name.toLowerCase();
        const descLower = (product.description || "").toLowerCase();
        const keywords = (product.keywords || []).map(k => k.toLowerCase());
        
        // Check for keyword match
        const keywordMatch = keywords.some(k => itemLower.includes(k) || k.includes(itemLower));
        
        // Check for name similarity
        const nameMatch = nameLower.includes(itemLower) || itemLower.includes(nameLower);
        
        // Check description match
        const descMatch = descLower.includes(itemLower);
        
        if (keywordMatch || nameMatch || descMatch) {
          if (!matched.find(m => m.id === product.id)) {
            matched.push({
              id: product.id,
              name: product.name,
              price: product.price,
              category: product.category,
              description: product.description,
              imageUrl: product.imageUrl,
              inStock: product.inStock,
              matchReason: keywordMatch ? "keyword" : nameMatch ? "name" : "description"
            });
          }
        }
      }
    }

    // If no exact matches, suggest top products from relevant categories
    if (matched.length === 0 && detectedItems.length > 0) {
      const firstItem = detectedItems[0].toLowerCase();
      const categoryMap = {
        laptop: "products", computer: "products", mouse: "products", keyboard: "products",
        monitor: "products", phone: "products", tablet: "products", headphone: "products",
        charger: "products", cable: "products", ram: "products", ssd: "products",
        web: "courses", design: "courses", marketing: "courses", development: "courses",
        repair: "services", hosting: "services", seo: "services", pos: "services"
      };
      
      for (const [keyword, category] of Object.entries(categoryMap)) {
        if (firstItem.includes(keyword)) {
          const categoryProducts = products.filter(p => p.category === category).slice(0, 3);
          suggestions.push(...categoryProducts.map(p => ({
            id: p.id,
            name: p.name,
            price: p.price,
            category: p.category,
            description: p.description,
            imageUrl: p.imageUrl,
            inStock: p.inStock
          })));
          break;
        }
      }
    }

    return { matched, suggestions };
  } catch (err) {
    console.error(" [ImageMatcher Error]:", err.message);
    return { matched: [], suggestions: [] };
  }
}

/**
 * Build a response message for matched products.
 */
function buildMatchResponse(matched, suggestions) {
  if (matched.length > 0) {
    let msg = "I found these products matching your image:\n\n";
    matched.forEach((p, i) => {
      msg += `${i + 1}. *${p.name}* - ৳${p.price.toLocaleString()}\n`;
      if (p.description) msg += `   ${p.description}\n`;
      msg += `   Stock: ${p.inStock ? "Available" : "Out of stock"}\n\n`;
    });
    msg += "\nWould you like to order any of these? Reply with the number!";
    return msg;
  }

  if (suggestions.length > 0) {
    let msg = "I couldn't find an exact match, but here are some related products:\n\n";
    suggestions.forEach((p, i) => {
      msg += `${i + 1}. *${p.name}* - ৳${p.price.toLocaleString()}\n`;
    });
    msg += "\nWould you like to order any of these? Reply with the number!";
    return msg;
  }

  return "I couldn't find matching products in our catalog. Would you like to browse our available products?";
}

module.exports = { matchProducts, buildMatchResponse };
