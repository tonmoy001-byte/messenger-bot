/**
 * utils/whatsappTemplates.js
 * ────────────────────────────────────────────────────────────
 * WhatsApp Template Message Manager for Cyberbot.
 * Handles 24-hour window compliance with pre-approved templates.
 * ────────────────────────────────────────────────────────────
 */

const axios = require("axios");
const { Template, Settings } = require("../db");
const { resolveToken } = require("./tokenManager");

const WHATSAPP_API_BASE = "https://graph.facebook.com/v19.0";

/**
 * Send a template message via WhatsApp Cloud API.
 * Bypasses 24-hour customer service window.
 */
async function sendTemplateMessage(to, templateName, variables = {}, wabaId = null) {
  try {
    const token = await resolveToken("whatsapp", wabaId);
    if (!token) {
      console.error(" [WhatsApp] No token available for template");
      return { success: false, error: "No token" };
    }

    const settings = await Settings.findOne({ configId: "global" });
    const phoneNumberId = settings?.whatsappPhoneNumberId || process.env.WHATSAPP_PHONE_NUMBER_ID;

    if (!phoneNumberId) {
      console.error(" [WhatsApp] No phone number ID configured");
      return { success: false, error: "No phone number ID" };
    }

    // Build variable components
    const components = [];
    if (variables && Object.keys(variables).length > 0) {
      components.push({
        type: "body",
        parameters: Object.entries(variables).map(([key, value]) => ({
          type: "text",
          text: String(value)
        }))
      });
    }

    const url = `${WHATSAPP_API_BASE}/${phoneNumberId}/messages`;
    const response = await axios.post(url, {
      messaging_product: "whatsapp",
      to,
      type: "template",
      template: {
        name: templateName,
        language: { code: "en" },
        components: components.length > 0 ? components : undefined
      }
    }, {
      headers: {
        "Authorization": `Bearer ${token}`,
        "Content-Type": "application/json"
      }
    });

    return { success: true, messageId: response.data.messages?.[0]?.id };
  } catch (err) {
    console.error(" [WhatsApp Template Error]:", err.response?.data || err.message);
    return { success: false, error: err.response?.data?.error?.message || err.message };
  }
}

/**
 * Create a template in WhatsApp Business Manager.
 * This submits the template for Meta approval.
 */
async function createWhatsAppTemplate(name, category, body, variables = [], components = {}) {
  try {
    const settings = await Settings.findOne({ configId: "global" });
    const token = await resolveToken("whatsapp");
    if (!token) return { success: false, error: "No WhatsApp token" };

    const wabaId = settings?.whatsappBusinessAccountId || process.env.WHATSAPP_BUSINESS_ACCOUNT_ID;
    if (!wabaId) return { success: false, error: "No WABA ID configured" };

    const url = `${WHATSAPP_API_BASE}/${wabaId}/message_templates`;
    const response = await axios.post(url, {
      name,
      category,
      language: "en",
      components: [
        {
          type: "BODY",
          text: body,
          ...(variables.length > 0 && {
            example: {
              body_text: [variables.map(v => `Example ${v}`)]
            }
          })
        },
        ...Object.entries(components).map(([type, content]) => ({
          type: type.toUpperCase(),
          ...content
        }))
      ]
    }, {
      headers: {
        "Authorization": `Bearer ${token}`,
        "Content-Type": "application/json"
      }
    });

    // Save to local database
    await Template.findOneAndUpdate(
      { name },
      {
        $set: {
          name,
          category,
          body,
          variables,
          components,
          templateId: response.data.id,
          status: response.data.status === "APPROVED" ? "approved" : "pending"
        }
      },
      { upsert: true }
    );

    return { success: true, templateId: response.data.id, status: response.data.status };
  } catch (err) {
    console.error(" [Create Template Error]:", err.response?.data || err.message);
    return { success: false, error: err.response?.data?.error?.message || err.message };
  }
}

/**
 * Get all templates from local database.
 */
async function getTemplates() {
  return Template.find().sort({ createdAt: -1 });
}

/**
 * Delete a template.
 */
async function deleteTemplate(id) {
  return Template.findByIdAndDelete(id);
}

/**
 * Pre-built template messages for common scenarios.
 */
const PREBUILT_TEMPLATES = {
  order_confirmation: {
    name: "order_confirmation",
    category: "utility",
    body: "Hi {{1}}! Your order #{{2}} has been confirmed. Total: ৳{{3}}. We'll notify you when it ships. Thank you for shopping with us!",
    variables: ["customer_name", "order_id", "total_amount"]
  },
  shipping_update: {
    name: "shipping_update",
    category: "utility",
    body: "Hi {{1}}! Your order #{{2}} has been shipped. Track your package here: {{3}}. Expected delivery: {{4}}.",
    variables: ["customer_name", "order_id", "tracking_url", "delivery_date"]
  },
  delivery_confirmation: {
    name: "delivery_confirmation",
    category: "utility",
    body: "Hi {{1}}! Your order #{{2}} has been delivered. We hope you enjoy your purchase! Rate your experience: {{3}}",
    variables: ["customer_name", "order_id", "review_link"]
  },
  payment_reminder: {
    name: "payment_reminder",
    category: "utility",
    body: "Hi {{1}}! Your payment of ৳{{2}} for order #{{3}} is pending. Complete payment here: {{4}}",
    variables: ["customer_name", "amount", "order_id", "payment_link"]
  },
  welcome_message: {
    name: "welcome_message",
    category: "marketing",
    body: "Welcome to {{1}}! 🎉 We're excited to have you. Reply to this message anytime for product info, orders, or support.",
    variables: ["business_name"]
  },
  complaint_followup: {
    name: "complaint_followup",
    category: "utility",
    body: "Hi {{1}}, we're sorry about your experience with order #{{2}}. Our team is looking into this. We'll update you within 24 hours.",
    variables: ["customer_name", "order_id"]
  }
};

/**
 * Seed pre-built templates.
 */
async function seedTemplates() {
  const existing = await Template.countDocuments();
  if (existing > 0) return;

  for (const [key, template] of Object.entries(PREBUILT_TEMPLATES)) {
    await Template.findOneAndUpdate(
      { name: template.name },
      { $set: { ...template, status: "pending" } },
      { upsert: true }
    );
  }
  console.log(" WhatsApp templates seeded");
}

module.exports = {
  sendTemplateMessage,
  createWhatsAppTemplate,
  getTemplates,
  deleteTemplate,
  PREBUILT_TEMPLATES,
  seedTemplates
};
