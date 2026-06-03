/**
 * db.js
 * ─────────────────────────────────────────────────────────────
 * Connection logic and Mongoose schemas for MongoDB.
 * ─────────────────────────────────────────────────────────────
 */

const mongoose = require("mongoose");
const dns = require("dns");
const path = require("path");

// Load dotenv first, before any modules that need env vars
require("dotenv").config({ path: path.join(__dirname, ".env") });

// 🚀 Fix for querySrv ECONNREFUSED: Bypass local DNS and use Google DNS
dns.setServers(["8.8.8.8", "8.8.4.4"]);

const MONGODB_URI = process.env.MONGODB_URI;

/**
 * CONNECT TO DATABASE
 */
async function connectDB() {
  try {
    if (mongoose.connection.readyState >= 1) return;
    
    await mongoose.connect(MONGODB_URI);
    console.log("✅ MongoDB Connected Successfully!");
  } catch (error) {
    console.error("❌ MongoDB Connection Error:", error.message);
    // process.exit(1); // Optional: Stop server if DB fails
  }
}

/**
 * USER SCHEMA
 * Stores customer details and metadata.
 */
const UserSchema = new mongoose.Schema({
  uid: { type: String, required: true, unique: true }, // senderId
  name: { type: String, default: "Customer" },
  platform: { type: String, enum: ["messenger", "whatsapp", "web", "instagram"], default: "web" },
  email: { type: String },
  phone: { type: String },
  address: { type: String },
  profilePic: { type: String },
  firstSeen: { type: Date, default: Date.now },
  lastSeen: { type: Date, default: Date.now },
  metadata: { type: Object, default: {} }
});

const User = mongoose.model("User", UserSchema);

/**
 * ADMIN SCHEMA
 */
const AdminSchema = new mongoose.Schema({
  username: { type: String, required: true, unique: true },
  password: { type: String, required: true },
  role: { type: String, default: "superadmin" }
});

const Admin = mongoose.model("Admin", AdminSchema);

/**
 * ORDER SCHEMA
 */
const OrderSchema = new mongoose.Schema({
  orderId: { type: String, unique: true },
  uid: { type: String, required: true, index: true },
  customerName: { type: String },
  customerPhone: { type: String },
  items: [
    {
      productId: { type: String },
      name: { type: String },
      quantity: { type: Number },
      price: { type: Number }
    }
  ],
  totalAmount: { type: Number, default: 0 },
  status: { type: String, enum: ["pending", "confirmed", "shipped", "delivered", "cancelled"], default: "pending" },
  deliveryAddress: { type: String, default: "" },
  notes: { type: String, default: "" },
  timestamp: { type: Date, default: Date.now }
});

const Order = mongoose.model("Order", OrderSchema);

/**
 * PRODUCT SCHEMA
 * Store products for ordering system
 */
const ProductSchema = new mongoose.Schema({
  name: { type: String, required: true },
  description: { type: String, default: "" },
  price: { type: Number, required: true },
  category: { type: String, enum: ["products", "courses", "services"], default: "products" },
  image: { type: String, default: "" },
  imageUrl: { type: String, default: "" },
  keywords: { type: [String], default: [] },
  inStock: { type: Boolean, default: true },
  isActive: { type: Boolean, default: true },
  externalId: { type: String, default: "" }, // Shopify/WooCommerce product ID
  externalSource: { type: String, enum: ["", "shopify", "woocommerce"], default: "" },
  shopifyData: { type: Object, default: {} },
  wooData: { type: Object, default: {} },
  createdAt: { type: Date, default: Date.now }
});

// Index for category filtering
ProductSchema.index({ category: 1, isActive: 1 });

const Product = mongoose.model("Product", ProductSchema);

/**
 * MESSAGE SCHEMA
 * Stores conversation history.
 * Auto-expires after 30 days to prevent unbounded growth.
 */
const MessageSchema = new mongoose.Schema({
  uid: { type: String, required: true, index: true }, // senderId
  role: { type: String, enum: ["user", "model"], required: true },
  content: { type: String, required: true },
  timestamp: { type: Date, default: Date.now },
  mediaUrl: { type: String } // Optional: Store media links if needed
});

// TTL index - automatically delete messages after 30 days (2592000 seconds)
MessageSchema.index({ timestamp: 1 }, { expireAfterSeconds: 2592000 });

const Message = mongoose.model("Message", MessageSchema);

/**
 * SETTINGS SCHEMA
 * Application configuration overrides and AI behaviors.
 */
const SettingsSchema = new mongoose.Schema({
  configId: { type: String, default: "global", unique: true },
  messengerApiKey: { type: String, default: "" },
  whatsappApiKey: { type: String, default: "" },
  whatsappPhoneNumberId: { type: String, default: "" },
  whatsappBusinessAccountId: { type: String, default: "" },
  autoReply: { type: Boolean, default: true },
  businessName: { type: String, default: "Your Business" },
  contactEmail: { type: String, default: "admin@cyberbot.com" },
  contactPhone: { type: String, default: "" },
  timezone: { type: String, default: "UTC" },
  baseUrl: { type: String, default: "" },
  primaryModel: { type: String, default: "gemini-2.5-flash" },
  customInstructions: { type: String, default: "" },
  tone: { type: String, enum: ["professional", "friendly", "casual", "formal"], default: "professional" },
  language: { type: String, default: "auto" }
});

