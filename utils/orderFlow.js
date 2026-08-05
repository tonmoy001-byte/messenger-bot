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
  return session ? { state: session.state, data: { selectedProduct: session.selectedProduct, quantity: session.quantity, deliveryAddress: session.deliveryAddress, phone: session.phone, customerPhone: session.phone } } : { state: FLOW_STATE.IDLE, data: {} };
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
   const lowerMsg = message.toLowerCase().trim();

   // Explicit buy keywords — strong purchase signals
   const buyKeywords = [
     "buy", "purchase", "ordered", "ordering", "কিনতে চাই", "অর্ডার", "কেনা", "কিনব",
     "want to buy", "need this", "দাম", "দাম কত",
     "এনরোল", "enroll", "রেজিস্টার", "registration",
     "add to cart", "checkout", "place order", "complete order",
     "subscribe", "subscription", "sign up", "signup",
   ];

   const hasBuyKeyword = buyKeywords.some(keyword => lowerMsg.includes(keyword));
   if (hasBuyKeyword) return true;

   // Contextual purchase patterns — require purchase context words
   const contextualPatterns = [
     /\b(i\s+)?(need|want)\s+(to\s+)?(buy|order|purchase|enroll|subscribe|get)\b/,
     /\bdo\s+you\s+(sell|offer|carry)\b/,
     /\bdo\s+you\s+have\s+(the|a|an|any|it|this|that)\b/,
     /\bcan\s+i\s+(buy|order|get|purchase|enroll)\b/,
     /\bhow\s+much\s+(is|are|does)\b/,
     /\bwhat('?s| is)\s+(your\s+|the\s+)?(price|cost|rate)\b/,
     /\bprice\s+of\b/,
     /\b(i\s+)?(interested|looking)\s+to\s+(buy|order|purchase|enroll|subscribe)\b/,
   ];

   if (contextualPatterns.some(p => p.test(lowerMsg))) return true;

   // Negative patterns — these indicate the user is NOT trying to buy.
   // Evaluated last so explicit purchase signals win over broad negatives.
   const negativePatterns = [
     /\b(hi|hello|hey|how are|help|support|question|info|information|about|tell me more|who is|where is|when|why|how (?!much|to)|can you|what products|what services|what product line|product list|menu)\b/,
     /\b(thank|thanks|appreciate|great|good|nice|love|like|interesting|cool|ok|okay|sure|sounds|yes|no(?!.*buy|.*order|.*purchase))\b/,
     /\b(just (checking|asking|wondering|curious|looking|browsing|exploring|researching|comparing))\b/,
   ];
   if (negativePatterns.some(p => p.test(lowerMsg))) return false;

   return false;
 }

/**
 * Parse user intent from natural language input.
 * Returns structured intent object for order flow handlers.
 */
