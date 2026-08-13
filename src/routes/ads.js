/**
 * src/routes/ads.js
 * Ad system admin API: list, clicks, upsert, status, stats, delete.
 */
const { Ad, AdClick } = require("../config/db");
const { getAdPerformance, getRecentClicks } = require("../../utils/adTracking");

function registerAdsRoutes(app, { adminLimiter, authenticateAdmin, requireAdmin }) {
  if (!app || typeof app.get !== "function") {
    throw new Error("registerAdsRoutes requires an Express app");
  }
  if (app.__adsRoutesRegistered) return;
  app.__adsRoutesRegistered = true;

  app.get("/api/admin/ads", adminLimiter, authenticateAdmin, async (req, res) => {
    try {
      const { days = 30 } = req.query;
      const performance = await getAdPerformance(parseInt(days));
      res.json(performance);
    } catch (err) { res.status(500).json({ error: err.message }); }
  });

  app.get("/api/admin/ads/clicks", adminLimiter, authenticateAdmin, async (req, res) => {
    try {
      const { limit = 50 } = req.query;
      const clicks = await getRecentClicks(parseInt(limit));
      res.json(clicks);
    } catch (err) { res.status(500).json({ error: err.message }); }
  });

  app.post("/api/admin/ads", adminLimiter, authenticateAdmin, requireAdmin, async (req, res) => {
    try {
      const { adId, campaignId, campaignName, adSetName, adName, platform, creative, targeting, costPerClick, status } = req.body;
      const ad = await Ad.findOneAndUpdate(
        { adId },
        { adId, campaignId, campaignName, adSetName, adName, platform, creative, targeting, costPerClick, status, updatedAt: new Date() },
        { upsert: true, new: true }
      );
      res.json({ success: true, ad });
    } catch (err) { res.status(500).json({ error: err.message }); }
  });

  app.patch("/api/admin/ads/:adId/status", adminLimiter, authenticateAdmin, requireAdmin, async (req, res) => {
    try {
      const { status } = req.body;
      const ad = await Ad.findOneAndUpdate(
        { adId: req.params.adId },
        { status, updatedAt: new Date() },
        { new: true }
      );
      if (!ad) return res.status(404).json({ error: "Ad not found" });
      res.json({ success: true, ad });
    } catch (err) { res.status(500).json({ error: err.message }); }
  });

  app.get("/api/admin/ads/stats", adminLimiter, authenticateAdmin, async (req, res) => {
    try {
      const { days = 30 } = req.query;
      const startDate = new Date();
      startDate.setDate(startDate.getDate() - parseInt(days));

      const totalAds = await Ad.countDocuments({ status: { $in: ["active", "paused"] } });
      const totalClicks = await AdClick.countDocuments({ clickedAt: { $gte: startDate } });
      const totalConversions = await AdClick.countDocuments({ conversationStarted: true, clickedAt: { $gte: startDate } });
      const conversionRate = totalClicks > 0 ? ((totalConversions / totalClicks) * 100).toFixed(1) : 0;

      const revenueClicks = await AdClick.find({ orderPlaced: true, clickedAt: { $gte: startDate } });
      const totalRevenue = revenueClicks.reduce((sum, c) => sum + (parseFloat(c.revenue) || 0), 0);

      const topAds = await Ad.find({ status: { $in: ["active", "paused"] } })
        .sort({ totalConversations: -1 })
        .limit(5);

      res.json({
        totalAds,
        totalClicks,
        totalConversions,
        conversionRate: parseFloat(conversionRate),
        totalRevenue,
        topAds
      });
    } catch (err) { res.status(500).json({ error: err.message }); }
  });

  app.delete("/api/admin/ads/:adId", adminLimiter, authenticateAdmin, requireAdmin, async (req, res) => {
    try {
      await Ad.deleteOne({ adId: req.params.adId });
      await AdClick.deleteMany({ adId: req.params.adId });
      res.json({ success: true });
    } catch (err) { res.status(500).json({ error: err.message }); }
  });
}

module.exports = { registerAdsRoutes };