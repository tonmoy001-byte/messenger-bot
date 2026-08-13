/**
 * src/routes/integrations.js
 * Social integrations (Facebook/Instagram/WhatsApp) + e-commerce connections
 * (Shopify/WooCommerce) admin API.
 */
const { Integration, EcommerceConnection } = require("../config/db");

function registerIntegrationsRoutes(app, { adminLimiter, authenticateAdmin, requireAdmin }) {
  if (!app || typeof app.get !== "function") {
    throw new Error("registerIntegrationsRoutes requires an Express app");
  }
  if (app.__integrationsRoutesRegistered) return;
  app.__integrationsRoutesRegistered = true;

  app.get("/api/admin/integrations", adminLimiter, authenticateAdmin, async (req, res) => {
    try {
      // Get social media integrations (Facebook, Instagram, WhatsApp)
      const socialIntegrations = await Integration.find().select("-accessToken");
      
      // Get e-commerce connections (Shopify, WooCommerce)
      const ecommerceConnections = await EcommerceConnection.find();
      
      // Format e-commerce connections for frontend
      const shopify = ecommerceConnections.find(c => c.platform === "shopify");
      const woocommerce = ecommerceConnections.find(c => c.platform === "woocommerce");
      
      res.json({
        social: socialIntegrations,
        shopify: shopify ? { connected: true, ...shopify.toObject() } : { connected: false },
        woocommerce: woocommerce ? { connected: true, ...woocommerce.toObject() } : { connected: false }
      });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.delete("/api/admin/integrations/:id", authenticateAdmin, async (req, res) => {
    try {
      await Integration.findByIdAndDelete(req.params.id);
      res.json({ success: true });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post("/api/admin/integrations/shopify", adminLimiter, authenticateAdmin, requireAdmin, async (req, res) => {
    try {
      const { storeUrl, accessToken } = req.body;
      if (!storeUrl || !accessToken) return res.status(400).json({ error: "Store URL and access token are required" });
      
      const connection = await EcommerceConnection.findOneAndUpdate(
        { platform: "shopify" },
        { 
          platform: "shopify", 
          storeUrl, 
          accessToken,
          isActive: true,
          syncStatus: "never",
          connectedAt: new Date() 
        },
        { upsert: true, new: true }
      );
      res.json({ success: true, connection });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post("/api/admin/integrations/woocommerce", adminLimiter, authenticateAdmin, requireAdmin, async (req, res) => {
    try {
      const { storeUrl, consumerKey, consumerSecret } = req.body;
      if (!storeUrl || !consumerKey || !consumerSecret) return res.status(400).json({ error: "Store URL, consumer key, and secret are required" });
      
      const connection = await EcommerceConnection.findOneAndUpdate(
        { platform: "woocommerce" },
        { 
          platform: "woocommerce", 
          storeUrl, 
          consumerKey, 
          consumerSecret,
          isActive: true,
          syncStatus: "never",
          connectedAt: new Date() 
        },
        { upsert: true, new: true }
      );
      res.json({ success: true, connection });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });
}

module.exports = { registerIntegrationsRoutes };