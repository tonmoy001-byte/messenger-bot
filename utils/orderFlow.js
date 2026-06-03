/**
 * utils/orderFlow.js
 * ─────────────────────────────────────────────────────────────
 * Order flow state management for AI conversations
 * Handles: detect intent → show products → collect details → create order
 * ─────────────────────────────────────────────────────────────
 */

const axios = require("axios");
const { OrderSession, EcommerceConnection, Order } = require("../db");
const { createShopifyOrder } = require("./shopify");
const { createWooOrder } = require("./woocommerce");

const FLOW_STATE = {
  IDLE: "idle",
  SHOWING_PRODUCTS: "showing_products",
  SELECTING_PRODUCT: "selecting_product",
  GETTING_QUANTITY: "getting_quantity",
  GETTING_ADDRESS: "getting_address",
  GETTING_PHONE: "getting_phone",
  CONFIRMING: "confirming"
};

async function getFlowState(uid) {
  const session = await OrderSession.findOne({ uid });
  return session ? { state: session.state, data: { selectedProduct: session.selectedProduct, quantity: session.quantity, deliveryAddress: session.deliveryAddress, phone: session.phone } } : { state: FLOW_STATE.IDLE, data: {} };
}

async function setFlowState(uid, state, data = {}) {
  await OrderSession.findOneAndUpdate({ uid }, { $set: { state, selectedProduct: data.selectedProduct || null, quantity: data.quantity || 1, deliveryAddress: data.deliveryAddress || "", phone: data.phone || "", updatedAt: new Date() } }, { upsert: true, new: true });
}

async function clearFlowState(uid) {
  await OrderSession.findOneAndUpdate({ uid }, { $set: { state: FLOW_STATE.IDLE, selectedProduct: null, quantity: 1, deliveryAddress: "", phone: "", updatedAt: new Date() } }, { upsert: true });
}

/**
 * Detect if user wants to buy something
 * Keywords that indicate purchase intent
 */
function detectPurchaseIntent(message) {
  const lowerMsg = message.toLowerCase();

  const buyKeywords = [
    "buy", "purchase", "order", "কিনতে চাই", "অর্ডার", "কেনা",
    "want to buy", "need this", "how much", "দাম", "price",
    "কোর্স", "course", "সার্ভিস", "service", "product", "পণ্য",
    "এনরোল", "enroll", "রেজিস্টার"
  ];

  const hasBuyKeyword = buyKeywords.some(keyword => lowerMsg.includes(keyword));
  return hasBuyKeyword;
}

/**
 * Fetch products from database
 */
async function getProducts(category = null) {
  try {
    const API_URL = process.env.API_URL || "http://localhost:3000";
    const url = category
      ? `${API_URL}/api/products/category/${category}`
      : `${API_URL}/api/products`;

    const response = await axios.get(url, { timeout: 10000 });
    return response.data;
  } catch (err) {
    console.error("❌ Failed to fetch products:", err.message);
    return [];
  }
}

/**
 * Create order in database
 */
async function createOrder(uid, orderData) {
  try {
    const API_URL = process.env.API_URL || "http://localhost:3000";
    const response = await axios.post(`${API_URL}/api/orders/from-ai`, {
      uid,
      customerName: orderData.customerName,
      customerPhone: orderData.customerPhone,
      items: orderData.items,
      deliveryAddress: orderData.deliveryAddress,
      notes: orderData.notes || ""
    }, { timeout: 10000 });

    // Track ad conversion if user came from an ad
    if (response.data?.order?._id) {
      const { markAdConversion } = require("./adTracking");
      await markAdConversion(uid, response.data.order._id);
    }

    return response.data;
  } catch (err) {
    console.error("❌ Failed to create order:", err.message);
    return null;
  }
}

/**
 * Process user message through order flow
 * Returns: { response, flowCompleted }
 */
async function processOrderFlow(uid, userMessage, userName) {
  const flow = await getFlowState(uid);
  const { state, data } = flow;

  console.log(` [OrderFlow] ${uid} - State: ${state}`);

  if (state === FLOW_STATE.IDLE) {
    if (detectPurchaseIntent(userMessage)) {
      const products = await getProducts();
      if (products.length === 0) {
        return { response: "Sorry, no products available right now. Please contact support.", flowCompleted: true };
      }
      await setFlowState(uid, FLOW_STATE.SHOWING_PRODUCTS, { products });
      return { response: formatProductsMessage(products).message, flowCompleted: false };
    }
    return null;
  }

  switch (state) {
    case FLOW_STATE.SHOWING_PRODUCTS: return await handleProductSelection(uid, userMessage, data.products);
    case FLOW_STATE.GETTING_QUANTITY: return await handleQuantity(uid, userMessage, data);
    case FLOW_STATE.GETTING_ADDRESS: return await handleAddress(uid, userMessage, data);
    case FLOW_STATE.GETTING_PHONE: return await handlePhone(uid, userMessage, data, userName);
    case FLOW_STATE.CONFIRMING: return await handleConfirmation(uid, userMessage, data);
    default: await clearFlowState(uid); return null;
  }
}

