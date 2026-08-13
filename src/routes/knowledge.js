/**
 * src/routes/knowledge.js
 * Knowledge base admin API: CRUD, business-info, multipart upload, reindex.
 */
const { KnowledgeBase } = require("../config/db");
const { indexAllKnowledge } = require("../../utils/rag");

function registerKnowledgeRoutes(app, { adminLimiter, authenticateAdmin, requireAdmin }) {
  if (!app || typeof app.get !== "function") {
    throw new Error("registerKnowledgeRoutes requires an Express app");
  }
  if (app.__knowledgeRoutesRegistered) return;
  app.__knowledgeRoutesRegistered = true;

  // GET entries (optional ?type=business_info|rag filter)
  app.get("/api/admin/knowledge", adminLimiter, authenticateAdmin, async (req, res) => {
    try {
      const filter = {};
      if (req.query.type) filter.type = req.query.type;
      const entries = await KnowledgeBase.find(filter).sort({ createdAt: -1 });
      res.json(entries);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // GET business_info entries only (for AI system prompt)
  app.get("/api/admin/knowledge/business-info", adminLimiter, authenticateAdmin, async (req, res) => {
    try {
      const entries = await KnowledgeBase.find({ type: "business_info", isActive: true }).sort({ createdAt: -1 });
      res.json(entries);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // POST create entry (supports type: "business_info" | "rag")
  app.post("/api/admin/knowledge", adminLimiter, authenticateAdmin, requireAdmin, async (req, res) => {
    try {
      const { title, content, category, tags, type } = req.body;
      if (!title || !content) return res.status(400).json({ error: "Title and content are required" });
      const entry = await KnowledgeBase.save({
        title,
        content,
        category: category || "general",
        tags: tags || [],
        type: type || "rag",
        isActive: true
      });
      res.json({ success: true, entry });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // PUT update entry
  app.put("/api/admin/knowledge/:id", adminLimiter, authenticateAdmin, requireAdmin, async (req, res) => {
    try {
      const { title, content, category, tags, type, isActive } = req.body;
      const update = {};
      if (title !== undefined) update.title = title;
      if (content !== undefined) update.content = content;
      if (category !== undefined) update.category = category;
      if (tags !== undefined) update.tags = tags;
      if (type !== undefined) update.type = type;
      if (isActive !== undefined) update.isActive = isActive;
      update.updatedAt = new Date().toISOString();
      const entry = await KnowledgeBase.findByIdAndUpdate(req.params.id, { $set: update });
      res.json({ success: true, entry });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // DELETE entry
  app.delete("/api/admin/knowledge/:id", adminLimiter, authenticateAdmin, requireAdmin, async (req, res) => {
    try {
      await KnowledgeBase.findByIdAndDelete(req.params.id);
      res.json({ success: true });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // POST upload file as knowledge entry (txt, md, csv)
  app.post("/api/admin/knowledge/upload", adminLimiter, authenticateAdmin, async (req, res) => {
    try {
      const chunks = [];
      req.on("data", chunk => chunks.push(chunk));
      req.on("end", async () => {
        try {
          const raw = Buffer.concat(chunks).toString("utf8");

          // Parse multipart form data manually
          const contentType = req.headers["content-type"] || "";
          if (!contentType.includes("multipart/form-data")) {
            return res.status(400).json({ error: "Expected multipart/form-data" });
          }

          const boundary = contentType.split("boundary=")[1];
          if (!boundary) return res.status(400).json({ error: "Missing boundary" });

          const parts = raw.split("--" + boundary);
          let fileContent = "";
          let fileName = "uploaded-file.txt";
          let fileType = "rag";

          for (const part of parts) {
            if (!part.includes("Content-Disposition")) continue;
            const [headerSection, ...bodyParts] = part.split("\r\n\r\n");
            const body = bodyParts.join("\r\n\r\n").replace(/\r\n--$/, "").trim();

            if (headerSection.includes('name="file"')) {
              const nameMatch = headerSection.match(/filename="(.+?)"/);
              if (nameMatch) fileName = nameMatch[1];
              fileContent = body;
            } else if (headerSection.includes('name="type"')) {
              fileType = body.trim();
            }
          }

          if (!fileContent) {
            return res.status(400).json({ error: "No file content provided" });
          }

          // Split large files into chunks of ~4000 chars for knowledge entries
          const MAX_CHUNK = 4000;
          const entries = [];
          if (fileContent.length <= MAX_CHUNK) {
            const entry = await KnowledgeBase.save({
              title: fileName,
              content: fileContent,
              category: "uploaded",
              tags: [],
              type: fileType,
              isActive: true
            });
            entries.push(entry);
          } else {
            // Split into chunks
            const lines = fileContent.split("\n");
            let chunk = "";
            let chunkIndex = 1;
            for (const line of lines) {
              if ((chunk + "\n" + line).length > MAX_CHUNK && chunk) {
                const entry = await KnowledgeBase.save({
                  title: `${fileName} (part ${chunkIndex})`,
                  content: chunk.trim(),
                  category: "uploaded",
                  tags: [],
                  type: fileType,
                  isActive: true
                });
                entries.push(entry);
                chunkIndex++;
                chunk = line;
              } else {
                chunk += "\n" + line;
              }
            }
            if (chunk.trim()) {
              const entry = await KnowledgeBase.save({
                title: `${fileName} (part ${chunkIndex})`,
                content: chunk.trim(),
                category: "uploaded",
                tags: [],
                type: fileType,
                isActive: true
              });
              entries.push(entry);
            }
          }

          res.json({ success: true, entries, count: entries.length });
        } catch (err) {
          res.status(500).json({ error: err.message });
        }
      });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post("/api/admin/knowledge/reindex", adminLimiter, authenticateAdmin, async (req, res) => {
    try {
      await indexAllKnowledge();
      res.json({ success: true, message: "Knowledge base reindexed" });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });
}

module.exports = { registerKnowledgeRoutes };