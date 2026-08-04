/**
 * gemini.js
 * ─────────────────────────────────────────────────────────────
 * AI Provider: Groq (qwen-2.5-72b) with Gemini fallback
 * OpenAI-compatible chat completions API.
 * Includes retry wrapper for rate-limited API calls.
 * ─────────────────────────────────────────────────────────────
 */

require("dotenv").config();
const { Message, KnowledgeBase, Settings } = require("./db");
const { processOrderFlow, getProducts } = require("./utils/orderFlow");
const { getProductsForAI } = require("./utils/seedProducts");
const { retrieveContext, buildRAGPrompt } = require("./utils/rag");
const { withRetry } = require("./utils/retry");

const MAX_HISTORY_TURNS = 10;

const AI_PROVIDER = process.env.AI_PROVIDER || "groq";
const GROQ_API_URL = "https://api.groq.com/openai/v1/chat/completions";
const GROQ_MODEL = process.env.GROQ_MODEL || "qwen/qwen-2.5-72b";
const GEMINI_API_URL = "https://generativelanguage.googleapis.com/v1beta/models";
const GEMINI_MODEL = "gemini-2.5-flash";

function isBangla(text) {
  if (!text) return false;
  const banglaRange = /[\u0980-\u09FF]/;
  return banglaRange.test(text);
}

/**
 * Fetch business_info entries from knowledge_base (type='business_info', isActive=true).
 * These are always included in the AI system prompt.
 */
async function getBusinessInfoContext() {
  try {
    const entries = await KnowledgeBase.find({ type: "business_info", isActive: true });
    if (!entries || entries.length === 0) return "";
    return entries.map(e => `${e.title}: ${e.content}`).join("\n");
  } catch (err) {
    console.error("[AI] Failed to fetch business info:", err.message);
    return "";
  }
}

function buildSystemPrompt(settings, productsContext, businessInfoContext = "") {
  const toneMap = {
    professional: "professional, polite, and efficient",
    friendly: "warm, friendly, and conversational",
    casual: "casual, relaxed, and approachable",
    formal: "formal, respectful, and structured"
  };
  const tone = toneMap[settings.tone] || toneMap.professional;

  // Build business info section from settings fields
  const businessDetails = [];
  if (settings.businessName) businessDetails.push(`Business Name: ${settings.businessName}`);
  if (settings.businessDescription) businessDetails.push(`Description: ${settings.businessDescription}`);
  if (settings.timezone) businessDetails.push(`Timezone: ${settings.timezone}`);
  if (settings.customGreeting) businessDetails.push(`Greeting: ${settings.customGreeting}`);

  // Contact info from settings (if stored as JSONB or text fields)
  const contactParts = [];
  if (settings.businessPhone) contactParts.push(`Phone: ${settings.businessPhone}`);
  if (settings.businessEmail) contactParts.push(`Email: ${settings.businessEmail}`);
  if (settings.businessAddress) contactParts.push(`Address: ${settings.businessAddress}`);
  if (settings.businessWebsite) contactParts.push(`Website: ${settings.businessWebsite}`);
  if (settings.businessHours) contactParts.push(`Hours: ${settings.businessHours}`);
  if (contactParts.length) businessDetails.push(`Contact: ${contactParts.join(", ")}`);

  const businessInfoBlock = businessDetails.length > 0
    ? `\nBUSINESS INFORMATION:\n${businessDetails.join("\n")}\n`
    : "";

  // User-uploaded business info entries (always in prompt)
  const knowledgeBlock = businessInfoContext
    ? `\nBUSINESS KNOWLEDGE BASE:\n${businessInfoContext}\n`
    : "";

  // Personality overrides from settings
  let personalityBlock = "";
  if (settings.personality && typeof settings.personality === "object") {
    const p = settings.personality;
    const parts = [];
    if (p.greetingStyle) parts.push(`Greeting style: ${p.greetingStyle}`);
    if (p.responseLength) parts.push(`Response length: ${p.responseLength}`);
    if (p.toneKeywords?.length) parts.push(`Tone keywords: ${p.toneKeywords.join(", ")}`);
    if (parts.length) personalityBlock = `\nPERSONALITY:\n${parts.join("\n")}\n`;
  }

  return `
You are a ${tone} customer support agent for "${settings.businessName || "the business"}".
Current Timezone context: ${settings.timezone || "UTC"}

${settings.systemPrompt || settings.customInstructions ? `CUSTOM BUSINESS INSTRUCTIONS:\n${settings.systemPrompt || settings.customInstructions}\n` : ""}
${businessInfoBlock}
${knowledgeBlock}
${personalityBlock}

IMAGE ANALYSIS CAPABILITY:
- If the user sends an image, analyze it carefully.
- Identify products, gadgets, or components shown.
- Connect the identified items to the business's products and services.
- If it's a product we sell or service, provide helpful details.
- If no match, suggest the closest available products.
- If it's a receipt/invoice, extract items and suggest equivalent products.

COMPLAINT DETECTION:
- If the customer seems frustrated, angry, or is reporting a problem, acknowledge their concern.
- Offer to connect them with a human agent if the issue is complex.
- Always be empathetic and solution-oriented.

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
  `.trim();
}

