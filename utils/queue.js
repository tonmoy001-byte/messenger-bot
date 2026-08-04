/**
 * utils/queue.js
 * ─────────────────────────────────────────────────────────────
 * BullMQ message queue setup for all platforms.
 * Handles message delivery with concurrency control and retries.
 * Falls back to direct processing if Redis is unavailable.
 * ─────────────────────────────────────────────────────────────
 */

let Queue = null;
let queueAvailable = false;

try {
  Queue = require("bullmq").Queue;
} catch (e) {
  console.warn(" [Queue] BullMQ not available, using direct processing");
}

const REDIS_URL = process.env.REDIS_URL || "redis://127.0.0.1:6379";
const REDIS_OPTS = { connection: REDIS_URL };

let messengerQueue = null;
let whatsappQueue = null;
let instagramQueue = null;

async function initQueues() {
  if (!Queue) return;

  const Redis = require("ioredis");
  let testRedis;
  try {
    testRedis = new Redis(REDIS_URL, { connectTimeout: 3000, lazyConnect: true });
    await testRedis.connect();
    const info = await testRedis.info("server");
    const versionMatch = info.match(/redis_version:(\d+\.\d+)/);
    const version = versionMatch ? parseFloat(versionMatch[1]) : 0;
    if (version < 5.0) {
      console.warn(` [Queue] Redis ${version} detected (need 5.0+ for BullMQ) — using direct processing`);
      await testRedis.quit();
      return;
    }
    await testRedis.quit();
  } catch (err) {
    console.warn(" [Queue] Redis not available — using direct processing");
    if (testRedis) await testRedis.quit().catch(() => {});
    return;
  }

  try {
    messengerQueue = new Queue("messenger-messages", {
      ...REDIS_OPTS,
      defaultJobOptions: {
        attempts: 3,
        backoff: { type: "exponential", delay: 2000 },
        removeOnComplete: { count: 500 },
        removeOnFail: { count: 200 },
      },
    });

    whatsappQueue = new Queue("whatsapp-messages", {
      ...REDIS_OPTS,
      defaultJobOptions: {
        attempts: 3,
        backoff: { type: "exponential", delay: 2000 },
        removeOnComplete: { count: 500 },
        removeOnFail: { count: 200 },
      },
    });

    instagramQueue = new Queue("instagram-messages", {
      ...REDIS_OPTS,
      defaultJobOptions: {
        attempts: 3,
        backoff: { type: "exponential", delay: 2000 },
        removeOnComplete: { count: 500 },
        removeOnFail: { count: 200 },
      },
    });

    queueAvailable = true;
    console.log(" [Queue] BullMQ queues initialized");
  } catch (err) {
    console.warn(" [Queue] Failed to init BullMQ queues:", err.message);
    console.warn(" [Queue] Falling back to direct processing");
  }
}

initQueues().catch(() => {});

const QUEUE_MAP = {
  messenger: messengerQueue,
  whatsapp: whatsappQueue,
  instagram: instagramQueue,
};

/**
 * Add a message job to the appropriate platform queue.
 * Falls back to direct processing if queue is unavailable.
 * @param {string} platform - messenger | whatsapp | instagram
 * @param {object} jobData - { senderId, text, pageId, ... }
 * @param {Function} directProcessFn - Fallback function if queue unavailable
 */
async function enqueueMessage(platform, jobData, directProcessFn = null) {
  const queue = QUEUE_MAP[platform];

  if (!queue || !queueAvailable) {
    // Direct processing fallback
    if (directProcessFn) {
      console.log(` [Queue] Direct processing for ${platform} (queue unavailable)`);
      return directProcessFn(jobData);
    }
    console.warn(` [Queue] No queue and no fallback for ${platform}`);
    return null;
  }

  const jobName = `${platform}-send`;
  const job = await queue.add(jobName, {
    ...jobData,
    platform,
    queuedAt: Date.now(),
  });

  console.log(` [Queue] Enqueued ${platform} message for ${jobData.senderId} (job #${job.id})`);
  return job;
}

/**
 * Get queue stats for monitoring.
 */
async function getQueueStats() {
  if (!queueAvailable) {
    return { available: false, fallback: "direct" };
  }

  const stats = {};
  for (const [platform, queue] of Object.entries(QUEUE_MAP)) {
    if (!queue) { stats[platform] = { status: "unavailable" }; continue; }
    try {
      const [waiting, active, completed, failed] = await Promise.all([
        queue.getWaitingCount(),
        queue.getActiveCount(),
        queue.getCompletedCount(),
        queue.getFailedCount(),
      ]);
      stats[platform] = { waiting, active, completed, failed };
    } catch {
      stats[platform] = { status: "error" };
    }
  }
  return { available: true, ...stats };
}

async function closeQueues() {
  for (const queue of Object.values(QUEUE_MAP)) {
    if (queue) await queue.close().catch(() => {});
  }
}

module.exports = {
  messengerQueue,
  whatsappQueue,
  instagramQueue,
  enqueueMessage,
  getQueueStats,
  closeQueues,
  queueAvailable,
};