const Settings = mongoose.model("Settings", SettingsSchema);

/**
 * INTEGRATION SCHEMA
 * Stores connected social accounts (Facebook, Instagram, WhatsApp)
 */
const IntegrationSchema = new mongoose.Schema({
  type: { type: String, enum: ["facebook", "instagram", "whatsapp"], required: true },
  externalId: { type: String, required: true, unique: true }, // Page ID, IG ID, or WABA ID
  name: { type: String, required: true },
  accessToken: { type: String, required: true }, // Encrypted
  isActive: { type: Boolean, default: true },
  connectedAt: { type: Date, default: Date.now },
  metadata: { type: Object, default: {} } // Stores category, page_pic, etc.
});

const Integration = mongoose.model("Integration", IntegrationSchema);

/**
 * ORDER SESSIONS SCHEMA
 * Persistent order flow state (replaces in-memory Map).
 * TTL: 24 hours for abandoned carts.
 */
const OrderSessionSchema = new mongoose.Schema({
  uid: { type: String, required: true, index: true },
  state: { type: String, default: "IDLE" }, // IDLE, SHOWING_PRODUCTS, SELECTING_PRODUCT, GETTING_QUANTITY, GETTING_ADDRESS, GETTING_PHONE, CONFIRMING
  selectedProduct: { type: Object, default: null },
  quantity: { type: Number, default: 1 },
  deliveryAddress: { type: String, default: "" },
  phone: { type: String, default: "" },
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now }
});

OrderSessionSchema.index({ createdAt: 1 }, { expireAfterSeconds: 86400 }); // 24 hour TTL

const OrderSession = mongoose.model("OrderSession", OrderSessionSchema);

/**
 * PAYMENT SCHEMA
 * Stores payment records for Bkash, Nagad, etc.
 */
const PaymentSchema = new mongoose.Schema({
  orderId: { type: mongoose.Schema.Types.ObjectId, ref: "Order", required: true },
  uid: { type: String, required: true },
  method: { type: String, enum: ["bkash", "nagad", "rocket", "cod", "bank"], default: "cod" },
  amount: { type: Number, required: true },
  status: { type: String, enum: ["pending", "processing", "completed", "failed", "refunded"], default: "pending" },
  transactionId: { type: String, default: "" },
  paymentUrl: { type: String, default: "" },
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now }
});

const Payment = mongoose.model("Payment", PaymentSchema);

/**
 * BROADCAST SCHEMA
 * Mass message campaigns.
 */
const BroadcastSchema = new mongoose.Schema({
  senderId: { type: String, required: true }, // Admin who sent
  message: { type: String, required: true },
  imageUrl: { type: String, default: "" },
  targetFilter: { type: Object, default: {} }, // { platform: "all", tags: [], orderStatus: "" }
  totalRecipients: { type: Number, default: 0 },
  sentCount: { type: Number, default: 0 },
  failedCount: { type: Number, default: 0 },
  status: { type: String, enum: ["pending", "sending", "completed", "failed"], default: "pending" },
  createdAt: { type: Date, default: Date.now }
});

const Broadcast = mongoose.model("Broadcast", BroadcastSchema);

/**
 * TEMPLATE SCHEMA
 * WhatsApp template messages for 24-hour window compliance.
 */
const TemplateSchema = new mongoose.Schema({
  name: { type: String, required: true, unique: true },
  category: { type: String, enum: ["marketing", "utility", "authentication"], default: "utility" },
  language: { type: String, default: "en" },
  body: { type: String, required: true },
  variables: { type: [String], default: [] }, // e.g., ["1", "2"] for {{1}}, {{2}}
  components: { type: Object, default: {} }, // Header, Footer, Buttons
  status: { type: String, enum: ["pending", "approved", "rejected"], default: "pending" },
  templateId: { type: String, default: "" }, // WhatsApp template ID after approval
  createdAt: { type: Date, default: Date.now }
});

const Template = mongoose.model("Template", TemplateSchema);

/**
 * ECOMMERCE CONNECTION SCHEMA
 * Stores Shopify/WooCommerce connection details.
 */
const EcommerceConnectionSchema = new mongoose.Schema({
  platform: { type: String, enum: ["shopify", "woocommerce"], required: true },
  storeUrl: { type: String, required: true },
  accessToken: { type: String, default: "" }, // Shopify access token
  consumerKey: { type: String, default: "" }, // WooCommerce consumer key
  consumerSecret: { type: String, default: "" }, // WooCommerce consumer secret
  webhookSecret: { type: String, default: "" },
  isActive: { type: Boolean, default: false },
  lastSyncAt: { type: Date, default: null },
  syncStatus: { type: String, enum: ["never", "syncing", "completed", "failed"], default: "never" },
  productCount: { type: Number, default: 0 },
  connectedAt: { type: Date, default: Date.now }
});