// ─── Groq API (OpenAI-compatible) ──────────────────────────
async function callGroq(messages, mediaData = null) {
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) throw new Error("GROQ_API_KEY not set in .env");

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 30000);

  try {
    // Filter system message out, use as system prompt
    const systemMsg = messages.find(m => m.role === "system");
    const nonSystemMessages = messages.filter(m => m.role !== "system");

    const formattedMessages = [];
    if (systemMsg) {
      formattedMessages.push({ role: "system", content: systemMsg.content });
    }

    for (let i = 0; i < nonSystemMessages.length; i++) {
      const msg = nonSystemMessages[i];
      const isLastUserMessage = msg.role === "user" && i === nonSystemMessages.length - 1;

      if (msg.role === "user") {
        const content = [];

        // Add image if supported (Groq with vision models)
        if (isLastUserMessage && mediaData && (mediaData.base64 || mediaData.data)) {
          const mimeType = mediaData.mimeType || "image/jpeg";
          content.push({
            type: "image_url",
            image_url: { url: `data:${mimeType};base64,${mediaData.base64 || mediaData.data}` }
          });
        }

        content.push({ type: "text", text: msg.content });
        formattedMessages.push({ role: "user", content });
      } else if (msg.role === "assistant" || msg.role === "model") {
        formattedMessages.push({ role: "assistant", content: msg.content });
      }
    }

    const body = {
      model: GROQ_MODEL,
      messages: formattedMessages,
      max_tokens: 500,
      temperature: 0.7
    };

    const response = await fetch(GROQ_API_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${apiKey}`
      },
      body: JSON.stringify(body),
      signal: controller.signal
    });

    clearTimeout(timeoutId);

    const data = await response.json();

    if (!response.ok) {
      console.error(`[Groq Error ${response.status}]:`, JSON.stringify(data));
      const error = new Error(data.error?.message || `Groq API error ${response.status}`);
      error.response = { status: response.status, data };
      throw error;
    }

    let reply = data.choices?.[0]?.message?.content;
    if (!reply) throw new Error("Empty reply from Groq");

    // Strip <think>...</think> thinking blocks from Qwen models
    reply = reply.replace(/<think>[\s\S]*?<\/think>/g, "").trim();

    return reply;
  } catch (err) {
    clearTimeout(timeoutId);
    if (err.name === "AbortError") {
      const timeoutErr = new Error(`Request timeout after 30s for Groq/${GROQ_MODEL}`);
      timeoutErr.code = "ETIMEDOUT";
      throw timeoutErr;
    }
    if (!err.response) err.response = {};
    throw err;
  }
}

// ─── Gemini API (fallback) ────────────────────────────────
async function callGemini(messages, mediaData = null) {
  const apiKey = process.env.GOOGLE_AI_API_KEY || process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error("GOOGLE_AI_API_KEY not set in .env");

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 30000);

  try {
    const url = `${GEMINI_API_URL}/${GEMINI_MODEL}:generateContent?key=${apiKey}`;

    const contents = [];

    const systemMsg = messages.find(m => m.role === "system");
    if (systemMsg) {
      contents.push({ role: "user", parts: [{ text: systemMsg.content }] });
      contents.push({ role: "model", parts: [{ text: "Understood. I will follow these instructions." }] });
    }

    const nonSystemMessages = messages.filter(m => m.role !== "system");
    for (let i = 0; i < nonSystemMessages.length; i++) {
      const msg = nonSystemMessages[i];
      const isLastUserMessage = msg.role === "user" && i === nonSystemMessages.length - 1;

      if (msg.role === "user") {
        const parts = [];
        if (isLastUserMessage && mediaData && (mediaData.base64 || mediaData.data)) {
          const mimeType = mediaData.mimeType || "image/jpeg";
          parts.push({
            inline_data: { mime_type: mimeType, data: mediaData.base64 || mediaData.data }
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
      generationConfig: { maxOutputTokens: 500, temperature: 0.7 }
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
      console.error(`[Gemini Error ${response.status}]:`, JSON.stringify(data));
      const error = new Error(data.error?.message || "Gemini API error");
      error.response = { status: response.status, data };
      throw error;
    }

    const reply = data.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!reply) throw new Error("Empty reply from Gemini");

    return reply;
  } catch (err) {
    clearTimeout(timeoutId);
    if (err.name === "AbortError") {
      const timeoutErr = new Error(`Request timeout after 30s for Gemini/${GEMINI_MODEL}`);
      timeoutErr.code = "ETIMEDOUT";
      throw timeoutErr;
    }
    if (!err.response) err.response = {};
    throw err;
  }
}

// ─── AI Provider Router ───────────────────────────────────
// Routes Bangla messages to Gemini (strong multilingual support).
// Tries primary provider first for English, falls back on failure.
async function callAI(messages, mediaData = null) {
  const primary = AI_PROVIDER === "gemini" ? "gemini" : "groq";
  const secondary = primary === "gemini" ? "groq" : "gemini";

  const lastUserMsg = messages.findLast(m => m.role === "user");
  const userText = lastUserMsg?.content || "";
  const containsBangla = isBangla(userText);

  const preferredProvider = containsBangla ? "gemini" : primary;
  const fallbackProvider = preferredProvider === "gemini" ? "groq" : "gemini";

  try {
    const reply = preferredProvider === "groq"
      ? await callGroq(messages, mediaData)
      : await callGemini(messages, mediaData);
    return { reply, provider: preferredProvider };
  } catch (err) {
    console.error(`[AI] ${preferredProvider} failed: ${err.message}`);

    const status = err.response?.status || 0;
    const isRetryable = err.code === "ETIMEDOUT" || status === 429 || status === 503 || status === 500;

    if (isRetryable) {
      console.log(`[AI] Falling back to ${fallbackProvider}...`);
      try {
        const reply = fallbackProvider === "groq"
          ? await callGroq(messages, mediaData)
          : await callGemini(messages, mediaData);
        return { reply, provider: fallbackProvider };
      } catch (fallbackErr) {
        console.error(`[AI] ${fallbackProvider} fallback also failed: ${fallbackErr.message}`);
        throw fallbackErr;
      }
    }

    throw err;
  }
}

// ─── Main entry point ─────────────────────────────────────
async function generateReply(senderId, userMessage, mediaData = null, userName = "Customer", adContext = null) {
  try {
    const orderFlowResult = await processOrderFlow(senderId, userMessage, userName);

    if (orderFlowResult) {
      return orderFlowResult.response;
    }

    const { Settings } = require("./db");
    let settings = await Settings.findOne({ configId: "global" });
    if (!settings) settings = { businessName: "Your Business", timezone: "UTC" };

    const productsContext = await getProductsForAI();
    const businessInfoContext = await getBusinessInfoContext();
    let systemPrompt = buildSystemPrompt(settings, productsContext, businessInfoContext);

    if (adContext) {
      systemPrompt += `
AD CONTEXT:
This user came from an ad campaign: "${adContext.campaignName || "Unknown"}"
Ad Name: "${adContext.adName || "Unknown"}"
${adContext.creative?.title ? `Ad Creative Title: "${adContext.creative.title}"` : ""}
${adContext.creative?.body ? `Ad Creative Body: "${adContext.creative.body}"` : ""}
${adContext.creative?.call_to_action ? `Call to Action: "${adContext.creative.call_to_action}"` : ""}

- Acknowledge that they came from this ad if relevant.
- If they ask about the ad offer, confirm details based on the creative.
- Maintain continuity between what the ad promised and your response.
- Do NOT mention the ad if the user's message is unrelated.`;
    }

    if (userMessage && !mediaData) {
      const ragContext = await retrieveContext(userMessage);
      if (ragContext) {
        systemPrompt = buildRAGPrompt(systemPrompt, ragContext);
      }
    }

    const recentMessages = await Message.find({ uid: senderId })
      .sort({ createdAt: -1 })
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

    const { reply, provider } = await callAI(messages, mediaData);
    const modelLabel = provider === "groq" ? GROQ_MODEL : GEMINI_MODEL;
    console.log(`[AI] Reply via ${provider} (${modelLabel})`);
    return reply;

  } catch (error) {
    console.error("[AI] Error:", error.message);
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
