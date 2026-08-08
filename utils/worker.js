/**
 * utils/worker.js
 * ─────────────────────────────────────────────────────────────
 * BullMQ background job workers for message delivery.
 * Processes queued messages with concurrency control.
 * Falls back to direct processing if Redis is unavailable.
 * ─────────────────────────────────────────────────────────────
 */

const { generateReply } = require("../src/services/ai/gemini");
const { sendMessage: sendMessenger, sendTyping } = require("../messenger");
const { sendWhatsAppMessage, markWhatsAppAsRead } = require("../src/services/channels/whatsapp");
const { sendInstagramMessage, sendInstagramTyping } = require("../instagram");
const { saveMessage } = require("../src/config/db");
const { isWithinMessagingWindow, sendViaTagIfExpired } = require("./messagingWindow");

let workerAvailable = false;
let messengerWorker = null;
let whatsappWorker = null;
let instagramWorker = null;

async function initWorkers() {
  let Worker;
  try {
    Worker = require("bullmq").Worker;
  } catch {
    console.log(" [Worker] BullMQ not available — using direct processing");
    return;
  }

  // Check Redis version before creating workers
  const Redis = require("ioredis");
  const REDIS_URL = process.env.REDIS_URL || "redis://127.0.0.1:6379";
  let testRedis;
  try {
    testRedis = new Redis(REDIS_URL, { connectTimeout: 3000, lazyConnect: true });
    await testRedis.connect();
    const info = await testRedis.info("server");
    const versionMatch = info.match(/redis_version:(\d+\.\d+)/);
    const version = versionMatch ? parseFloat(versionMatch[1]) : 0;
    if (version < 5.0) {
      console.warn(` [Worker] Redis ${version} detected (need 5.0+ for BullMQ) — using direct processing`);
      await testRedis.quit();
      return;
    }
    await testRedis.quit();
  } catch (err) {
    console.warn(" [Worker] Redis not available — using direct processing");
    if (testRedis) await testRedis.quit().catch(() => {});
    return;
  }

  const REDIS_OPTS = { connection: REDIS_URL };
  const CONCURRENCY = 5;

  function createWorker(queueName, processFn) {
    try {
      const worker = new Worker(queueName, processFn, {
        ...REDIS_OPTS,
        concurrency: CONCURRENCY,
        limiter: { max: 20, duration: 1000 },
      });
      worker.on("completed", (job) => console.log(` [Worker] ${queueName} job #${job.id} completed`));
      worker.on("failed", (job, err) => console.error(` [Worker] ${queueName} job #${job.id} failed: ${err.message}`));
      worker.on("error", (err) => console.error(` [Worker] ${queueName} error: ${err.message}`));
      return worker;
    } catch (err) {
      console.warn(` [Worker] Failed to create ${queueName} worker:`, err.message);
      return null;
    }
  }

  messengerWorker = createWorker("messenger-messages", async (job) => {
    const { senderId, text, pageId, userName, adContext, mediaData } = job.data;
    await sendTyping(senderId, pageId);
    const reply = await generateReply(senderId, text, mediaData, userName, adContext);
    await saveMessage(senderId, "user", text);
    await saveMessage(senderId, "model", reply);
    await sendMessenger(senderId, reply, pageId);
    return { success: true };
  });

  whatsappWorker = createWorker("whatsapp-messages", async (job) => {
    const { senderId, text, wabaId, messageId } = job.data;
    const withinWindow = await isWithinMessagingWindow(senderId, "whatsapp");
    if (!withinWindow) {
      const tagResult = await sendViaTagIfExpired(senderId, "whatsapp", text);
      return { success: !!tagResult, sentVia: tagResult ? "tag" : null };
    }
    if (messageId) await markWhatsAppAsRead(messageId, wabaId);
    const reply = await generateReply(senderId, text, null, "Customer");
    await saveMessage(senderId, "user", text);
    await saveMessage(senderId, "model", reply);
    await sendWhatsAppMessage(senderId, reply, wabaId);
    return { success: true };
  });

  instagramWorker = createWorker("instagram-messages", async (job) => {
    const { senderId, text, pageId, mediaData } = job.data;
    await sendInstagramTyping(senderId, pageId);
    const reply = await generateReply(senderId, text, mediaData, "Instagram User");
    await saveMessage(senderId, "user", text);
    await saveMessage(senderId, "model", reply);
    await sendInstagramMessage(senderId, reply, pageId);
    return { success: true };
  });

  if (messengerWorker || whatsappWorker || instagramWorker) {
    workerAvailable = true;
    console.log(" [Worker] BullMQ workers started (Redis 5.0+)");
  }
}

async function closeWorkers() {
  if (messengerWorker) await messengerWorker.close().catch(() => {});
  if (whatsappWorker) await whatsappWorker.close().catch(() => {});
  if (instagramWorker) await instagramWorker.close().catch(() => {});
}

// Auto-init on require
initWorkers().catch(() => {});

module.exports = {
  messengerWorker,
  whatsappWorker,
  instagramWorker,
  closeWorkers,
  workerAvailable,
};