const EcommerceConnection = mongoose.model("EcommerceConnection", EcommerceConnectionSchema);

/**
 * KNOWLEDGE BASE SCHEMA
 * Stores FAQs, business rules, and custom instructions for RAG.
 */
const KnowledgeBaseSchema = new mongoose.Schema({
  title: { type: String, required: true },
  content: { type: String, required: true },
  category: { type: String, enum: ["faq", "product_info", "business_rule", "shipping", "return_policy", "custom"], default: "faq" },
  tags: { type: [String], default: [] },
  isActive: { type: Boolean, default: true },
  vectorId: { type: String, default: "" },
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now }
});

const KnowledgeBase = mongoose.model("KnowledgeBase", KnowledgeBaseSchema);

/**
 * FEEDBACK SCHEMA
 * Stores user ratings and corrections for AI responses.
 */
const FeedbackSchema = new mongoose.Schema({
  messageId: { type: mongoose.Schema.Types.ObjectId, ref: "Message" },
  uid: { type: String, required: true, index: true },
  platform: { type: String, enum: ["messenger", "whatsapp", "instagram", "web"], default: "web" },
  rating: { type: Number, enum: [1, 2, 3, 4, 5], default: 3 },
  userMessage: { type: String, default: "" },
  aiResponse: { type: String, default: "" },
  correctedResponse: { type: String, default: "" },
  feedback: { type: String, default: "" },
  tags: { type: [String], default: [] }, // e.g., ["wrong_answer", "helpful", "too_long"]
  createdAt: { type: Date, default: Date.now }
});

FeedbackSchema.index({ uid: 1, createdAt: -1 });

const Feedback = mongoose.model("Feedback", FeedbackSchema);

/**
 * CONVERSATION ANALYTICS SCHEMA
 * Stores aggregated conversation metrics for AI performance tracking.
 */
const ConversationAnalyticsSchema = new mongoose.Schema({
  date: { type: Date, required: true, index: true },
  totalConversations: { type: Number, default: 0 },
  aiHandled: { type: Number, default: 0 },
  humanHandled: { type: Number, default: 0 },
  avgResponseTime: { type: Number, default: 0 },
  avgRating: { type: Number, default: 0 },
  totalFeedback: { type: Number, default: 0 },
  complaints: { type: Number, default: 0 },
  handoffs: { type: Number, default: 0 },
  ordersGenerated: { type: Number, default: 0 },
  revenueGenerated: { type: Number, default: 0 },
  topQueries: { type: [Object], default: [] }, // [{query, count}]
  failureReasons: { type: [Object], default: [] } // [{reason, count}]
});

const ConversationAnalytics = mongoose.model("ConversationAnalytics", ConversationAnalyticsSchema);

/**
 * AD CAMPAIGN SCHEMA
 * Stores Facebook/Instagram ad campaign information for tracking and personalization.
 */
const AdSchema = new mongoose.Schema({
  adId: { type: String, required: true, unique: true, index: true }, // Facebook Ad ID
  campaignId: { type: String, required: true, index: true },
  campaignName: { type: String, default: "" },
  adSetName: { type: String, default: "" },
  adName: { type: String, default: "" },
  platform: { type: String, enum: ["facebook", "instagram"], default: "facebook" },
  creative: { type: Object, default: {} }, // {title, body, image_url, video_url, call_to_action}
  targeting: { type: Object, default: {} }, // {age_min, age_max, genders, locales, countries}
  status: { type: String, enum: ["active", "paused", "completed", "deleted"], default: "active" },
  totalClicks: { type: Number, default: 0 },
  totalConversations: { type: Number, default: 0 },
  totalOrders: { type: Number, default: 0 },
  totalRevenue: { type: Number, default: 0 },
  costPerClick: { type: Number, default: 0 },
  startDate: { type: Date },
  endDate: { type: Date },
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now }
});

AdSchema.index({ campaignId: 1, status: 1 });

const Ad = mongoose.model("Ad", AdSchema);

/**
 * AD CLICK SCHEMA
 * Tracks individual clicks from ads to messenger conversations.
 */
const AdClickSchema = new mongoose.Schema({
  adId: { type: String, required: true, ref: "Ad", index: true },
  uid: { type: String, required: true, index: true }, // User who clicked
  platform: { type: String, enum: ["facebook", "instagram"], default: "facebook" },
  referralData: { type: Object, default: {} }, // Facebook referral params
  converted: { type: Boolean, default: false }, // Did they place an order?
  orderId: { type: mongoose.Schema.Types.ObjectId, ref: "Order", default: null },
  conversationStarted: { type: Boolean, default: false },
  firstMessage: { type: String, default: "" },
  clickedAt: { type: Date, default: Date.now }
});

AdClickSchema.index({ adId: 1, clickedAt: -1 });

const AdClick = mongoose.model("AdClick", AdClickSchema);

module.exports = { connectDB, User, Message, Admin, Order, Product, Settings, Integration, OrderSession, Payment, Broadcast, Template, EcommerceConnection, KnowledgeBase, Feedback, ConversationAnalytics, Ad, AdClick };
