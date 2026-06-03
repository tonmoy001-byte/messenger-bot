/**
 * utils/shopify.js
 * ────────────────────────────────────────────────────────────
 * Shopify Admin API client for Cyberbot.
 * Handles product sync, order creation, and webhook processing.
 * ────────────────────────────────────────────────────────────
 */

const axios = require("axios");
const crypto = require("crypto");
const { Product, Order } = require("../db");

/**
 * Build Shopify API URL.
 */
function getShopifyUrl(shopDomain, endpoint) {
  return `https://${shopDomain}/admin/api/2024-01/${endpoint}`;
}

/**
 * Verify Shopify webhook HMAC signature.
 */
function verifyShopifyWebhook(body, hmac, secret) {
  const hash = crypto
    .createHmac("sha256", secret)
    .update(body, "utf8")
    .digest("base64");
  return hash === hmac;
}

/**
 * Test Shopify connection.
 */
async function testShopifyConnection(shopDomain, accessToken) {
  try {
    const url = getShopifyUrl(shopDomain, "shop.json");
    const response = await axios.get(url, {
      headers: { "X-Shopify-Access-Token": accessToken }
    });
    return { success: true, shop: response.data.shop };
  } catch (err) {
    return { success: false, error: err.response?.data?.errors || err.message };
  }
}

/**
 * Sync products from Shopify to local database.
 */
async function syncShopifyProducts(shopDomain, accessToken) {
  try {
    const products = [];
    let page = 1;
    let hasMore = true;

    while (hasMore) {
      const url = getShopifyUrl(shopDomain, `products.json?limit=250&page=${page}`);
      const response = await axios.get(url, {
        headers: { "X-Shopify-Access-Token": accessToken }
      });

      const shopifyProducts = response.data.products || [];
      if (shopifyProducts.length === 0) {
        hasMore = false;
        break;
      }

      for (const sp of shopifyProducts) {
        const variants = sp.variants || [];
        const firstVariant = variants[0] || {};

        // Generate keywords from title and tags
        const keywords = [
          ...sp.title.toLowerCase().split(/\s+/),
          ...(sp.product_type || "").toLowerCase().split(/\s+/),
          ...(sp.tags || "").split(",").map(t => t.trim().toLowerCase())
        ].filter(Boolean);

        const product = {
          name: sp.title,
          description: (sp.body_html || "").replace(/<[^>]*>/g, "").substring(0, 500),
          price: firstVariant.price ? parseFloat(firstVariant.price) : 0,
          category: sp.product_type || "products",
          image: sp.images?.[0]?.src || "",
          imageUrl: sp.images?.[0]?.src || "",
          keywords: [...new Set(keywords)],
          inStock: firstVariant.inventory_quantity !== 0,
          isActive: sp.status === "active",
          externalId: sp.id.toString(),
          externalSource: "shopify",
          shopifyData: {
            productId: sp.id,
            handle: sp.handle,
            variants: variants.map(v => ({
              id: v.id,
              title: v.title,
              price: parseFloat(v.price),
              sku: v.sku,
              inventory: v.inventory_quantity
            }))
          }
        };

        products.push(product);
      }

      page++;
    }

    // Upsert products into local database
    let created = 0;
    let updated = 0;

    for (const p of products) {
      const existing = await Product.findOne({ externalId: p.externalId, externalSource: "shopify" });
      if (existing) {
        await Product.findByIdAndUpdate(existing._id, { $set: p });
        updated++;
      } else {
        await new Product(p).save();
        created++;
      }
    }

    return { success: true, created, updated, total: products.length };
  } catch (err) {
    console.error(" [Shopify Sync Error]:", err.response?.data || err.message);
    return { success: false, error: err.message };
  }
}

/**
 * Create order in Shopify.
 */
async function createShopifyOrder(shopDomain, accessToken, orderData) {
  try {
    // Build line items from order data
    const lineItems = (orderData.items || []).map(item => ({
      variant_id: item.shopifyVariantId || null,
      title: item.name,
      quantity: item.quantity || 1,
      price: item.price ? item.price.toString() : "0"
    }));

    const shippingAddress = {
      first_name: orderData.customerName?.split(" ")[0] || "",
      last_name: orderData.customerName?.split(" ").slice(1).join(" ") || "",
      address1: orderData.deliveryAddress || "",
      phone: orderData.customerPhone || "",
      email: orderData.customerEmail || ""
    };

    const url = getShopifyUrl(shopDomain, "orders.json");
    const response = await axios.post(url, {
      order: {
        line_items: lineItems,
        shipping_address: shippingAddress,
        billing_address: shippingAddress,
        note: orderData.notes || `Order from Cyberbot AI - ${orderData.platform || "chat"}`,
        tags: "cyberbot,ai-order",
        financial_status: orderData.paymentStatus === "paid" ? "paid" : "pending",
        fulfillment_status: null
      }
    }, {
      headers: { "X-Shopify-Access-Token": accessToken }
    });

    return { success: true, orderId: response.data.order.id, orderNumber: response.data.order.order_number };
  } catch (err) {
    console.error(" [Shopify Order Error]:", err.response?.data || err.message);
    return { success: false, error: err.response?.data?.errors || err.message };
  }
}

/**
 * Get product from Shopify by handle or ID.
 */
async function getShopifyProduct(shopDomain, accessToken, identifier) {
  try {
    const url = getShopifyUrl(shopDomain, `products/${identifier}.json`);
    const response = await axios.get(url, {
      headers: { "X-Shopify-Access-Token": accessToken }
    });
    return { success: true, product: response.data.product };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

/**
 * Update inventory in Shopify.
 */
async function updateShopifyInventory(shopDomain, accessToken, inventoryItemId, quantity) {
  try {
    const url = getShopifyUrl(shopDomain, "inventory_levels/set.json");
    await axios.post(url, {
      location_id: "primary",
      inventory_item_id: inventoryItemId,
      available: quantity
    }, {
      headers: { "X-Shopify-Access-Token": accessToken }
    });
    return { success: true };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

/**
 * Get Shopify orders.
 */
async function getShopifyOrders(shopDomain, accessToken, limit = 50) {
  try {
    const url = getShopifyUrl(shopDomain, `orders.json?limit=${limit}&status=any`);
    const response = await axios.get(url, {
      headers: { "X-Shopify-Access-Token": accessToken }
    });
    return { success: true, orders: response.data.orders };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

module.exports = {
  testShopifyConnection,
  syncShopifyProducts,
  createShopifyOrder,
  getShopifyProduct,
  updateShopifyInventory,
  getShopifyOrders,
  verifyShopifyWebhook,
  getShopifyUrl
};
