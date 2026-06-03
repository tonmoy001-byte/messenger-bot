/**
 * gemini.js
 * ─────────────────────────────────────────────────────────────
 * AI Provider: Google Gemini 2.5 Flash (Direct API)
 * Maintains persistent history using MongoDB.
 * Order Flow integration for handling purchases.
 * ─────────────────────────────────────────────────────────────
 */

require("dotenv").config();
const { BUSINESS_CONTEXT } = require("./knowledge");
const { Message } = require("./db");
const { processOrderFlow, getProducts } = require("./utils/orderFlow");
const { getProductsForAI } = require("./utils/seedProducts");
const { retrieveContext, buildRAGPrompt } = require("./utils/rag");

const MAX_HISTORY_TURNS = 10;
const MODEL = "gemini-2.5-flash";
const GEMINI_API_URL = "https://generativelanguage.googleapis.com/v1beta/models";

function buildSystemPrompt(settings, productsContext) {
  const toneMap = {
    professional: "professional, polite, and efficient",
    friendly: "warm, friendly, and conversational",
    casual: "casual, relaxed, and approachable",
    formal: "formal, respectful, and structured"
  };
  const tone = toneMap[settings.tone] || toneMap.professional;

  return `
You are a ${tone} customer support agent for "${settings.businessName}".
Current Timezone context: ${settings.timezone}

${settings.customInstructions ? `CUSTOM BUSINESS INSTRUCTIONS:\n${settings.customInstructions}\n` : ""}

IMAGE ANALYSIS CAPABILITY:
- If the user sends an image, analyze it carefully.
- Identify products, gadgets, or components shown (e.g., laptop, mouse, motherboard, cable).
- Connect the identified items to ${settings.businessName}'s services.
- If it's a product we sell or service, provide helpful details.

ORDER & PURCHASE HANDLING:
- When a customer wants to buy something, guide them through the ordering process.
- Show the available products and let them select by number.
- Ask for quantity, delivery address, and phone number.
- Confirm the order before finalizing.

${productsContext}

RULES YOU MUST FOLLOW:
1. Stay ULTRA-CONCISE. Use the minimum tokens possible.
2. MANDATORY: Before providing detailed info (specs, course lists, or long answers), ALWAYS confirm if the user wants it.
3. Always respond in the SAME LANGUAGE the customer used (Bangla, English, or Banglish).
4. Be helpful but brief. Aim for 1-2 short sentences max per response.
5. If you don't know something specific, say:
   "Let me check! Contact us at the business contact number."
6. Never make up information.
7. If the customer seems frustrated or has a complaint, acknowledge their concern and offer to connect them with a human agent.

${BUSINESS_CONTEXT}
  `.trim();
}

async function callGemini(messages, mediaData = null) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 30000);

  try {
    // Support both GOOGLE_AI_API_KEY and GEMINI_API_KEY for backward compatibility
    const apiKey = process.env.GOOGLE_AI_API_KEY || process.env.GEMINI_API_KEY;
    const url = `${GEMINI_API_URL}/${MODEL}:generateContent?key=${apiKey}`;

    const contents = [];

    // Add system instruction as first user message
    const systemMsg = messages.find(m => m.role === "system");
    if (systemMsg) {
      contents.push({ role: "user", parts: [{ text: systemMsg.content }] });
      contents.push({ role: "model", parts: [{ text: "Understood. I will follow these instructions." }] });
    }

    // Add conversation history
    const nonSystemMessages = messages.filter(m => m.role !== "system");
    for (let i = 0; i < nonSystemMessages.length; i++) {
      const msg = nonSystemMessages[i];
      const isLastUserMessage = msg.role === "user" && i === nonSystemMessages.length - 1;
      
      if (msg.role === "user") {
        const parts = [];
        
        // Add image data if this is the last user message and mediaData exists
        if (isLastUserMessage && mediaData && (mediaData.base64 || mediaData.data)) {
          const mimeType = mediaData.mimeType || "image/jpeg";
          parts.push({
            inline_data: {
              mime_type: mimeType,
              data: mediaData.base64 || mediaData.data
            }
          });
        }
        
        parts.push({ text: msg.content });
        contents.push({ role: "user", parts });
      } else if (msg.role === "assistant" || msg.role === "model") {
        contents.push({ role: "model", parts: [{ text: msg.content }] });
      }
    }

    const body = {
      contents,
      generationConfig: {
        maxOutputTokens: 500,
        temperature: 0.7
      }
    };

    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: controller.signal
    });

    clearTimeout(timeoutId);

    const data = await response.json();

    if (!response.ok) {
      console.error(`❌ Gemini Error [${response.status}]:`, JSON.stringify(data));
      throw new Error(data.error?.message || "Gemini API error");
    }

    const reply = data.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!reply) throw new Error("Empty reply from Gemini");

    return reply;
  } catch (err) {
    clearTimeout(timeoutId);
    if (err.name === 'AbortError') {
      throw new Error(`Request timeout after 30s for ${MODEL}`);
    }
    throw err;
  }
}

