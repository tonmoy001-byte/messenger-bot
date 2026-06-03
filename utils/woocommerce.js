/**
 * utils/woocommerce.js
 * ────────────────────────────────────────────────────────────
 * WooCommerce REST API client for Cyberbot.
 * Handles product sync, order creation, and webhook processing.
 * ────────────────────────────────────────────────────────────
 */

const axios = require("axios");
const crypto = require("crypto");
const { Product, Order } = require("../db");

/**
 * Build WooCommerce API URL.
 */
function getWooUrl(storeUrl, endpoint) {
  const cleanUrl = storeUrl.replace(/\/+$/, "");
  return `${cleanUrl}/wp-json/wc/v3/${endpoint}`;
}

/**
 * Build auth headers for WooCommerce REST API.
 */
function getWooAuthHeaders(consumerKey, consumerSecret) {
  return {
    "Content-Type": "application/json"
  };
}

/**
 * Build authenticated request config.
 */
function getWooConfig(storeUrl, consumerKey, consumerSecret) {
  return {
    baseURL: getWooUrl(storeUrl, ""),
    auth: {
      username: consumerKey,
      password: consumerSecret
    },
    headers: { "Content-Type": "application/json" }
  };
}

/**
 * Test WooCommerce connection.
 */
async function testWooConnection(storeUrl, consumerKey, consumerSecret) {
  try {
    const config = getWooConfig(storeUrl, consumerKey, consumerSecret);
    const response = await axios.get("system_status", config);
    return { success: true, store: { name: response.data.site.name, url: storeUrl } };
  } catch (err) {
    return { success: false, error: err.response?.data?.message || err.message };
  }
}

/**
 * Sync products from WooCommerce to local database.
 */
async function syncWooProducts(storeUrl, consumerKey, consumerSecret) {
  try {
    const config = getWooConfig(storeUrl, consumerKey, consumerSecret);
    const products = [];
    let page = 1;
    let hasMore = true;

    while (hasMore) {
      const response = await axios.get(`products?per_page=100&page=${page}`, config);
      const wooProducts = response.data || [];

      if (wooProducts.length === 0) {
        hasMore = false;
        break;
      }

      for (const wp of wooProducts) {
        const keywords = [
          ...wp.name.toLowerCase().split(/\s+/),
          ...(wp.categories || []).map(c => c.name.toLowerCase()),
          ...(wp.tags || []).map(t => t.name.toLowerCase())
        ].filter(Boolean);

        const product = {
          name: wp.name,
          description: (wp.description || wp.short_description || "").replace(/<[^>]*>/g, "").substring(0, 500),
          price: parseFloat(wp.price) || 0,
          category: wp.categories?.[0]?.name || "products",
          image: wp.images?.[0]?.src || "",
          imageUrl: wp.images?.[0]?.src || "",
          keywords: [...new Set(keywords)],
          inStock: wp.in_stock !== false,
          isActive: wp.status === "publish",
          externalId: wp.id.toString(),
          externalSource: "woocommerce",
          wooData: {
            productId: wp.id,
            slug: wp.slug,
            type: wp.type,
            sku: wp.sku,
            stock: wp.stock_quantity,
            categories: wp.categories || [],
            images: wp.images || []
          }
        };

        products.push(product);
      }

      page++;
    }

    let created = 0;
    let updated = 0;

    for (const p of products) {
      const existing = await Product.findOne({ externalId: p.externalId, externalSource: "woocommerce" });
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
    console.error(" [WooCommerce Sync Error]:", err.response?.data || err.message);
    return { success: false, error: err.message };
  }
}

/**
 * Create order in WooCommerce.
 */
async function createWooOrder(storeUrl, consumerKey, consumerSecret, orderData) {
  try {
    const config = getWooConfig(storeUrl, consumerKey, consumerSecret);

    const lineItems = (orderData.items || []).map(item => ({
      product_id: item.wooProductId || null,
      variation_id: item.wooVariationId || null,
      name: item.name,
      quantity: item.quantity || 1,
      price: item.price ? item.price.toString() : "0"
    }));

    const nameParts = (orderData.customerName || "").split(" ");
    const shipping = {
      first_name: nameParts[0] || "",
      last_name: nameParts.slice(1).join(" ") || "",
      address_1: orderData.deliveryAddress || "",
      phone: orderData.customerPhone || "",
      email: orderData.customerEmail || ""
    };

    const response = await axios.post("orders", {
      line_items: lineItems,
      shipping: shipping,
      billing: shipping,
      customer_note: orderData.notes || `Order from Cyberbot AI - ${orderData.platform || "chat"}`,
      status: "pending",
      set_paid: orderData.paymentStatus === "paid"
    }, config);

    return { success: true, orderId: response.data.id, orderNumber: response.data.number };
  } catch (err) {
    console.error(" [WooCommerce Order Error]:", err.response?.data || err.message);
    return { success: false, error: err.response?.data?.message || err.message };
  }
}

/**
 * Get product from WooCommerce.
 */
async function getWooProduct(storeUrl, consumerKey, consumerSecret, productId) {
  try {
    const config = getWooConfig(storeUrl, consumerKey, consumerSecret);
    const response = await axios.get(`products/${productId}`, config);
    return { success: true, product: response.data };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

/**
 * Update stock in WooCommerce.
 */
async function updateWooStock(storeUrl, consumerKey, consumerSecret, productId, stock) {
  try {
    const config = getWooConfig(storeUrl, consumerKey, consumerSecret);
    await axios.put(`products/${productId}`, { stock_quantity: stock, manage_stock: true }, config);
    return { success: true };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

/**
 * Get WooCommerce orders.
 */
async function getWooOrders(storeUrl, consumerKey, consumerSecret, limit = 50) {
  try {
    const config = getWooConfig(storeUrl, consumerKey, consumerSecret);
    const response = await axios.get(`orders?per_page=${limit}`, config);
    return { success: true, orders: response.data };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

/**
 * Verify WooCommerce webhook signature.
 */
function verifyWooWebhook(body, signature, secret) {
  const hash = crypto
    .createHmac("sha256", secret)
    .update(body, "utf8")
    .digest("base64");
  return hash === signature;
}

module.exports = {
  testWooConnection,
  syncWooProducts,
  createWooOrder,
  getWooProduct,
  updateWooStock,
  getWooOrders,
  verifyWooWebhook,
  getWooUrl
};
