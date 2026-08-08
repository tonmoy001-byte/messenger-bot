/**
 * utils/conversationAnalyzer.js
 * ────────────────────────────────────────────────────────────
 * Analyzes conversation patterns and AI performance.
 * Identifies common queries, failure patterns, and suggests
 * knowledge base improvements.
 * ────────────────────────────────────────────────────────────
 */

const { Message, Feedback, Order, User } = require("../src/config/db");

/**
 * Analyze conversations for a given date range.
 * @param {Date} startDate - Start of analysis period
 * @param {Date} endDate - End of analysis period
 * @returns {Promise<object>} - Analysis results
 */
async function analyzeConversations(startDate, endDate) {
  try {
    const filter = { createdAt: { $gte: startDate, $lte: endDate } };

    // Total messages
    const totalMessages = await Message.countDocuments(filter);

    // User vs AI messages
    const userMessages = await Message.countDocuments({ ...filter, role: "user" });
    const aiMessages = await Message.countDocuments({ ...filter, role: "model" });

    // Unique conversations
    const uniqueUsers = await Message.distinct("uid", filter);

    // Average response time (time between user message and AI reply)
    const conversations = await Message.aggregate([
      { $match: filter },
      { $sort: { uid: 1, createdAt: 1 } }
    ]);

    let totalResponseTime = 0;
    let responseCount = 0;
    let lastUserTime = null;
    let lastUid = null;

    for (const msg of conversations) {
      if (msg.uid !== lastUid) {
        lastUid = msg.uid;
        lastUserTime = null;
      }
      if (msg.role === "user") {
        lastUserTime = new Date(msg.createdAt).getTime();
      } else if (msg.role === "model" && lastUserTime) {
        const diff = (new Date(msg.createdAt).getTime() - lastUserTime) / 1000;
        if (diff > 0 && diff < 300) {
          totalResponseTime += diff;
          responseCount++;
        }
        lastUserTime = null;
      }
    }

    const avgResponseTime = responseCount > 0 ? (totalResponseTime / responseCount).toFixed(1) : 0;

    // Feedback stats
    const feedbackFilter = { createdAt: { $gte: startDate, $lte: endDate } };
    const feedbackStats = await Feedback.aggregate([
      { $match: feedbackFilter },
      { $group: {
          _id: null,
          count: { $sum: 1 },
          avgRating: { $avg: "$rating" },
          ratings: { $push: "$rating" }
        }
      }
    ]);

    // Top queries (most common user messages)
    const topQueries = await Message.aggregate([
      { $match: { ...filter, role: "user" } },
      { $group: { _id: "$content", count: { $sum: 1 } } },
      { $sort: { count: -1 } },
      { $limit: 10 }
    ]);

    // Orders generated in period
    const orders = await Order.countDocuments({ createdAt: { $gte: startDate, $lte: endDate } });
    const revenueResult = await Order.aggregate([
      { $match: { createdAt: { $gte: startDate, $lte: endDate } } },
      { $group: { _id: null, total: { $sum: "$totalAmount" } } }
    ]);

    return {
      totalMessages,
      userMessages,
      aiMessages,
      uniqueConversations: uniqueUsers.length,
      avgResponseTime: parseFloat(avgResponseTime),
      feedback: {
        count: feedbackStats[0]?.count || 0,
        avgRating: feedbackStats[0]?.avgRating?.toFixed(2) || 0,
        distribution: getRatingDistribution(feedbackStats[0]?.ratings || [])
      },
      topQueries: topQueries.map(q => ({ query: q._id, count: q.count })),
      orders,
      revenue: revenueResult[0]?.total || 0
    };
  } catch (err) {
    console.error(" [Analyzer] Error:", err.message);
    return null;
  }
}

/**
 * Get rating distribution from array of ratings.
 */
function getRatingDistribution(ratings) {
  const dist = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
  for (const r of ratings) {
    if (dist[r] !== undefined) dist[r]++;
  }
  return dist;
}

/**
 * Identify common failure patterns from low-rated feedback.
 */
async function identifyFailurePatterns(days = 30) {
  try {
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - days);

    const lowRated = await Feedback.find({
      rating: { $lte: 2 },
      createdAt: { $gte: startDate }
    }).sort({ createdAt: -1 });

    // Group by common patterns
    const patterns = {};
    for (const f of lowRated) {
      const tags = f.tags || [];
      for (const tag of tags) {
        patterns[tag] = (patterns[tag] || 0) + 1;
      }
    }

    return Object.entries(patterns)
      .map(([reason, count]) => ({ reason, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 10);
  } catch (err) {
    console.error(" [Analyzer] Failure patterns error:", err.message);
    return [];
  }
}

/**
 * Suggest knowledge base additions based on unanswered queries.
 * Queries that appear frequently but have low satisfaction.
 */
async function suggestKnowledgeAdditions(days = 30) {
  try {
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - days);

    // Find user messages that led to low ratings
    const lowRatedMessages = await Feedback.find({
      rating: { $lte: 2 },
      createdAt: { $gte: startDate },
      userMessage: { $ne: "" }
    });

    // Count frequency of each query
    const queryCounts = {};
    for (const f of lowRatedMessages) {
      const q = f.userMessage.toLowerCase().trim();
      if (q.length > 5) {
        queryCounts[q] = (queryCounts[q] || 0) + 1;
      }
    }

    return Object.entries(queryCounts)
      .map(([query, count]) => ({ query, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 10);
  } catch (err) {
    console.error(" [Analyzer] Suggestions error:", err.message);
    return [];
  }
}

/**
 * Export conversation pairs for fine-tuning.
 * Format: { user: "...", assistant: "..." }
 */
async function exportFineTuningData(days = 90, minRating = 4) {
  try {
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - days);

    // Get high-rated conversations
    const goodFeedback = await Feedback.find({
      rating: { $gte: minRating },
      createdAt: { $gte: startDate },
      userMessage: { $ne: "" },
      aiResponse: { $ne: "" }
    }).limit(1000);

    const pairs = goodFeedback.map(f => ({
      user: f.userMessage,
      assistant: f.aiResponse
    }));

    return {
      count: pairs.length,
      data: pairs,
      jsonl: pairs.map(p => JSON.stringify(p)).join("\n")
    };
  } catch (err) {
    console.error(" [Analyzer] Export error:", err.message);
    return { count: 0, data: [], jsonl: "" };
  }
}

module.exports = {
  analyzeConversations,
  identifyFailurePatterns,
  suggestKnowledgeAdditions,
  exportFineTuningData
};