/**
 * Format products list for display
 */
function formatProductsMessage(products) {
  // Group by category
  const byCategory = {
    products: products.filter(p => p.category === "products"),
    courses: products.filter(p => p.category === "courses"),
    services: products.filter(p => p.category === "services")
  };

  let message = "📦 Here are our available items:\n\n";

  let num = 1;
  const allItems = [];

  if (byCategory.products.length > 0) {
    message += "🖥️ PRODUCTS:\n";
    byCategory.products.forEach(p => {
      message += `  ${num}. ${p.name} - ৳${p.price.toLocaleString()}\n`;
      allItems.push({ num: num++, ...p });
    });
    message += "\n";
  }

  if (byCategory.courses.length > 0) {
    message += "📚 COURSES:\n";
    byCategory.courses.forEach(p => {
      message += `  ${num}. ${p.name} - ৳${p.price.toLocaleString()}\n`;
      allItems.push({ num: num++, ...p });
    });
    message += "\n";
  }

  if (byCategory.services.length > 0) {
    message += "🔧 SERVICES:\n";
    byCategory.services.forEach(p => {
      message += `  ${num}. ${p.name} - ৳${p.price.toLocaleString()}\n`;
      allItems.push({ num: num++, ...p });
    });
  }

  message += "\nPlease reply with the **number** (1-" + allItems.length + ") of the item you want to order.";

  return { message, items: allItems };
}

/**
 * Handle product selection
 */
async function handleProductSelection(uid, userMessage, products) {
  const selectedNum = parseInt(userMessage.trim());

  // Get all products flattened
  const byCategory = {
    products: products.filter(p => p.category === "products"),
    courses: products.filter(p => p.category === "courses"),
    services: products.filter(p => p.category === "services")
  };

  let allItems = [];
  let num = 1;
  byCategory.products.forEach(p => allItems.push({ num: num++, ...p }));
  byCategory.courses.forEach(p => allItems.push({ num: num++, ...p }));
  byCategory.services.forEach(p => allItems.push({ num: num++, ...p }));

  const selectedItem = allItems.find(item => item.num === selectedNum);

  if (!selectedItem) {
    return {
      response: "Invalid selection. Please enter the number (1-" + allItems.length + ") of the item you want.",
      flowCompleted: false
    };
  }

  // Store selected product and move to quantity
  await setFlowState(uid, FLOW_STATE.GETTING_QUANTITY, {
    products,
    selectedProduct: selectedItem,
    items: allItems
  });

  return {
    response: `✅ You selected: *${selectedItem.name}* - ৳${selectedItem.price.toLocaleString()}\n\nHow many do you want to order?`,
    flowCompleted: false
  };
}

/**
 * Handle quantity input
 */
async function handleQuantity(uid, userMessage, data) {
  const quantity = parseInt(userMessage.trim());

  if (isNaN(quantity) || quantity < 1) {
    return {
      response: "Please enter a valid quantity (number).",
      flowCompleted: false
    };
  }

  const selectedProduct = data.selectedProduct;
  const totalPrice = selectedProduct.price * quantity;

  await setFlowState(uid, FLOW_STATE.GETTING_ADDRESS, {
    ...data,
    quantity
  });

  return {
    response: `✅ Quantity: ${quantity}\n💰 Total: ৳${totalPrice.toLocaleString()}\n\n📍 Please provide your **delivery address** (full address with city/area):`,
    flowCompleted: false
  };
}

/**
 * Handle address input
 */
async function handleAddress(uid, userMessage, data) {
  const address = userMessage.trim();

  if (address.length < 5) {
    return {
      response: "Please provide a complete delivery address.",
      flowCompleted: false
    };
  }

  await setFlowState(uid, FLOW_STATE.GETTING_PHONE, {
    ...data,
    deliveryAddress: address
  });

  return {
    response: `📍 Delivery Address: ${address}\n\n📱 Please provide your **contact phone number** for delivery confirmation:`,
    flowCompleted: false
  };
}

/**
 * Handle phone input and show confirmation
 */