async function generateReply(senderId, userMessage, mediaData = null, userName = "Customer", adContext = null) {
  try {
    const orderFlowResult = await processOrderFlow(senderId, userMessage, userName);

    if (orderFlowResult) {
      return orderFlowResult.response;
    }

    const { Settings } = require("./db");
    let settings = await Settings.findOne({ configId: "global" });
    if (!settings) settings = { businessName: "Your Business", timezone: "UTC" };

    const productsContext = getProductsForAI();
    let systemPrompt = buildSystemPrompt(settings, productsContext);

    // Ad context: Personalize response based on ad the user clicked
    if (adContext) {
      const adContextPrompt = `
AD CONTEXT:
This user came from an ad campaign: "${adContext.campaignName || "Unknown"}"
Ad Name: "${adContext.adName || "Unknown"}"
${adContext.creative?.title ? `Ad Creative Title: "${adContext.creative.title}"` : ""}
${adContext.creative?.body ? `Ad Creative Body: "${adContext.creative.body}"` : ""}
${adContext.creative?.call_to_action ? `Call to Action: "${adContext.creative.call_to_action}"` : ""}

- Acknowledge that they came from this ad if relevant.
- If they ask about the ad offer, confirm details based on the creative.
- Maintain continuity between what the ad promised and your response.
- Do NOT mention the ad if the user's message is unrelated.
`;
      systemPrompt += adContextPrompt;
    }

    // RAG: Retrieve relevant context from knowledge base
    if (userMessage && !mediaData) {
      const ragContext = await retrieveContext(userMessage);
      if (ragContext) {
        systemPrompt = buildRAGPrompt(systemPrompt, ragContext);
      }
    }

    const recentMessages = await Message.find({ uid: senderId })
      .sort({ timestamp: -1 })
      .limit(MAX_HISTORY_TURNS * 2);

    const messages = [
      { role: "system", content: systemPrompt },
      ...recentMessages.reverse().map((msg) => ({
        role: msg.role === "model" ? "assistant" : "user",
        content: msg.content,
      })),
      {
        role: "user",
        content: mediaData
          ? `[Image received] ${userMessage || "Please analyze this image."}`
          : (userMessage || "Hello"),
      },
    ];

    console.log(` [AI] Using ${MODEL}`);
    const reply = await callGemini(messages, mediaData);
    console.log(` [AI] Success with ${MODEL}`);
    return reply;

  } catch (error) {
    console.error(" [AI] Error:", error.message);
  }

  return "I'm sorry, I'm having a little trouble right now. Please try again in a moment, or contact us directly. 😊";
}

async function clearHistory(senderId) {
  try {
    await Message.deleteMany({ uid: senderId });
    console.log(`🧹 History cleared for ${senderId}`);
  } catch (error) {
    console.error("❌ Clear History Error:", error.message);
  }
}

module.exports = { generateReply, clearHistory };
