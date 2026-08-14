/**
 * src/routes/admin.js
 * Admin dashboard API: conversations, messages, reply, orders, customers, settings,
 * stats, exports, search, notifications, audit-logs, team, feedback, analytics,
 * fine-tuning export, ai-performance.
 */
const bcrypt = require("bcryptjs");
const {
  User,
  Message,
  Order,
  Admin,
  Settings,
  Feedback,
} = require("../config/db");
const { saveMessage } = require("../utils/messageHelpers");
const { sendMessage } = require("../services/channels/messenger");
const { sendWhatsAppMessage } = require("../services/channels/whatsapp");
const { sendInstagramMessage } = require("../services/channels/instagram");
const { getQueueStats } = require("../../utils/queue");
const { deleteUserMessages, purgeExpiredMessages } = require("../../utils/dataRetention");
const {
  analyzeConversations,
  identifyFailurePatterns,
  suggestKnowledgeAdditions,
  exportFineTuningData,
} = require("../../utils/conversationAnalyzer");
const { HANDOFF_STATUS, getHandoffStatus } = require("../utils/handoff");

function registerAdminRoutes(app, { io, adminLimiter, authenticateAdmin, requireAdmin }) {
  if (!app || typeof app.get !== "function") {
    throw new Error("registerAdminRoutes requires an Express app");
  }
  if (app.__adminRoutesRegistered) return;
  app.__adminRoutesRegistered = true;

  app.get("/api/admin/conversations", adminLimiter, authenticateAdmin, async (req, res) => {
    try {
      const users = await User.find().sort({ lastSeen: -1 });
      const convos = await Promise.all(users.map(async (u) => {
        const lastMsg = await Message.findOne({ uid: u.uid }).sort({ createdAt: -1 });
        return { customerId: u.uid, customerName: u.name, customerPhone: u.phone, profilePic: u.profilePic, platform: u.platform, lastMessage: lastMsg ? lastMsg.content : "No messages yet", lastMessageTime: lastMsg ? lastMsg.createdAt : u.lastSeen, unread: false, handoffStatus: getHandoffStatus(u), handoffUpdatedAt: u.metadata?.handoffUpdatedAt || null };
      }));
      res.json(convos);
    } catch (err) { res.status(500).json({ error: err.message }); }
  });

  app.post("/api/admin/conversations/:uid/handoff", adminLimiter, authenticateAdmin, async (req, res) => {
    const { action } = req.body || {};
    const nextStatus = {
      takeover: HANDOFF_STATUS.HUMAN_ACTIVE,
      resume: HANDOFF_STATUS.AI_ACTIVE,
      request: HANDOFF_STATUS.HUMAN_REQUESTED,
    }[action];

    if (!nextStatus) {
      return res.status(400).json({
        error: "Invalid handoff action. Use takeover, resume, or request.",
      });
    }

    try {
      const user = await User.findOneAndUpdate(
        { uid: req.params.uid },
        {
          $set: {
            "metadata.handoffStatus": nextStatus,
            "metadata.handoffUpdatedAt": new Date(),
          },
        },
        { new: true }
      );

      if (!user) return res.status(404).json({ error: "Conversation not found" });

      io.emit("human_handoff_updated", {
        uid: req.params.uid,
        tenant_id: req.tenant_id || null,
        handoffStatus: nextStatus,
      });

      return res.json({
        success: true,
        uid: req.params.uid,
        handoffStatus: nextStatus,
      });
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  });

  app.get("/api/admin/messages/:uid", adminLimiter, authenticateAdmin, async (req, res) => {
    try { const messages = await Message.find({ uid: req.params.uid }).sort({ createdAt: 1 }); res.json(messages); }
    catch (err) { res.status(500).json({ error: err.message }); }
  });

  app.post("/api/admin/reply", adminLimiter, authenticateAdmin, async (req, res) => {
    const { uid, message, platform } = req.body;
    try {
      if (!uid || !message || !String(message).trim()) {
        return res.status(400).json({ error: "Customer ID and message are required" });
      }

      const user = await User.findOneAndUpdate(
        { uid },
        {
          $set: {
            "metadata.handoffStatus": HANDOFF_STATUS.HUMAN_ACTIVE,
            "metadata.handoffUpdatedAt": new Date(),
          },
        },
        { new: true }
      );
      if (!user) return res.status(404).json({ error: "Conversation not found" });

      await saveMessage(uid, "model", message);
      if (platform === "messenger") await sendMessage(uid, message);
      else if (platform === "whatsapp") await sendWhatsAppMessage(uid, message);
      else if (platform === "instagram") await sendInstagramMessage(uid, message);
      io.emit("new_message", {
        uid,
        role: "model",
        content: message,
        timestamp: new Date(),
        tenant_id: req.tenant_id || null,
        handoffStatus: HANDOFF_STATUS.HUMAN_ACTIVE,
      });
      res.json({ success: true, handoffStatus: HANDOFF_STATUS.HUMAN_ACTIVE });
    } catch (err) { res.status(500).json({ error: err.message }); }
  });

  app.get("/api/admin/orders", adminLimiter, authenticateAdmin, async (req, res) => {
    try { const orders = await Order.find().sort({ createdAt: -1 }); res.json(orders); }
    catch (err) { res.status(500).json({ error: err.message }); }
  });

  app.get("/api/admin/customers", adminLimiter, authenticateAdmin, async (req, res) => {
    try {
      const users = await User.find().sort({ lastSeen: -1 });
      const customers = await Promise.all(users.map(async (u) => {
        const orderCount = await Order.countDocuments({ uid: u.uid });
        const totalSpent = await Order.aggregate([{ $match: { uid: u.uid } }, { $group: { _id: null, total: { $sum: "$totalAmount" } } }]);
        return { id: u.uid, name: u.name, email: u.email || "N/A", phone: u.phone || "N/A", platform: u.platform, lastActive: u.lastSeen, totalOrders: orderCount, totalSpent: totalSpent.length > 0 ? totalSpent[0].total : 0, tags: u.metadata?.tags || [], notes: u.metadata?.notes || "" };
      }));
      res.json(customers);
    } catch (err) { res.status(500).json({ error: err.message }); }
  });

  app.get("/api/admin/settings", adminLimiter, authenticateAdmin, async (req, res) => {
    try { let settings = await Settings.findOne({ configId: "global" }); if (!settings) settings = await Settings.save({ configId: "global" }); res.json(settings); }
    catch (err) { res.status(500).json({ error: err.message }); }
  });

  app.post("/api/admin/settings", adminLimiter, authenticateAdmin, requireAdmin, async (req, res) => {
    try {
      const update = req.body.updates || req.body;
      const settings = await Settings.findOneAndUpdate({ configId: "global" }, { $set: update }, { new: true, upsert: true });
      res.json(settings);
    } catch (err) { res.status(500).json({ error: err.message }); }
  });

  app.get("/api/admin/stats", adminLimiter, authenticateAdmin, async (req, res) => {
    try {
      const totalOrders = await Order.countDocuments();
      const totalRevenueResult = await Order.aggregate([{ $group: { _id: null, total: { $sum: "$totalAmount" } } }]);
      const totalCustomers = await User.countDocuments();
      const totalMessages = await Message.countDocuments();
      const conversionRate = totalCustomers > 0 ? ((totalOrders / totalCustomers) * 100).toFixed(2) : 0;
      const sevenDaysAgo = new Date(); sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
      const dailyVolume = await Message.aggregate([{ $match: { createdAt: { $gte: sevenDaysAgo } } }, { $group: { _id: { $dateToString: { format: "%Y-%m-%d", date: "$createdAt" } }, count: { $sum: 1 } } }, { $sort: { "_id": 1 } }]);
      const platformStats = await User.aggregate([{ $group: { _id: "$platform", count: { $sum: 1 } } }]);
      res.json({
        stats: { orders: { value: totalOrders, change: "+10%", up: true }, revenue: { value: totalRevenueResult.length > 0 ? totalRevenueResult[0].total : 0, change: "+5%", up: true }, customers: { value: totalCustomers, change: "+12%", up: true }, messages: { value: totalMessages, change: "+8%", up: true }, conversionRate: { value: `${conversionRate}%`, change: "+2%", up: true } },
        dailyVolume: dailyVolume.map(d => ({ day: d._id, messages: d.count })),
        platformDistribution: platformStats.map(p => ({ name: p._id, value: p.count }))
      });
    } catch (err) { res.status(500).json({ error: err.message }); }
  });

  app.get("/api/admin/stats/real", adminLimiter, authenticateAdmin, async (req, res) => {
    try {
      const totalOrders = await Order.countDocuments();
      const totalRevenueResult = await Order.aggregate([{ $group: { _id: null, total: { $sum: "$totalAmount" } } }]);
      const totalCustomers = await User.countDocuments();
      const totalRevenue = totalRevenueResult.length > 0 ? totalRevenueResult[0].total : 0;
      const avgOrderValue = totalOrders > 0 ? totalRevenue / totalOrders : 0;
      const today = new Date(); today.setHours(0, 0, 0, 0);
      const messagesToday = await Message.countDocuments({ createdAt: { $gte: today } });
      const sevenDaysAgo = new Date(); sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
      const revenueByDay = await Order.aggregate([{ $match: { createdAt: { $gte: sevenDaysAgo } } }, { $group: { _id: { $dateToString: { format: "%Y-%m-%d", date: "$createdAt" } }, revenue: { $sum: "$totalAmount" }, orders: { $sum: 1 } } }, { $sort: { "_id": 1 } }]);
      const platformBreakdown = await User.aggregate([{ $group: { _id: "$platform", count: { $sum: 1 } } }]).then(r => r.map(x => ({ platform: x._id, count: x.count })));
      // Include queue stats
      const queueStats = await getQueueStats().catch(() => ({}));
      res.json({ totalCustomers, totalOrders, totalRevenue, avgOrderValue, messagesToday, revenueByDay: revenueByDay.map(d => ({ day: d._id, revenue: d.revenue, orders: d.orders })), platformBreakdown, queueStats });
    } catch (err) { res.status(500).json({ error: err.message }); }
  });

  app.put("/api/admin/orders/:id/status", adminLimiter, authenticateAdmin, async (req, res) => {
    try {
      const { status } = req.body;
      const validStatuses = ["pending", "confirmed", "shipped", "delivered", "cancelled"];
      if (!validStatuses.includes(status)) return res.status(400).json({ error: "Invalid status" });
      const order = await Order.findByIdAndUpdate(req.params.id, { status }, { new: true });
      if (!order) return res.status(404).json({ error: "Order not found" });
      res.json({ success: true, order });
    } catch (err) { res.status(500).json({ error: err.message }); }
  });

  app.put("/api/admin/customers/:id/notes", adminLimiter, authenticateAdmin, async (req, res) => {
    try {
      const { notes } = req.body;
      const user = await User.findOneAndUpdate({ uid: req.params.id }, { $set: { "metadata.notes": notes } }, { new: true });
      if (!user) return res.status(404).json({ error: "Customer not found" });
      res.json({ success: true, notes: user.metadata?.notes });
    } catch (err) { res.status(500).json({ error: err.message }); }
  });

  app.put("/api/admin/customers/:id/tags", adminLimiter, authenticateAdmin, async (req, res) => {
    try {
      const { tags } = req.body;
      const user = await User.findOneAndUpdate({ uid: req.params.id }, { $set: { "metadata.tags": tags } }, { new: true });
      if (!user) return res.status(404).json({ error: "Customer not found" });
      res.json({ success: true, tags: user.metadata?.tags });
    } catch (err) { res.status(500).json({ error: err.message }); }
  });

  // ── GDPR: Delete user messages (right to erasure) ───────────
  app.delete("/api/users/:uid/messages", adminLimiter, authenticateAdmin, async (req, res) => {
    try {
      const { uid } = req.params;
      const result = await deleteUserMessages(uid);
      res.json({ success: true, deleted: result.deleted });
    } catch (err) { res.status(500).json({ error: err.message }); }
  });

  // ── DATA RETENTION: Manual purge endpoint ────────────────────
  app.post("/api/admin/data-retention/purge", adminLimiter, authenticateAdmin, async (req, res) => {
    try {
      const { days } = req.body;
      const result = await purgeExpiredMessages(days || 30);
      res.json(result);
    } catch (err) { res.status(500).json({ error: err.message }); }
  });

  app.put("/api/admin/settings/ai-model", adminLimiter, authenticateAdmin, async (req, res) => {
    try {
      const { model } = req.body;
      const settings = await Settings.findOneAndUpdate({ configId: "global" }, { $set: { primaryModel: model } }, { new: true, upsert: true });
      res.json({ success: true, model: settings.primaryModel });
    } catch (err) { res.status(500).json({ error: err.message }); }
  });

  app.get("/api/export/customers", adminLimiter, authenticateAdmin, async (req, res) => {
    try {
      const users = await User.find().sort({ lastSeen: -1 });
      const rows = [["ID", "Name", "Platform", "Email", "Phone", "Tags", "Orders", "Total Spent", "Last Active"]];
      for (const u of users) {
        const orderCount = await Order.countDocuments({ uid: u.uid });
        const totalSpent = await Order.aggregate([{ $match: { uid: u.uid } }, { $group: { _id: null, total: { $sum: "$totalAmount" } } }]);
        rows.push([u.uid, u.name || "", u.platform, u.email || "", u.phone || "", (u.metadata?.tags || []).join("; "), orderCount, totalSpent.length > 0 ? totalSpent[0].total : 0, u.lastSeen ? u.lastSeen.toISOString() : ""]);
      }
      const csv = rows.map(r => r.map(c => `"${String(c).replace(/"/g, '""')}"`).join(",")).join("\n");
      res.setHeader("Content-Type", "text/csv");
      res.setHeader("Content-Disposition", "attachment; filename=customers.csv");
      res.send(csv);
    } catch (err) { res.status(500).json({ error: err.message }); }
  });

  app.get("/api/export/orders", adminLimiter, authenticateAdmin, async (req, res) => {
    try {
      const orders = await Order.find().sort({ createdAt: -1 });
      const rows = [["Order ID", "Customer", "Platform", "Items", "Total", "Status", "Date"]];
      for (const o of orders) {
        rows.push([o.id, o.customerName || o.uid, o.platform || "unknown", o.details || "", o.totalAmount, o.status, o.createdAt ? new Date(o.createdAt).toISOString() : ""]);
      }
      const csv = rows.map(r => r.map(c => `"${String(c).replace(/"/g, '""')}"`).join(",")).join("\n");
      res.setHeader("Content-Type", "text/csv");
      res.setHeader("Content-Disposition", "attachment; filename=orders.csv");
      res.send(csv);
    } catch (err) { res.status(500).json({ error: err.message }); }
  });

  app.get("/api/admin/search", adminLimiter, authenticateAdmin, async (req, res) => {
    try {
      const { q } = req.query;
      if (!q || q.length < 2) return res.json({ customers: [], orders: [], messages: [] });
      const regex = new RegExp(q, "i");
      const customers = await User.find({ $or: [{ name: regex }, { uid: regex }, { email: regex }, { phone: regex }] }).limit(10);
      const orders = await Order.find({ $or: [{ customerName: regex }, { uid: regex }, { details: regex }] }).limit(10);
      const messages = await Message.find({ content: regex }).limit(20);
      res.json({ customers: customers.map(c => ({ id: c.uid, name: c.name, platform: c.platform })), orders: orders.map(o => ({ id: o.id, customer: o.customerName, status: o.status })), messages: messages.map(m => ({ uid: m.uid, content: m.content, role: m.role })) });
    } catch (err) { res.status(500).json({ error: err.message }); }
  });

  app.get("/api/admin/notifications", adminLimiter, authenticateAdmin, async (req, res) => { try { res.json([]); } catch (err) { res.status(500).json({ error: err.message }); } });
  app.put("/api/admin/notifications/:id/read", adminLimiter, authenticateAdmin, async (req, res) => { try { res.json({ success: true }); } catch (err) { res.status(500).json({ error: err.message }); } });
  app.get("/api/admin/audit-logs", adminLimiter, authenticateAdmin, async (req, res) => { try { res.json([]); } catch (err) { res.status(500).json({ error: err.message }); } });

  app.get("/api/admin/team", adminLimiter, authenticateAdmin, async (req, res) => {
    try { const admins = await Admin.find({}).select("-password"); res.json(admins); }
    catch (err) { res.status(500).json({ error: err.message }); }
  });

  app.post("/api/admin/team/invite", adminLimiter, authenticateAdmin, requireAdmin, async (req, res) => {
    try {
      const { username, password, role } = req.body;
      const hashedPassword = await bcrypt.hash(password, 10);
      const admin = await Admin.save({ username, password: hashedPassword, role: role || "agent" });
      res.json({ success: true, admin: { username: admin.username, role: admin.role } });
    } catch (err) { res.status(500).json({ error: err.message }); }
  });

  app.delete("/api/admin/team/:id", adminLimiter, authenticateAdmin, requireAdmin, async (req, res) => {
    try { await Admin.findByIdAndDelete(req.params.id); res.json({ success: true }); }
    catch (err) { res.status(500).json({ error: err.message }); }
  });

  // ── FEEDBACK & AI LEARNING ENDPOINTS ────────────────────────────────
  app.post("/api/admin/feedback", adminLimiter, authenticateAdmin, async (req, res) => {
    try {
      const { messageId, uid, platform, rating, userMessage, aiResponse, correctedResponse, feedback, tags } = req.body;
      const entry = await Feedback.save({ messageId, uid, platform, rating, userMessage, aiResponse, correctedResponse, feedback, tags });
      res.json({ success: true, feedback: entry });
    } catch (err) { res.status(500).json({ error: err.message }); }
  });

  app.get("/api/admin/feedback", adminLimiter, authenticateAdmin, async (req, res) => {
    try {
      const { uid, rating, limit = 50 } = req.query;
      const filter = {};
      if (uid) filter.uid = uid;
      if (rating) filter.rating = parseInt(rating);
      const feedback = await Feedback.find(filter).sort({ createdAt: -1 }).limit(parseInt(limit));
      res.json(feedback);
    } catch (err) { res.status(500).json({ error: err.message }); }
  });

  app.get("/api/admin/feedback/stats", adminLimiter, authenticateAdmin, async (req, res) => {
    try {
      const { days = 30 } = req.query;
      const startDate = new Date();
      startDate.setDate(startDate.getDate() - parseInt(days));

      const stats = await Feedback.aggregate([
        { $match: { createdAt: { $gte: startDate } } },
        { $group: {
            _id: null,
            count: { $sum: 1 },
            avgRating: { $avg: "$rating" },
            byRating: {
              1: { $sum: { $cond: [{ $eq: ["$rating", 1] }, 1, 0] } },
              2: { $sum: { $cond: [{ $eq: ["$rating", 2] }, 1, 0] } },
              3: { $sum: { $cond: [{ $eq: ["$rating", 3] }, 1, 0] } },
              4: { $sum: { $cond: [{ $eq: ["$rating", 4] }, 1, 0] } },
              5: { $sum: { $cond: [{ $eq: ["$rating", 5] }, 1, 0] } }
            }
          }
        }
      ]);

      const failurePatterns = await identifyFailurePatterns(parseInt(days));
      const suggestions = await suggestKnowledgeAdditions(parseInt(days));

      res.json({
        count: stats[0]?.count || 0,
        avgRating: stats[0]?.avgRating?.toFixed(2) || 0,
        distribution: stats[0]?.byRating || { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 },
        failurePatterns,
        suggestions
      });
    } catch (err) { res.status(500).json({ error: err.message }); }
  });

  app.get("/api/admin/analytics", adminLimiter, authenticateAdmin, async (req, res) => {
    try {
      const { days = 30 } = req.query;
      const daysNum = parseInt(days);
      const since = new Date();
      since.setDate(since.getDate() - daysNum);

      const totalMessages = await Message.countDocuments({ createdAt: { $gte: since } });
      const uniqueCustomers = await User.countDocuments({ createdAt: { $gte: since } });

      const messagesByDay = await Message.aggregate([
        { $match: { createdAt: { $gte: since } } },
        { $group: { _id: { $dateToString: { format: "%Y-%m-%d", date: "$createdAt" } }, count: { $sum: 1 } } },
        { $sort: { _id: 1 } },
      ]);

      const platformBreakdown = await User.aggregate([
        { $group: { _id: "$platform", count: { $sum: 1 } } },
      ]).then((r) => r.reduce((acc, x) => { acc[x._id || "unknown"] = x.count; return acc; }, {}));

      res.json({
        totalMessages,
        uniqueCustomers,
        avgResponseTime: "< 1s",
        messagesByDay: messagesByDay.map((d) => ({ date: d._id, count: d.count })),
        platformBreakdown,
      });
    } catch (err) { res.status(500).json({ error: err.message }); }
  });

  app.get("/api/admin/analytics/conversations", adminLimiter, authenticateAdmin, async (req, res) => {
    try {
      const { days = 7 } = req.query;
      const endDate = new Date();
      const startDate = new Date();
      startDate.setDate(startDate.getDate() - parseInt(days));

      const analysis = await analyzeConversations(startDate, endDate);
      res.json(analysis);
    } catch (err) { res.status(500).json({ error: err.message }); }
  });

  app.get("/api/admin/fine-tuning/export", adminLimiter, authenticateAdmin, async (req, res) => {
    try {
      const { days = 90, minRating = 4, format = "json" } = req.query;
      const result = await exportFineTuningData(parseInt(days), parseInt(minRating));

      if (format === "jsonl") {
        res.setHeader("Content-Type", "application/x-jsonlines");
        res.setHeader("Content-Disposition", "attachment; filename=fine-tuning-data.jsonl");
        res.send(result.jsonl);
      } else {
        res.json({ count: result.count, data: result.data });
      }
    } catch (err) { res.status(500).json({ error: err.message }); }
  });

  app.get("/api/admin/ai-performance", adminLimiter, authenticateAdmin, async (req, res) => {
    try {
      const { days = 30 } = req.query;
      const startDate = new Date();
      startDate.setDate(startDate.getDate() - parseInt(days));

      let totalConversations = 0;
      try { totalConversations = await Message.distinct("uid", { createdAt: { $gte: startDate } }).then(r => r.length); } catch(e) { console.warn("ai-perf distinct:", e.message); }

      let feedbackStats = [];
      try { feedbackStats = await Feedback.aggregate([
        { $match: { createdAt: { $gte: startDate } } },
        { $group: { _id: null, count: { $sum: 1 }, avgRating: { $avg: "$rating" } } }
      ]); } catch(e) { console.warn("ai-perf feedback agg:", e.message); }

      let handoffs = 0;
      try {
        const handoffUsers = await User.find({ metadata: { $contains: { handoffStatus: "human_requested" } } });
        const assignedUsers = await User.find({ metadata: { $contains: { handoffStatus: "human_assigned" } } });
        handoffs = handoffUsers.length + assignedUsers.length;
      } catch(e) { console.warn("ai-perf handoffs:", e.message); }

      let complaints = 0;
      try { complaints = await Feedback.countDocuments({ tags: { $contains: ["complaint"] }, createdAt: { $gte: startDate } }); } catch(e) { console.warn("ai-perf complaints:", e.message); }

      let orders = 0;
      try { orders = await Order.countDocuments({ createdAt: { $gte: startDate } }); } catch(e) { console.warn("ai-perf orders:", e.message); }

      let revenue = 0;
      try {
        const revenueResult = await Order.aggregate([
          { $match: { createdAt: { $gte: startDate } } },
          { $group: { _id: null, total: { $sum: "$totalAmount" } } }
        ]);
        revenue = revenueResult[0]?.total || 0;
      } catch(e) { console.warn("ai-perf revenue:", e.message); }

      const automationRate = totalConversations > 0 ? (((totalConversations - handoffs) / totalConversations) * 100).toFixed(1) : 0;

      res.json({
        totalConversations,
        automationRate: parseFloat(automationRate),
        avgRating: feedbackStats[0]?.avgRating?.toFixed(2) || 0,
        feedbackCount: feedbackStats[0]?.count || 0,
        handoffs,
        complaints,
        orders,
        revenue
      });
    } catch (err) { res.status(500).json({ error: err.message }); }
  });
}

module.exports = { registerAdminRoutes };