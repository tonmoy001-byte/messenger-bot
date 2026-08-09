/**
 * utils/payments.js
 * ────────────────────────────────────────────────────────────
 * Payment gateway integration for Cyberbot.
 * Supports: Bkash, Nagad, Rocket, Cash on Delivery
 * ────────────────────────────────────────────────────────────
 */

const axios = require("axios");
const { Payment, Order } = require("../src/config/db");

// ─── BKASH INTEGRATION ─────────────────────────────────────
const BKASH_CONFIG = {
  baseURL: process.env.BKASH_BASE_URL || "https://tokenized.sandbox.bka.sh/v1.2.0-beta",
  appKey: process.env.BKASH_APP_KEY || "",
  appSecret: process.env.BKASH_APP_SECRET || "",
  username: process.env.BKASH_USERNAME || "",
  password: process.env.BKASH_PASSWORD || ""
};

let bkashToken = null;
let bkashTokenExpiry = null;

async function getBkashToken() {
  if (!BKASH_CONFIG.appKey || !BKASH_CONFIG.appSecret || !BKASH_CONFIG.username || !BKASH_CONFIG.password) {
    console.warn("⚠️ [Bkash Payment] Gateway credentials are not configured. Check BKASH_APP_KEY, BKASH_APP_SECRET, BKASH_USERNAME, BKASH_PASSWORD.");
    return null;
  }
  if (bkashToken && bkashTokenExpiry && Date.now() < bkashTokenExpiry) {
    return bkashToken;
  }
  try {
    const response = await axios.post(`${BKASH_CONFIG.baseURL}/tokenized/checkout/token/grant`, {
      app_key: BKASH_CONFIG.appKey,
      app_secret: BKASH_CONFIG.appSecret,
      username: BKASH_CONFIG.username,
      password: BKASH_CONFIG.password
    }, {
      headers: { "Content-Type": "application/json" }
    });
    bkashToken = response.data.id_token;
    bkashTokenExpiry = Date.now() + (3600 * 1000); // 1 hour
    return bkashToken;
  } catch (err) {
    console.error(" [Bkash Token Error]:", err.response?.data || err.message);
    return null;
  }
}

async function createBkashPayment(orderId, amount, callbackUrl) {
  try {
    const token = await getBkashToken();
    if (!token) return { success: false, error: "Failed to get Bkash token" };

    const order = await Order.findById(orderId);
    if (!order) return { success: false, error: "Order not found" };

    const response = await axios.post(`${BKASH_CONFIG.baseURL}/tokenized/checkout/create`, {
      mode: "0011",
      payerReference: order.uid,
      callbackURL: callbackUrl,
      amount: amount.toString(),
      currency: "BDT",
      intent: "sale",
      merchantInvoiceNumber: `INV-${orderId.toString().slice(-8)}`
    }, {
      headers: {
        "Content-Type": "application/json",
        "Authorization": token,
        "X-App-Key": BKASH_CONFIG.appKey
      }
    });

    if (response.data.statusCode === "0000") {
      await Payment.findOneAndUpdate(
        { orderId },
        {
          $set: {
            method: "bkash",
            amount,
            status: "pending",
            paymentUrl: response.data.bkashURL,
            transactionId: response.data.paymentID,
            updatedAt: new Date()
          }
        },
        { upsert: true }
      );
      return { success: true, paymentUrl: response.data.bkashURL, paymentId: response.data.paymentID };
    }
    return { success: false, error: response.data.statusMessage };
  } catch (err) {
    console.error(" [Bkash Create Error]:", err.response?.data || err.message);
    return { success: false, error: err.message };
  }
}

async function executeBkashPayment(paymentId) {
  try {
    const token = await getBkashToken();
    if (!token) return { success: false, error: "Failed to get Bkash token" };

    const response = await axios.post(`${BKASH_CONFIG.baseURL}/tokenized/checkout/execute`, {
      paymentID: paymentId
    }, {
      headers: {
        "Content-Type": "application/json",
        "Authorization": token,
        "X-App-Key": BKASH_CONFIG.appKey
      }
    });

    if (response.data.statusCode === "0000") {
      await Payment.findOneAndUpdate(
        { transactionId: paymentId },
        { $set: { status: "completed", updatedAt: new Date() } }
      );
      await Order.findOneAndUpdate(
        { _id: response.data.trxID ? { paymentTransactionId: response.data.trxID } : {} },
        { $set: { status: "confirmed", paymentStatus: "paid" } }
      );
      return { success: true, trxId: response.data.trxID };
    }
    return { success: false, error: response.data.statusMessage };
  } catch (err) {
    console.error(" [Bkash Execute Error]:", err.response?.data || err.message);
    return { success: false, error: err.message };
  }
}

// ── NAGAD INTEGRATION ─────────────────────────────────────
const NAGAD_CONFIG = {
  baseURL: process.env.NAGAD_BASE_URL || "https://sandbox.nagad.com.bd",
  merchantId: process.env.NAGAD_MERCHANT_ID || "",
  merchantNumber: process.env.NAGAD_MERCHANT_NUMBER || ""
};

async function createNagadPayment(orderId, amount, callbackUrl) {
  if (!NAGAD_CONFIG.merchantId || !NAGAD_CONFIG.merchantNumber) {
    console.warn("⚠️ [Nagad Payment] Gateway credentials are not configured. Check NAGAD_MERCHANT_ID, NAGAD_MERCHANT_NUMBER.");
    return { success: false, error: "Nagad payment gateway is not configured" };
  }
  try {
    const order = await Order.findById(orderId);
    if (!order) return { success: false, error: "Order not found" };

    const invoice = `INV-${orderId.toString().slice(-8)}`;
    const paymentUrl = `${NAGAD_CONFIG.baseURL}/web/checkout/payment?merchant_id=${NAGAD_CONFIG.merchantId}&merchant_invoice_number=${invoice}&amount=${amount}&callback_url=${encodeURIComponent(callbackUrl)}`;

    await Payment.findOneAndUpdate(
      { orderId },
      { $set: { method: "nagad", amount, status: "pending", paymentUrl, updatedAt: new Date() } },
      { upsert: true }
    );

    return { success: true, paymentUrl };
  } catch (err) {
    console.error(" [Nagad Create Error]:", err.message);
    return { success: false, error: err.message };
  }
}

// ─── CASH ON DELIVERY ──────────────────────────────────────
async function markCOD(orderId) {
  try {
    await Payment.findOneAndUpdate(
      { orderId },
      { $set: { method: "cod", status: "pending", updatedAt: new Date() } },
      { upsert: true }
    );
    return { success: true };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

module.exports = {
  createBkashPayment,
  executeBkashPayment,
  createNagadPayment,
  markCOD,
  getBkashToken
};
