/**
 * src/routes/products.js
 * Public catalog API (tenant-scoped via withPublicTenant) + admin product CRUD.
 */
const { Product } = require("../config/db");
const { resolveTenantFromRequest } = require("../utils/tenantResolve");
const { runWithTenantContext } = require("../../utils/tenantContext");

async function withPublicTenant(req, res, next) {
  const tenantInfo = await resolveTenantFromRequest(req);
  if (!tenantInfo || !tenantInfo.tenant_id) {
    return res.status(400).json({ error: "tenant required: pass ?tenant= or X-Tenant-ID header" });
  }
  return runWithTenantContext({ tenant_id: tenantInfo.tenant_id, role: "admin" }, next);
}

function registerProductsRoutes(app, { adminLimiter, authenticateAdmin, requireAdmin }) {
  if (!app || typeof app.get !== "function") {
    throw new Error("registerProductsRoutes requires an Express app");
  }
  if (app.__productsRoutesRegistered) return;
  app.__productsRoutesRegistered = true;

  app.get("/api/products", withPublicTenant, async (req, res) => {
    try {
      const products = await Product.find({ isActive: true }).sort({ category: 1, createdAt: -1 });
      res.json(products);
    } catch (err) { res.status(500).json({ error: err.message }); }
  });

  app.get("/api/products/category/:category", withPublicTenant, async (req, res) => {
    try {
      const products = await Product.find({ category: req.params.category, isActive: true });
      res.json(products);
    } catch (err) { res.status(500).json({ error: err.message }); }
  });

  app.get("/api/admin/products", adminLimiter, authenticateAdmin, async (req, res) => {
    try {
      const { category, isActive, search } = req.query;
      const filter = {};
      if (category) filter.category = category;
      if (isActive !== undefined) filter.isActive = isActive === "true";
      const products = await Product.find(filter).sort({ category: 1, createdAt: -1 });
      if (search) {
        const q = search.toLowerCase();
        return res.json(products.filter(p =>
          (p.name && p.name.toLowerCase().includes(q)) ||
          (p.description && p.description.toLowerCase().includes(q))
        ));
      }
      res.json(products);
    } catch (err) { res.status(500).json({ error: err.message }); }
  });

  app.get("/api/admin/products/:id", adminLimiter, authenticateAdmin, async (req, res) => {
    try {
      const product = await Product.findOne({ id: req.params.id });
      if (!product) return res.status(404).json({ error: "Product not found" });
      res.json(product);
    } catch (err) { res.status(500).json({ error: err.message }); }
  });

  app.post("/api/admin/products", adminLimiter, authenticateAdmin, requireAdmin, async (req, res) => {
    try {
      const { name, description, price, category, image, imageUrl, keywords, inStock, isActive } = req.body;
      if (!name || price === undefined) {
        return res.status(400).json({ error: "name and price are required" });
      }
      const product = await Product.create({
        name,
        description: description || "",
        price: Number(price),
        category: category || "products",
        image: image || "",
        imageUrl: imageUrl || "",
        keywords: keywords || [],
        inStock: inStock !== false,
        isActive: isActive !== false
      });
      console.log(`[Admin] Product created: ${product.name} (ID: ${product.id})`);
      res.status(201).json({ success: true, product });
    } catch (err) { res.status(500).json({ error: err.message }); }
  });

  app.put("/api/admin/products/:id", adminLimiter, authenticateAdmin, requireAdmin, async (req, res) => {
    try {
      const existing = await Product.findOne({ id: req.params.id });
      if (!existing) return res.status(404).json({ error: "Product not found" });

      const updates = {};
      const allowed = ["name", "description", "price", "category", "image", "imageUrl", "keywords", "inStock", "isActive"];
      for (const key of allowed) {
        if (req.body[key] !== undefined) updates[key] = req.body[key];
      }
      if (updates.price !== undefined) updates.price = Number(updates.price);

      await Product.findOneAndUpdate({ id: req.params.id }, { $set: updates });
      const updated = await Product.findOne({ id: req.params.id });
      console.log(`[Admin] Product updated: ${updated.name} (ID: ${updated.id})`);
      res.json({ success: true, product: updated });
    } catch (err) { res.status(500).json({ error: err.message }); }
  });

  app.delete("/api/admin/products/:id", adminLimiter, authenticateAdmin, requireAdmin, async (req, res) => {
    try {
      const product = await Product.findOne({ id: req.params.id });
      if (!product) return res.status(404).json({ error: "Product not found" });

      await Product.findOneAndUpdate({ id: req.params.id }, { $set: { isActive: false } });
      console.log(`[Admin] Product soft-deleted: ${product.name} (ID: ${product.id})`);
      res.json({ success: true, message: "Product deactivated" });
    } catch (err) { res.status(500).json({ error: err.message }); }
  });

  app.put("/api/admin/products/:id/restore", adminLimiter, authenticateAdmin, async (req, res) => {
    try {
      const product = await Product.findOne({ id: req.params.id });
      if (!product) return res.status(404).json({ error: "Product not found" });

      await Product.findOneAndUpdate({ id: req.params.id }, { $set: { isActive: true } });
      console.log(`[Admin] Product restored: ${product.name} (ID: ${product.id})`);
      res.json({ success: true, product: await Product.findOne({ id: req.params.id }) });
    } catch (err) { res.status(500).json({ error: err.message }); }
  });
}

module.exports = { registerProductsRoutes };