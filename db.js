/**
 * db.js
 * ─────────────────────────────────────────────────────────────
 * Supabase database connection and model exports.
 * Replaces the original Mongoose-based implementation.
 * ─────────────────────────────────────────────────────────────
 */

const path = require("path");
require("dotenv").config({ path: path.join(__dirname, ".env") });

const {
  supabase,
  User,
  Admin,
  Message,
  Settings,
  Integration,
  Order,
  Product,
  OrderSession,
  Payment,
  Broadcast,
  Template,
  EcommerceConnection,
  KnowledgeBase,
  Feedback,
  ConversationAnalytics,
  Ad,
  AdClick,
} = require("./supabaseClient");

/**
 * CONNECT TO DATABASE
 * Verifies Supabase connection by running a simple query.
 */
async function connectDB() {
  try {
    const { error } = await supabase.from("users").select("id").limit(1);
    if (error) throw error;
    console.log("✅ Supabase Connected Successfully!");
  } catch (error) {
    console.error("❌ Supabase Connection Error:", error.message);
    process.exit(1);
  }
}

module.exports = {
  connectDB,
  supabase,
  User,
  Message,
  Admin,
  Order,
  Product,
  Settings,
  Integration,
  OrderSession,
  Payment,
  Broadcast,
  Template,
  EcommerceConnection,
  KnowledgeBase,
  Feedback,
  ConversationAnalytics,
  Ad,
  AdClick,
};