function parseOrderIntent(input) {
  const lower = input.toLowerCase().trim();

  // Greeting intent
  if (/\b(hi|hello|hey|sup|yo|hola)\b/.test(lower)) return { intent: "greeting" };

  // Menu/product catalog intent
  if (/\b(product|menu|catalog|show|see|browse|list|items|all)\b/.test(lower)) return { intent: "show_menu" };

  // Purchase intent (re-enter or continue order flow)
  if (/\b(buy|order|purchase|need|want|get|take)\b/.test(lower)) return { intent: "purchase" };

  // Exit/cancel intent (fuzzy matching)
  if (/\b(cancel|exit|back|stop|never\s*mind|no\s*thanks|quit|leave|go\s*back|start\s*over|abort|end|done|finish)\b/.test(lower)) return { intent: "exit" };

  // Help intent
  if (/\b(help|support|assist|guide|how|what)\b/.test(lower)) return { intent: "help" };

  // Numeric selection
  const num = parseInt(lower);
  if (!isNaN(num) && num > 0) return { intent: "selection", number: num };

  // Yes/confirm intent
  if (/\b(yes|confirm|ok|okay|sure|agree|হ্যাঁ|জি|thik|টিক)\b/.test(lower)) return { intent: "confirm" };

  // No/reject intent
  if (/\b(no|nope|nah|cancel|না|নেই)\b/.test(lower)) return { intent: "reject" };

  return { intent: "unknown" };
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
    if (response.data?.order?.id) {
      const { markAdConversion } = require("./adTracking");
      await markAdConversion(uid, response.data.order.id);
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
  const session = await OrderSession.findOne({ uid });
  const flow = session ? { state: session.state, data: { selectedProduct: session.selectedProduct, quantity: session.quantity, deliveryAddress: session.deliveryAddress, phone: session.phone, customerPhone: session.phone } } : { state: FLOW_STATE.IDLE, data: {} };
  const { state, data } = flow;

  console.log(` [OrderFlow] ${uid} - State: ${state}`);

  // Auto-expire stale sessions (older than 30 minutes)
  if (state !== FLOW_STATE.IDLE && session && session.updatedAt) {
    const age = Date.now() - new Date(session.updatedAt).getTime();
    if (age > 30 * 60 * 1000) {
      await clearFlowState(uid);
      // Fall through to normal AI handling below
    }
  }

  // Allow users to cancel/exit the order flow with common phrases (fuzzy match)
  const lowerMsg = userMessage.toLowerCase().trim();
  const exitPatterns = /\b(cancel|exit|back|stop|never\s*mind|no\s*thanks|quit|leave|go\s*back|start\s*over|abort|end|done|help|menu)\b/;
  if (state !== FLOW_STATE.IDLE && exitPatterns.test(lowerMsg)) {
    await clearFlowState(uid);
    return null; // Let normal AI handle it
  }

  if (state === FLOW_STATE.IDLE) {
    if (detectPurchaseIntent(userMessage)) {
      const products = await getProducts();
      if (products.length === 0) {
        return { response: "Sorry, no products available right now. Please contact support.", flowCompleted: true };
      }
      await setFlowState(uid, FLOW_STATE.SHOWING_PRODUCTS);
      return { response: formatProductsMessage(products).message, flowCompleted: false };
    }
    return null;
  }

  // Re-fetch products every time (products column doesn't exist in order_sessions table)
  const products = await getProducts();

  switch (state) {
    case FLOW_STATE.SHOWING_PRODUCTS: return await handleProductSelection(uid, userMessage, products);
    case FLOW_STATE.GETTING_QUANTITY: return await handleQuantity(uid, userMessage, { ...data, products });
    case FLOW_STATE.GETTING_ADDRESS: return await handleAddress(uid, userMessage, { ...data, products });
    case FLOW_STATE.GETTING_PHONE: return await handlePhone(uid, userMessage, { ...data, products }, userName);
    case FLOW_STATE.CONFIRMING: return await handleConfirmation(uid, userMessage, { ...data, products });
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
  const intent = parseOrderIntent(userMessage);

  // Handle exit intent
  if (intent.intent === "exit") {
    await clearFlowState(uid);
    return null;
  }

  // Handle greeting - be helpful
  if (intent.intent === "greeting") {
    return {
      response: "Hi there! 👋 Please select a product from the list above by typing its number (1-" + products.length + "), or type 'cancel' to exit ordering.",
      flowCompleted: false
    };
  }

  // Handle menu request - re-show products
  if (intent.intent === "show_menu") {
    const { message } = formatProductsMessage(products);
    return { response: message, flowCompleted: false };
  }

  // Handle help
  if (intent.intent === "help") {
    return {
      response: "Here's how to order:\n• Type a **number** (1-" + products.length + ") to select a product\n• Type 'menu' to see all products\n• Type 'cancel' to exit ordering\n\nWhat would you like to do?",
      flowCompleted: false
    };
  }

  // Handle numeric selection
  if (intent.intent === "selection") {
    const selectedNum = intent.number;

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
        response: "Invalid selection. Please enter a number between 1 and " + allItems.length + ".\n\nOr type 'menu' to see the product list again, or 'cancel' to exit.",
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
      response: `✅ You selected: *${selectedItem.name}* - ৳${selectedItem.price.toLocaleString()}\n\nHow many do you want to order? (Enter a number)`,
      flowCompleted: false
    };
  }

  // Handle purchase intent - re-show menu
  if (intent.intent === "purchase") {
    const { message } = formatProductsMessage(products);
    return { response: "Sure! Here are our products:\n\n" + message, flowCompleted: false };
  }

  // Unknown intent - helpful fallback
  return {
    response: "I didn't quite understand that. Please:\n• Type a **number** (1-" + products.length + ") to select a product\n• Type 'menu' to see all products\n• Type 'cancel' to exit ordering",
    flowCompleted: false
  };
}

/**
 * Handle quantity input
 */
async function handleQuantity(uid, userMessage, data) {
  const intent = parseOrderIntent(userMessage);

  // Handle exit
  if (intent.intent === "exit") {
    await clearFlowState(uid);
    return null;
  }

  // Handle help
  if (intent.intent === "help") {
    return {
      response: `Please enter how many of *${data.selectedProduct?.name || "this item"}* you want.\nExample: "2" or "3"\n\nType 'cancel' to exit ordering.`,
      flowCompleted: false
    };
  }

  // Handle numeric quantity
  if (intent.intent === "selection") {
    const quantity = intent.number;

    if (quantity > 100) {
      return {
        response: "That's a large quantity! Please enter a number between 1 and 100, or contact support for bulk orders.",
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

  // Non-numeric input - helpful message
  return {
    response: `Please enter a quantity (number) for *${data.selectedProduct?.name || "this item"}*.\nExample: "1", "2", or "3"\n\nType 'cancel' to exit ordering.`,
    flowCompleted: false
  };
}

/**
 * Handle address input
 */
async function handleAddress(uid, userMessage, data) {
  const intent = parseOrderIntent(userMessage);

  // Handle exit
  if (intent.intent === "exit") {
    await clearFlowState(uid);
    return null;
  }

  // Handle help
  if (intent.intent === "help") {
    return {
      response: "Please provide your full delivery address including area/city.\nExample: '123 Main St, Dhaka 1205'\n\nType 'cancel' to exit ordering.",
      flowCompleted: false
    };
  }

  const address = userMessage.trim();

  if (address.length < 5) {
    return {
      response: "Please provide a complete delivery address (at least 5 characters).\nExample: '123 Main St, Dhaka 1205'\n\nType 'cancel' to exit ordering.",
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
  const intent = parseOrderIntent(userMessage);

  // Handle exit
  if (intent.intent === "exit") {
    await clearFlowState(uid);
    return null;
  }

  // Handle help
  if (intent.intent === "help") {
    return {
      response: "Please provide a valid Bangladeshi phone number (10+ digits).\nExamples: 01712345678 or +8801712345678\n\nType 'cancel' to exit ordering.",
      flowCompleted: false
    };
  }

  let phone = userMessage.trim();

  // Clean phone number - remove any non-digit characters except +
  phone = phone.replace(/[^\d+]/g, "");

  // Basic validation - at least 10 digits
  const digitCount = phone.replace(/\+/g, "").length;
  if (digitCount < 10) {
    return {
      response: "Please provide a valid phone number with at least 10 digits.\nExample: 01712345678 or +8801712345678\n\nType 'cancel' to exit ordering.",
      flowCompleted: false
    };
  }

  // Add country code if not present
  if (!phone.startsWith("+")) {
    if (phone.startsWith("88")) {
      phone = "+" + phone; // 8801712345678 → +8801712345678
    } else if (phone.startsWith("0")) {
      phone = "+88" + phone; // 01712345678 → +8801712345678
    } else {
      phone = "+880" + phone; // 1712345678 → +8801712345678
    }
  }

  const selectedProduct = data.selectedProduct;
  const quantity = data.quantity;
  const totalPrice = selectedProduct.price * quantity;

  await setFlowState(uid, FLOW_STATE.CONFIRMING, {
    ...data,
    phone: phone,
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
  const intent = parseOrderIntent(userMessage);

  // Handle confirm intent
  if (intent.intent === "confirm" || userMessage.toLowerCase().trim() === "yes" || userMessage.toLowerCase().trim() === "confirm") {
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
          productId: selectedProduct.id,
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
  } else if (intent.intent === "reject" || intent.intent === "exit" || userMessage.toLowerCase().trim() === "no" || userMessage.toLowerCase().trim() === "cancel") {
    await clearFlowState(uid);
    return {
      response: "Order cancelled. No worries! If you need anything else, just let me know.",
      flowCompleted: true
    };
  } else {
    return {
      response: "Please reply with **YES** to confirm your order, or **NO** to cancel.\n\nType 'cancel' to exit ordering.",
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