async function handlePhone(uid, userMessage, data, userName) {
  let phone = userMessage.trim();

  // Clean phone number - remove any non-digit characters except +
  phone = phone.replace(/[^\d+]/g, "");

  // Basic validation - at least 10 digits
  const digitCount = phone.replace(/\+/g, "").length;
  if (digitCount < 10) {
    return {
      response: "Please provide a valid phone number (at least 10 digits).",
      flowCompleted: false
    };
  }

  // Add country code if not present
  if (!phone.startsWith("+") && !phone.startsWith("88")) {
    if (phone.startsWith("0")) {
      phone = "+88" + phone;
    } else {
      phone = "+88" + phone;
    }
  }

  const selectedProduct = data.selectedProduct;
  const quantity = data.quantity;
  const totalPrice = selectedProduct.price * quantity;

  await setFlowState(uid, FLOW_STATE.CONFIRMING, {
    ...data,
    customerPhone: phone,
    customerName: userName || "Customer"
  });

  // Show confirmation summary
  const summary = `
📋 **ORDER SUMMARY**
━━━━━━━━━━━━━━━━━━
🛒 Item: ${selectedProduct.name}
📦 Quantity: ${quantity}
💰 Price: ৳${selectedProduct.price.toLocaleString()} × ${quantity}
━━━━━━━━━━━━━━━━━━
💵 **Total: ৳${totalPrice.toLocaleString()}**

📍 Delivery: ${data.deliveryAddress}
📱 Phone: ${phone}

━━━━━━━━━━━━━━━━━━
✅ Reply with **"YES"** to confirm order
❌ Reply with **"NO"** to cancel
`;

  return {
    response: summary,
    flowCompleted: false
  };
}

/**
 * Handle order confirmation
 */
async function handleConfirmation(uid, userMessage, data) {
  const response = userMessage.toLowerCase().trim();

  if (response === "yes" || response === "confirm" || response === "হ্যাঁ" || response === "জি") {
    const selectedProduct = data.selectedProduct;
    const quantity = data.quantity;
    const totalPrice = selectedProduct.price * quantity;

    // Try to create order in connected e-commerce platform first
    let orderResult = null;
    let externalOrderId = null;

    const shopifyConn = await EcommerceConnection.findOne({ platform: "shopify", isActive: true });
    const wooConn = await EcommerceConnection.findOne({ platform: "woocommerce", isActive: true });

    if (shopifyConn) {
      const shopifyResult = await createShopifyOrder(shopifyConn.storeUrl, shopifyConn.accessToken, {
        items: [{
          name: selectedProduct.name,
          quantity,
          price: selectedProduct.price,
          shopifyVariantId: selectedProduct.shopifyData?.variants?.[0]?.id
        }],
        customerName: data.customerName,
        customerPhone: data.customerPhone,
        customerEmail: data.customerEmail || "",
        deliveryAddress: data.deliveryAddress,
        notes: `Order from Cyberbot AI via Messenger`,
        platform: "messenger",
        paymentStatus: "pending"
      });
      if (shopifyResult.success) {
        externalOrderId = shopifyResult.orderId;
        orderResult = { success: true, orderId: `SP-${shopifyResult.orderNumber}` };
      }
    }

    if (!orderResult && wooConn) {
      const wooResult = await createWooOrder(wooConn.storeUrl, wooConn.consumerKey, wooConn.consumerSecret, {
        items: [{
          name: selectedProduct.name,
          quantity,
          price: selectedProduct.price,
          wooProductId: selectedProduct.wooData?.productId
        }],
        customerName: data.customerName,
        customerPhone: data.customerPhone,
        customerEmail: data.customerEmail || "",
        deliveryAddress: data.deliveryAddress,
        notes: `Order from Cyberbot AI via chat`,
        platform: "chat",
        paymentStatus: "pending"
      });
      if (wooResult.success) {
        externalOrderId = wooResult.orderId;
        orderResult = { success: true, orderId: `WC-${wooResult.orderNumber}` };
      }
    }

    // Fallback to local order creation
    if (!orderResult) {
      orderResult = await createOrder(uid, {
        customerName: data.customerName,
        customerPhone: data.customerPhone,
        items: [{
          productId: selectedProduct._id,
          name: selectedProduct.name,
          quantity,
          price: selectedProduct.price
        }],
        deliveryAddress: data.deliveryAddress,
        notes: `Ordered via ${selectedProduct.category}`
      });
    }

    if (orderResult && orderResult.success) {
      await clearFlowState(uid);

      let platformNote = "";
      if (shopifyConn) platformNote = " (synced to Shopify)";
      else if (wooConn) platformNote = " (synced to WooCommerce)";

      return {
        response: `🎉 **Order Placed Successfully!**${platformNote}\n\n📦 Order ID: ${orderResult.orderId}\n💰 Total: ৳${totalPrice.toLocaleString()}\n\nYour order is **pending** and will be verified by our team. We will contact you at ${data.customerPhone} for confirmation.\n\nThank you for your order! 🙏`,
        flowCompleted: true
      };
    } else {
      return {
        response: "Sorry, there was an error creating your order. Please try again or contact support.",
        flowCompleted: true
      };
    }
  } else if (response === "no" || response === "cancel" || response === "না") {
    await clearFlowState(uid);
    return {
      response: "Order cancelled. No worries! If you need anything else, just let me know.",
      flowCompleted: true
    };
  } else {
    return {
      response: "Please reply with YES (confirm) or NO (cancel).",
      flowCompleted: false
    };
  }
}

/**
 * Cancel order flow manually
 */
async function cancelOrderFlow(uid) {
  await clearFlowState(uid);
}

module.exports = {
  FLOW_STATE,
  processOrderFlow,
  detectPurchaseIntent,
  getFlowState,
  cancelOrderFlow,
  getProducts
};