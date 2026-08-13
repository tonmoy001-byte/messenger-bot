# Phase 2 Monolith Split Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Shrink the `index.js` god-file (1798 LOC, 68 inline route handlers) into `src/routes/*` modules with a single entry point (`src/server.js`), a composition root (`src/app.js`), and channel helpers under `src/services/channels/`. Behavior unchanged; all tests pass before and after.

**Architecture:** Style A module split — models/utils are required directly by each module (singletons); only genuinely runtime values (io, limiters, auth middleware, handler functions) are passed via the existing `register*Routes(app, deps)` signature (precedent: `chat.js`). `app.js` is the composition root (app + http server + socket.io + middleware + all registrations). `server.js` is the single owner of lifecycle (dotenv, env validation, Next.js prepare, init sequence, listen, graceful shutdown). `index.js` becomes a one-line re-export so `node index.js`, Docker, and `start-all.js` keep working.

**Tech Stack:** Node.js/Express, Socket.io, Next.js (dashboard served via catch-all), Supabase model layer, CommonJS.

**Execution note on route extraction tasks:** the route bodies are cut **verbatim** (zero edits) from `index.js`. Each extraction task uses **text anchors** (section-banner comments + route-path strings) rather than line numbers, because line numbers shift as blocks are removed. The "Reference lines" given per task are the committed baseline positions (`index.js`, 1798 lines) — they identify the block; the anchors are the source of truth for cutting. The module wrapper (requires + register signature + idempotency flag) is new code and is given in full in each task. After each cut, verify with `node --check`, the full test suite, and a boot smoke test.

**Canonical route inventory (baseline `index.js`), used by the route-audit acceptance gate:**

| Section banner | Routes (METHOD /path) |
|---|---|
| AUTH ROUTES (202–355) | POST /api/auth/signup, POST /api/auth/login, POST /api/auth/refresh, POST /api/auth/logout, GET /api/auth/meta/url, GET /api/auth/meta/callback |
| INTEGRATIONS (357–387) | GET /api/admin/integrations, DELETE /api/admin/integrations/:id |
| WEBHOOKS (389–593) | GET+POST /webhook/messenger, GET+POST /webhook/whatsapp, GET+POST /webhook/instagram |
| ADMIN DASHBOARD API (596–808) | GET /api/admin/conversations, GET /api/admin/messages/:uid, POST /api/admin/reply, GET /api/admin/orders, GET /api/admin/customers, GET /api/admin/settings, POST /api/admin/settings, GET /api/admin/stats, GET /api/admin/stats/real, PUT /api/admin/orders/:id/status, PUT /api/admin/customers/:id/notes, PUT /api/admin/customers/:id/tags, DELETE /api/users/:uid/messages, POST /api/admin/data-retention/purge, PUT /api/admin/settings/ai-model, GET /api/export/customers, GET /api/export/orders, GET /api/admin/search, GET /api/admin/notifications, PUT /api/admin/notifications/:id/read, GET /api/admin/audit-logs, GET /api/admin/team, POST /api/admin/team/invite, DELETE /api/admin/team/:id |
| MESSENGER/WHATSAPP/INSTAGRAM HANDLERS (810–1071) | (non-route; extracted to messageHandlers.js) |
| FEEDBACK & AI LEARNING (1073–1236) | POST /api/admin/feedback, GET /api/admin/feedback, GET /api/admin/feedback/stats, GET /api/admin/analytics, GET /api/admin/analytics/conversations, GET /api/admin/fine-tuning/export, GET /api/admin/ai-performance |
| AD SYSTEM (1238–1315) | GET /api/admin/ads, GET /api/admin/ads/clicks, POST /api/admin/ads, PATCH /api/admin/ads/:adId/status, GET /api/admin/ads/stats, DELETE /api/admin/ads/:adId |
| PUBLIC PRODUCTS + withPublicTenant (1317–1339) | GET /api/products, GET /api/products/category/:category |
| ADMIN PRODUCT CRUD (1341–1429) | GET /api/admin/products, GET /api/admin/products/:id, POST /api/admin/products, PUT /api/admin/products/:id, DELETE /api/admin/products/:id, PUT /api/admin/products/:id/restore |
| KNOWLEDGE BASE API (1431–1608) | GET /api/admin/knowledge, GET /api/admin/knowledge/business-info, POST /api/admin/knowledge, PUT /api/admin/knowledge/:id, DELETE /api/admin/knowledge/:id, POST /api/admin/knowledge/upload, POST /api/admin/knowledge/reindex |
| INTEGRATIONS API (1610–1656) | POST /api/admin/integrations/shopify, POST /api/admin/integrations/woocommerce |

Non-captured in the audit (not `get|post|put|patch|delete` with a literal path): `app.use('/api', …)`, `app.use('/webhook', …)` (404 handlers), `app.all("*", …)` (Next catch-all). They move to `app.js` verbatim.

**Routes registered by existing modules already (already in `src/routes/*.js`, included in audit on both sides):** GET /health, GET /ready (`health.js`); POST /api/orders/from-ai (`orders.js`); POST /api/chat (`chat.js`).

---

## File Structure

- **Create `scripts/route-audit.js`** — route-map snapshot/diff tool (acceptance gate for drift).
- **Create `scripts/route-snapshot.json`** — committed pre-split route multiset (Task 1).
- **Create `src/config/superadmin.js`** — `SUPERADMIN_CONTEXT` + `withSuperadmin` (from index.js:17-18).
- **Create `src/utils/tenantResolve.js`** — `resolveTenantFromRequest` (from `chat.js`).
- **Create `src/utils/webhookHelpers.js`** — `verifyWebhookToken` + `getTenantByChannel` (from index.js:21-59).
- **Create `src/utils/messageHelpers.js`** — `upsertUser` + `saveMessage` (from index.js:190-200).
- **Create `src/services/channels/messageHandlers.js`** — `createMessageHandlers({ io, upsertUser, saveMessage })` factory (3 inline handler blocks).
- **Create `src/routes/auth.js`, `webhooks.js`, `admin.js`, `products.js`, `knowledge.js`, `ads.js`, `integrations.js`** — extracted route modules.
- **Move** `messenger.js` → `src/services/channels/messenger.js`, `instagram.js` → `src/services/channels/instagram.js` (git mv).
- **Create `src/app.js`** — composition root `createApp({ nextHandle }) → { app, server, io }`.
- **Rewrite `src/server.js`** — single lifecycle owner.
- **Slim `index.js`** → `require("./src/server");`.
- **Modify** `src/routes/chat.js` (import resolver from `tenantResolve.js`, keep re-export aliases), `utils/worker.js` (channel-helper import paths), `tests/enforcement.test.js:149` (source-scan rework).

---

### Task 1: Route-audit script + committed pre-split snapshot

**Files:**
- Create: `scripts/route-audit.js`
- Create: `scripts/route-snapshot.json` (generated, committed)
- Test: none (no behavior change; run audit to produce artifact)

- [ ] **Step 1: Create `scripts/route-audit.js`**

```js
#!/usr/bin/env node
/**
 * scripts/route-audit.js
 * Route-map equality check for the Phase 2 monolith split.
 *   node scripts/route-audit.js snapshot   # scan index.js + src/routes/*.js -> scripts/route-snapshot.json
 *   node scripts/route-audit.js diff       # scan again, compare multiset to snapshot, exit 1 on mismatch
 */
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const SNAPSHOT_PATH = path.join(__dirname, "route-snapshot.json");
const ROUTES_DIR = path.join(ROOT, "src", "routes");
const INDEX_PATH = path.join(ROOT, "index.js");

const METHOD_RE = /app\.(get|post|put|patch|delete)\(\s*["'`]([^"'`]+)["'`]/g;

function scan() {
  const routes = [];
  const files = [
    INDEX_PATH,
    ...fs.readdirSync(ROUTES_DIR)
      .filter((f) => f.endsWith(".js"))
      .map((f) => path.join(ROUTES_DIR, f)),
  ];
  for (const file of files) {
    if (!fs.existsSync(file)) continue;
    const src = fs.readFileSync(file, "utf8");
    let m;
    while ((m = METHOD_RE.exec(src)) !== null) {
      routes.push(`${m[1].toUpperCase()} ${m[2]}`);
    }
  }
  return routes.sort();
}

function main() {
  const mode = process.argv[2] || "diff";
  if (mode === "snapshot") {
    fs.writeFileSync(SNAPSHOT_PATH, JSON.stringify(scan(), null, 2));
    console.log(`Route snapshot written: ${SNAPSHOT_PATH}`);
    return;
  }
  if (mode === "diff") {
    const before = JSON.parse(fs.readFileSync(SNAPSHOT_PATH, "utf8"));
    const after = scan();
    const count = (arr) => arr.reduce((acc, r) => { acc[r] = (acc[r] || 0) + 1; return acc; }, {});
    const b = count(before);
    const a = count(after);
    const keys = new Set([...Object.keys(b), ...Object.keys(a)]);
    const problems = [];
    for (const k of keys) {
      if ((b[k] || 0) !== (a[k] || 0)) {
        problems.push(`  ${k}: snapshot=${b[k] || 0} now=${a[k] || 0}`);
      }
    }
    if (problems.length === 0) {
      console.log(`Route audit OK: ${after.length} routes match snapshot.`);
      return;
    }
    console.error("Route audit MISMATCH:");
    problems.forEach((p) => console.error(p));
    process.exit(1);
  }
  console.error(`Unknown mode: ${mode} (use snapshot|diff)`);
  process.exit(1);
}

main();
```

- [ ] **Step 2: Generate and inspect the snapshot**

Run: `node scripts/route-audit.js snapshot`
Expected: prints `Route snapshot written: …\scripts\route-snapshot.json`. Then read the file — it must contain the 68 inline routes from the inventory plus `GET /health`, `GET /ready`, `POST /api/orders/from-ai`, `POST /api/chat` (72 total route strings).

- [ ] **Step 3: Commit**

```bash
git add scripts/route-audit.js scripts/route-snapshot.json
git commit -m "chore(audit): route-map snapshot/diff tool + pre-split snapshot"
```

---

### Task 2: Shared leaf helpers

Create four leaf modules (they require only config/utils — no routes, no app), then rewire `chat.js` and `index.js` to use them. This is the "no hidden globals" foundation.

**Files:**
- Create: `src/config/superadmin.js`
- Create: `src/utils/tenantResolve.js`
- Create: `src/utils/webhookHelpers.js`
- Create: `src/utils/messageHelpers.js`
- Modify: `src/routes/chat.js` (import resolver from new module, keep aliases)
- Modify: `index.js` (import helpers instead of defining inline)

- [ ] **Step 1: Create `src/config/superadmin.js`**

```js
/**
 * src/config/superadmin.js
 * Superadmin tenant-context bypass helper (single definition).
 */
const { runWithTenantContext } = require("../../utils/tenantContext");

const SUPERADMIN_CONTEXT = { role: "superadmin", isSuperAdmin: true, tenant_id: null };

function withSuperadmin(fn) {
  return runWithTenantContext(SUPERADMIN_CONTEXT, fn);
}

module.exports = { SUPERADMIN_CONTEXT, withSuperadmin };
```

- [ ] **Step 2: Create `src/utils/tenantResolve.js`**

Move `resolveTenantFromRequest` verbatim from `src/routes/chat.js:14-78` into this file. Replace the lazy `const { Tenant } = require("../config/db");` inside the function with a top-level require (same file already lives under `src/`, so the path `../config/db` is unchanged from chat.js's `../../config/db` → now one level shallower):

```js
/**
 * src/utils/tenantResolve.js
 * Shared tenant resolver (web chat widget + public products API).
 * Resolution order: body tenant_id/tenantId, X-Tenant-ID header,
 * body tenant/tenantSlug/slug/siteKey, X-Tenant-Slug / X-Site-Key headers,
 * query.tenant; non-production DEFAULT_TENANT_ID / DEFAULT_TENANT_SLUG fallback.
 */
const { Tenant } = require("../config/db");

async function resolveTenantFromRequest(req) {
  const body = req.body || {};
  const headers = req.headers || {};
  const query = req.query || {};

  const tenantId =
    body.tenant_id ||
    body.tenantId ||
    headers["x-tenant-id"] ||
    headers["X-Tenant-ID"] ||
    null;

  const tenantSlug =
    body.tenant ||
    body.tenantSlug ||
    body.slug ||
    body.siteKey ||
    body.site_key ||
    headers["x-tenant-slug"] ||
    headers["X-Tenant-Slug"] ||
    headers["x-site-key"] ||
    headers["X-Site-Key"] ||
    query.tenant ||
    null;

  if (tenantId) {
    const row = await Tenant.findOne({ id: String(tenantId) });
    if (row && !row.deleted_at && row.status !== "suspended") {
      return {
        tenant_id: String(row.id || row.tenant_id || tenantId),
        slug: row.slug || null,
      };
    }
    return null;
  }

  if (tenantSlug) {
    const row = await Tenant.findOne({
      slug: String(tenantSlug).trim().toLowerCase(),
    });
    if (row && !row.deleted_at && row.status !== "suspended") {
      return { tenant_id: String(row.id), slug: row.slug || String(tenantSlug) };
    }
    return null;
  }

  if (process.env.NODE_ENV !== "production") {
    const fallbackId = process.env.DEFAULT_TENANT_ID;
    const fallbackSlug = process.env.DEFAULT_TENANT_SLUG;
    if (fallbackId) {
      const row = await Tenant.findOne({ id: String(fallbackId) });
      if (row) return { tenant_id: String(row.id), slug: row.slug || null };
      return { tenant_id: String(fallbackId), slug: null };
    }
    if (fallbackSlug) {
      const row = await Tenant.findOne({
        slug: String(fallbackSlug).trim().toLowerCase(),
      });
      if (row) return { tenant_id: String(row.id), slug: row.slug || fallbackSlug };
    }
  }

  return null;
}

module.exports = { resolveTenantFromRequest };
```

- [ ] **Step 3: Create `src/utils/webhookHelpers.js`**

Move `verifyWebhookToken` + `getTenantByChannel` verbatim from `index.js:21-59` (adjusting db require path from `./src/config/db` to `../config/db`):

```js
/**
 * src/utils/webhookHelpers.js
 * Shared webhook verification + tenant-channel resolution (Messenger/WhatsApp/Instagram).
 */
const { Tenant, TenantChannel } = require("../config/db");
const channelCache = require("./channelCache");

async function verifyWebhookToken(req, platform, globalToken) {
  const mode = req.query["hub.mode"];
  const token = req.query["hub.verify_token"];

  if (mode !== "subscribe") return false;

  const tenantSlug = req.query.tenant;
  const reqPlatform = req.query.platform || platform;

  if (tenantSlug) {
    const tenant = await Tenant.findOne({ slug: tenantSlug });
    if (!tenant) return false;

    const channel = await TenantChannel.findOne({ tenant_id: tenant.id, platform: reqPlatform });
    if (!channel || channel.deleted_at) return false;

    return token === channel.verifyToken;
  }

  const fallbackToken = process.env.META_WEBHOOK_VERIFY_TOKEN || globalToken || process.env.VERIFY_TOKEN;
  return token === fallbackToken;
}

async function getTenantByChannel(platform, externalId) {
  const cached = channelCache.get(platform, externalId);
  if (cached) return cached;

  const channel = await TenantChannel.findOne({ platform, externalId, deleted_at: null });
  if (channel) {
    const data = {
      tenant_id: channel.tenant_id,
      verifyToken: channel.verifyToken,
      accessToken: channel.accessToken,
    };
    channelCache.set(platform, externalId, data);
    return data;
  }
  return null;
}

module.exports = { verifyWebhookToken, getTenantByChannel };
```

- [ ] **Step 4: Create `src/utils/messageHelpers.js`**

Move `upsertUser` + `saveMessage` verbatim from `index.js:190-200` (db path becomes `../config/db`):

```js
/**
 * src/utils/messageHelpers.js
 * Shared message persistence helpers (chat + channel handlers).
 */
const { User, Message } = require("../config/db");

async function upsertUser(uid, platform, name = null, profilePic = null) {
  await User.findOneAndUpdate(
    { uid },
    { $set: { platform, name: name || null, profilePic: profilePic || null, lastSeen: new Date() } },
    { upsert: true, new: true }
  );
}

async function saveMessage(uid, role, content, mediaUrl = null, platform = "messenger") {
  await Message.save({ uid, role, content, mediaUrl, platform, timestamp: new Date() });
}

module.exports = { upsertUser, saveMessage };
```

- [ ] **Step 5: Update `src/routes/chat.js`**

Replace the inline `resolveTenantFromRequest` definition (current lines 12–78) so chat.js imports it from `../utils/tenantResolve` and keeps both export aliases. New chat.js top of file:

```js
/**
 * src/routes/chat.js
 * Public website chat widget — tenant-scoped.
 * Tenant resolution lives in ../utils/tenantResolve (shared with products.js).
 */
const { runWithTenantContext } = require("../../utils/tenantContext");
const { resolveTenantFromRequest } = require("../utils/tenantResolve");

const resolveWebChatTenant = resolveTenantFromRequest;
```

Delete the whole old `async function resolveTenantFromRequest(req) { … }` block (anchors: from `async function resolveTenantFromRequest(req) {` through its closing `}` immediately before `const resolveWebChatTenant = resolveTenantFromRequest;`). Keep `resolveWebChatTenant`, the `registerChatRoutes` function, and the module exports unchanged (it still exports `registerChatRoutes`, `resolveWebChatTenant`, `resolveTenantFromRequest`).

- [ ] **Step 6: Update `index.js` to use the new helpers**

Edits:
1. Delete lines 17–18 (`const SUPERADMIN_CONTEXT = …;` and `const withSuperadmin = (fn) => …;`). Add near the other requires:
```js
const { withSuperadmin } = require("./src/config/superadmin");
```
2. Delete lines 21–59 (`async function verifyWebhookToken` + `async function getTenantByChannel`). Add:
```js
const { verifyWebhookToken, getTenantByChannel } = require("./src/utils/webhookHelpers");
```
3. Delete lines 190–200 (the `async function upsertUser` + `async function saveMessage` helper block). Add:
```js
const { upsertUser, saveMessage } = require("./src/utils/messageHelpers");
```

Place these three `require`s together with the existing helper requires near line 83–86 (after `registerHealthRoutes`/`registerOrderRoutes`/`registerChatRoutes` requires). `withSuperadmin`/`upsertUser`/`saveMessage` are still used later in `index.js` (login/refresh at 241/245/275, bootstrap at 1728, chatRoutes deps at 172–181) so no other change needed here.

- [ ] **Step 7: Verify**

Run: `node --check index.js; node --check src/utils/tenantResolve.js; node --check src/utils/webhookHelpers.js; node --check src/utils/messageHelpers.js; node --check src/config/superadmin.js; node --check src/routes/chat.js`
Expected: no output (clean syntax) for all six.

Run: `node --test "tests/*.test.js"`
Expected: 64 passing (chat.test.js and enforcement.test.js import `resolveWebChatTenant`/`resolveTenantFromRequest` from `src/routes/chat`, which still re-exports both).

Run: `node scripts/route-audit.js diff`
Expected: `Route audit OK: 72 routes match snapshot.` (no routes touched this task).

- [ ] **Step 8: Commit**

```bash
git add src/config/superadmin.js src/utils/tenantResolve.js src/utils/webhookHelpers.js src/utils/messageHelpers.js src/routes/chat.js index.js
git commit -m "refactor(helpers): extract superadmin, tenantResolve, webhookHelpers, messageHelpers"
```

---

### Task 3: Move channel helpers under `src/services/channels/`

**Files:**
- Move: `messenger.js` → `src/services/channels/messenger.js`
- Move: `instagram.js` → `src/services/channels/instagram.js`
- Modify: `index.js` (import paths, lines 62 and 64)
- Modify: `utils/worker.js` (import paths, lines 11 and 13)

- [ ] **Step 1: Move the files with git mv**

Run: `git mv messenger.js src/services/channels/messenger.js; git mv instagram.js src/services/channels/instagram.js`
Expected: no output; both files now under `src/services/channels/`.

- [ ] **Step 2: Update importers**

`index.js`:
```js
// was: const { sendMessage, sendTyping, getUserProfile, downloadExternalMedia } = require("./messenger");
const { sendMessage, sendTyping, getUserProfile, downloadExternalMedia } = require("./src/services/channels/messenger");
// was: const { sendInstagramMessage, sendInstagramTyping, downloadInstagramMedia, getInstagramUserProfile } = require("./instagram");
const { sendInstagramMessage, sendInstagramTyping, downloadInstagramMedia, getInstagramUserProfile } = require("./src/services/channels/instagram");
```

`utils/worker.js`:
```js
// was: const { sendMessage: sendMessenger, sendTyping } = require("../messenger");
const { sendMessage: sendMessenger, sendTyping } = require("../src/services/channels/messenger");
// was: const { sendInstagramMessage, sendInstagramTyping } = require("../instagram");
const { sendInstagramMessage, sendInstagramTyping } = require("../src/services/channels/instagram");
```

- [ ] **Step 3: Verify**

Run: `node --check index.js; node --check utils/worker.js; node --check src/services/channels/messenger.js; node --check src/services/channels/instagram.js`
Expected: clean.

Run: `node --test "tests/*.test.js"`
Expected: 64 passing.

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "refactor(channels): move messenger/instagram helpers under src/services/channels"
```

---

### Task 4: Extract message handlers into `createMessageHandlers` factory

**Files:**
- Create: `src/services/channels/messageHandlers.js`
- Modify: `index.js` (replace inline handlers 810–1071 with factory call)

- [ ] **Step 1: Create `src/services/channels/messageHandlers.js`**

Full file (handlers moved verbatim from `index.js:811-1071`; only the factory wrapper and the `sendViaTagIfExpired` inline-require hoist are new):

```js
/**
 * src/services/channels/messageHandlers.js
 * Per-channel inbound message handlers, exposed as a factory so runtime-only
 * deps (io, upsertUser, saveMessage) stay explicit — no hidden globals.
 */
const { User, Settings } = require("../../config/db");
const { generateReply } = require("../ai/gemini");
const {
  sendMessage,
  sendTyping,
  getUserProfile,
  downloadExternalMedia,
} = require("./messenger");
const {
  sendWhatsAppMessage,
  markWhatsAppAsRead,
  downloadWhatsAppMedia,
} = require("./whatsapp");
const {
  sendInstagramMessage,
  sendInstagramTyping,
  downloadInstagramMedia,
  getInstagramUserProfile,
} = require("./instagram");
const { extractAdContext, trackAdClick } = require("../../../utils/adTracking");
const { detectComplaint } = require("../../../utils/complaintDetector");
const { shouldEscalate } = require("../../../utils/escalation");
const { isDuplicate, markProcessed } = require("../../../utils/dedup");
const { handleTokenRevocation } = require("../../../utils/tokenManager");
const { isWithinMessagingWindow, sendViaTagIfExpired } = require("../../../utils/messagingWindow");

function createMessageHandlers({ io, upsertUser, saveMessage }) {
  async function handleMessengerEvent(event, pageId, tenant_id) {
    // (verbatim from index.js:811-905)
    try {
      const senderId = event.sender?.id;
      if (!senderId || event.message?.is_echo) return;
      // Loop guard: skip messages from the page itself
      if (senderId === pageId) {
        console.log(` [Loop] Messenger: skipping echo from page ${pageId}`);
        return;
      }
      let text = event.message?.text || event.postback?.payload || event.message?.quick_reply?.payload;
      let mediaData = null;
      if (event.message?.attachments && event.message.attachments[0].type === "image") {
        const imageUrl = event.message.attachments[0].payload.url;
        mediaData = await downloadExternalMedia(imageUrl);
        if (!text) text = "Analyze this image";
      }
      if (!text && !mediaData) return;
      let displayName = null;
      let profilePic = null;
      try {
        const profile = await getUserProfile(senderId, pageId);
        if (profile) {
          displayName = profile.name || [profile.first_name, profile.last_name].filter(Boolean).join(" ").trim() || profile.first_name || null;
          profilePic = profile.profile_pic || null;
        }
      } catch (profileErr) {
        // Token may be revoked — check for error code 190
        if (profileErr?.response?.data?.error?.code === 190) {
          await handleTokenRevocation("messenger", pageId);
        }
      }
      displayName = displayName || `User ${senderId.slice(-8)}`;
      console.log(" [Messenger] %s (%s): \"%s\"", senderId, displayName, text || "[Image]");
      await upsertUser(senderId, "messenger", displayName, profilePic);
      const messageContent = text || "[Image]";
      const mediaUrl = event.message?.attachments?.[0]?.type === "image" ? event.message.attachments[0].payload.url : null;
      await saveMessage(senderId, "user", messageContent, mediaUrl);
      io.emit("new_message", { uid: senderId, role: "user", content: text || "[Image]", timestamp: new Date(), customerName: displayName });

      // Ad tracking: Check for referral data from Facebook ads
      const referralData = event.referral || event.message?.referral || null;
      const adContext = extractAdContext(referralData);
      if (adContext) {
        await trackAdClick(senderId, "facebook", adContext, text);
      }

      const complaint = text ? detectComplaint(text) : { isComplaint: false, isHandoffRequest: false, sentiment: "neutral" };
      if (complaint.isComplaint || complaint.isHandoffRequest) {
        io.emit("complaint_detected", { uid: senderId, customerName: displayName, complaint, message: text });
      }
      if (shouldEscalate(text)) {
        await User.findOneAndUpdate(
          { uid: senderId },
          { $set: { "metadata.handoffStatus": "human_assigned" } },
          { upsert: true }
        );
        io.emit("human_handoff_message", { uid: senderId, customerName: displayName, message: text });
      }
      let settings = await Settings.findOne({ configId: "global" });
      if (!settings) settings = { autoReply: true };
      if (!settings.autoReply) return;

      // Check if conversation is assigned to human
      const user = await User.findOne({ uid: senderId });
      if (user?.metadata?.handoffStatus === "human_assigned") {
        io.emit("human_handoff_message", { uid: senderId, customerName: displayName, message: text });
        return;
      }

      await sendTyping(senderId, pageId);
      let reply;
      try { reply = await generateReply(senderId, text, mediaData, displayName, adContext, tenant_id); }
      catch (aiErr) { console.error(" AI Error:", aiErr.message); reply = "Thank you for your message! We'll get back to you shortly."; }
      await saveMessage(senderId, "model", reply);
      await sendMessage(senderId, reply, pageId);
      io.emit("new_message", { uid: senderId, role: "model", content: reply, timestamp: new Date() });
    } catch (err) {
      console.error(" Messenger Handler Error:", err.message);
      // Check for token revocation error
      if (err?.response?.data?.error?.code === 190) {
        await handleTokenRevocation("messenger", pageId);
      }
      // Error message dedup - max 1 error message per 5 minutes per user
      try {
        const senderId = event.sender?.id;
        if (senderId) {
          const errorKey = `error:${senderId}:${Math.floor(Date.now() / 300000)}`;
          if (!await isDuplicate(errorKey)) {
            await markProcessed(errorKey);
            await sendMessage(senderId, "I'm having a little trouble right now. Please try again in a moment.", pageId);
          }
        }
      } catch (e) { /* Don't cascade errors */ }
    }
  }

  async function handleWhatsAppEvent(message, contact, wabaId, tenant_id) {
    // (verbatim from index.js:908-981)
    try {
      const from = message.from;
      const messageId = message.id;
      const rawName = contact?.profile?.name;
      const displayName = rawName || `+${from.slice(0, 2)}****${from.slice(-4)}`;
      let text = message.text?.body;
      let mediaData = null;
      if (message.type === "image") { text = message.image.caption || "Analyze this image"; mediaData = await downloadWhatsAppMedia(message.image.id, wabaId); }
      else if (message.type !== "text") return;
      if (!from || (!text && !mediaData)) return;
      console.log(" [WhatsApp] %s (%s): \"%s\"", from, displayName, text || "[Image]");
      await upsertUser(from, "whatsapp", displayName);
      await saveMessage(from, "user", text || "[Image]", null, "whatsapp");
      io.emit("new_message", { uid: from, role: "user", content: text || "[Image]", timestamp: new Date(), customerName: displayName });
      const complaint = text ? detectComplaint(text) : { isComplaint: false, isHandoffRequest: false, sentiment: "neutral" };
      if (complaint.isComplaint || complaint.isHandoffRequest) {
        io.emit("complaint_detected", { uid: from, customerName: displayName, complaint, message: text });
      }
      if (shouldEscalate(text)) {
        await User.findOneAndUpdate(
          { uid: from },
          { $set: { "metadata.handoffStatus": "human_assigned" } },
          { upsert: true }
        );
        io.emit("human_handoff_message", { uid: from, customerName: displayName, message: text });
      }
      await markWhatsAppAsRead(messageId, wabaId).catch(() => {});
      let settings = await Settings.findOne({ configId: "global" });
      if (!settings) settings = { autoReply: true };
      if (!settings.autoReply) return;

      // Check if conversation is assigned to human
      const waUser = await User.findOne({ uid: from });
      if (waUser?.metadata?.handoffStatus === "human_assigned") {
        io.emit("human_handoff_message", { uid: from, customerName: displayName, message: text });
        return;
      }

      // 24-hour window check
      const withinWindow = await isWithinMessagingWindow(from, "whatsapp");
      if (!withinWindow) {
        console.log(` [WhatsApp] Outside 24h window for ${from}, attempting utility tag...`);
        const tagResult = await sendViaTagIfExpired(from, "whatsapp", "We received your message! Our team will respond during business hours.");
        if (!tagResult) {
          console.log(` [WhatsApp] Cannot send to ${from} — outside 24h window and no tag available`);
          return;
        }
      }

      const reply = await generateReply(from, text, mediaData, displayName, null, tenant_id);
      await saveMessage(from, "model", reply, null, "whatsapp");
      await sendWhatsAppMessage(from, reply, wabaId);
      io.emit("new_message", { uid: from, role: "model", content: reply, timestamp: new Date() });
    } catch (err) {
      console.error(" WhatsApp Handler Error:", err.message);
      // Check for token revocation
      if (err?.response?.data?.error?.code === 190 || err?.response?.data?.error?.message?.includes("OAuthException")) {
        await handleTokenRevocation("whatsapp", process.env.WHATSAPP_BUSINESS_ACCOUNT_ID);
      }
      // Error message dedup - max 1 error message per 5 minutes per user
      try {
        const from = message.from;
        if (from) {
          const errorKey = `error:${from}:${Math.floor(Date.now() / 300000)}`;
          if (!await isDuplicate(errorKey)) {
            await markProcessed(errorKey);
            await sendWhatsAppMessage(from, "I'm having a little trouble right now. Please try again in a moment.", wabaId);
          }
        }
      } catch (e) { /* Don't cascade errors */ }
    }
  }

  async function handleInstagramEvent(event, pageId, tenant_id) {
    // (verbatim from index.js:984-1071)
    try {
      const senderId = event.sender?.id;
      if (!senderId || event.message?.is_echo) return;
      // Loop guard: skip messages from the page itself
      if (senderId === pageId) {
        console.log(` [Loop] Instagram: skipping echo from page ${pageId}`);
        return;
      }
      let text = event.message?.text || event.postback?.payload || event.message?.quick_reply?.payload;
      let mediaData = null;
      if (event.message?.attachments && event.message.attachments[0].type === "image") {
        const imageUrl = event.message.attachments[0].payload.url;
        mediaData = await downloadInstagramMedia(imageUrl);
        if (!text) text = "Analyze this image";
      }
      if (!text && !mediaData) return;
      let displayName = null;
      let profilePic = null;
      try {
        const profile = await getInstagramUserProfile(senderId, pageId);
        if (profile) { displayName = profile.name || null; profilePic = profile.profile_pic || null; }
      } catch (profileErr) {
        if (profileErr?.response?.data?.error?.code === 190) {
          await handleTokenRevocation("instagram", pageId);
        }
      }
      displayName = displayName || "IG User " + senderId.slice(-8);
      console.log(' [Instagram] %s (%s): "%s"', senderId, displayName, text || "[Image]");
      await upsertUser(senderId, "instagram", displayName, profilePic);
      await saveMessage(senderId, "user", text || "[Image]", null, "instagram");
      io.emit("new_message", { uid: senderId, role: "user", content: text || "[Image]", timestamp: new Date(), customerName: displayName });

      // Ad tracking: Check for referral data from Instagram ads
      const referralData = event.referral || event.message?.referral || null;
      const adContext = extractAdContext(referralData);
      if (adContext) {
        await trackAdClick(senderId, "instagram", adContext, text);
      }

      const complaint = text ? detectComplaint(text) : { isComplaint: false, isHandoffRequest: false, sentiment: "neutral" };
      if (complaint.isComplaint || complaint.isHandoffRequest) {
        io.emit("complaint_detected", { uid: senderId, customerName: displayName, complaint, message: text });
      }
      if (shouldEscalate(text)) {
        await User.findOneAndUpdate(
          { uid: senderId },
          { $set: { "metadata.handoffStatus": "human_assigned" } },
          { upsert: true }
        );
        io.emit("human_handoff_message", { uid: senderId, customerName: displayName, message: text });
      }
      let settings = await Settings.findOne({ configId: "global" });
      if (!settings) settings = { autoReply: true };
      if (!settings.autoReply) return;

      // Check if conversation is assigned to human
      const igUser = await User.findOne({ uid: senderId });
      if (igUser?.metadata?.handoffStatus === "human_assigned") {
        io.emit("human_handoff_message", { uid: senderId, customerName: displayName, message: text });
        return;
      }

      await sendInstagramTyping(senderId, pageId);
      let reply;
      try { reply = await generateReply(senderId, text, mediaData, displayName, adContext, tenant_id); }
      catch (aiErr) { console.error(" AI Error:", aiErr.message); reply = "Thank you for your message! We'll get back to you shortly."; }
      await saveMessage(senderId, "model", reply, null, "instagram");
      await sendInstagramMessage(senderId, reply, pageId);
      io.emit("new_message", { uid: senderId, role: "model", content: reply, timestamp: new Date() });
    } catch (err) {
      console.error(" Instagram Handler Error:", err.message);
      if (err?.response?.data?.error?.code === 190) {
        await handleTokenRevocation("instagram", pageId);
      }
      // Error message dedup - max 1 error message per 5 minutes per user
      try {
        const senderId = event.sender?.id;
        if (senderId) {
          const errorKey = `error:${senderId}:${Math.floor(Date.now() / 300000)}`;
          if (!await isDuplicate(errorKey)) {
            await markProcessed(errorKey);
            await sendInstagramMessage(senderId, "I'm having a little trouble right now. Please try again in a moment.", pageId);
          }
        }
      } catch (e) { /* Don't cascade errors */ }
    }
  }

  return { handleMessengerEvent, handleWhatsAppEvent, handleInstagramEvent };
}

module.exports = { createMessageHandlers };
```

- [ ] **Step 2: Replace the inline handlers in `index.js`**

Delete the whole block from the `// ─── MESSENGER HANDLER ───` banner through the closing `}` of `handleInstagramEvent` (anchors: `// ─── MESSENGER HANDLER ──` … `// ── FEEDBACK & AI LEARNING`). Nothing is placed where the block was removed (the handlers are now defined earlier).

Add the require with the other top-level requires (near line 83–86):
```js
const { createMessageHandlers } = require("./src/services/channels/messageHandlers");
```

Place the factory call + destructure **immediately after the `const io = socketIo(server, { … });` block (current line 124)** — this is the earliest point where both `io` (line 103) and the `upsertUser`/`saveMessage` imports (top of file, from Task 2) are in scope, and it is **before** the webhooks block (line 389) that Task 7 registers. Deterministic ordering — no reliance on the handler block's old position:

```js
const { handleMessengerEvent, handleWhatsAppEvent, handleInstagramEvent } = createMessageHandlers({ io, upsertUser, saveMessage });
```

- [ ] **Step 3: Verify**

Run: `node --check index.js; node --check src/services/channels/messageHandlers.js`
Expected: clean.

Run: `node --test "tests/*.test.js"`
Expected: 64 passing.

- [ ] **Step 4: Commit**

```bash
git add src/services/channels/messageHandlers.js index.js
git commit -m "refactor(channels): extract message handlers into createMessageHandlers factory"
```

---

### Task 5: Extract `src/routes/auth.js`

**Files:**
- Create: `src/routes/auth.js`
- Modify: `index.js` (delete AUTH ROUTES block 202–355, register module in place)

- [ ] **Step 1: Create `src/routes/auth.js`**

```js
/**
 * src/routes/auth.js
 * Admin auth: signup, login, refresh, logout, Meta OAuth URL + callback.
 */
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const crypto = require("crypto");
const axios = require("axios");
const { encrypt } = require("../utils/security");
const { Admin } = require("../config/db");
const { signRefreshToken, verifyRefreshToken } = require("../utils/refreshToken");
const { requireEnv } = require("../config/env");
const { withSuperadmin } = require("../config/superadmin");

const JWT_SECRET = requireEnv("JWT_SECRET", {
  minLength: 16,
  forbid: ["cyberbot-admin-secret-key-change-in-production", "your_jwt_secret_key"]
});

function registerAuthRoutes(app, { authLimiter, authenticateAdmin, requireAdmin }) {
  if (!app || typeof app.post !== "function") {
    throw new Error("registerAuthRoutes requires an Express app");
  }
  if (app.__authRoutesRegistered) return;
  app.__authRoutesRegistered = true;

  // (route bodies verbatim from index.js:203-355)
  // Cut from:  app.post("/api/auth/signup", authLimiter, authenticateAdmin, requireAdmin, …
  // Cut to:    the closing "});" of app.get("/api/auth/meta/callback", …
  // Only change: references to `withSuperadmin`, `JWT_SECRET`, `bcrypt`, `crypto`,
  // `axios`, `encrypt`, `Admin`, `signRefreshToken`, `verifyRefreshToken` now resolve
  // to the module-level requires above. The four middleware args (authLimiter,
  // authenticateAdmin, requireAdmin) come from the deps object.
}

module.exports = { registerAuthRoutes };
```

Move the six route handlers into the function body verbatim from `index.js` (anchors: `app.post("/api/auth/signup"` … closing `});` of `app.get("/api/auth/meta/callback"`). Paste them immediately after the idempotency-flag line. They already reference `withSuperadmin`, `JWT_SECRET`, `bcrypt`, `crypto`, `axios`, `encrypt`, `Admin`, `signRefreshToken`, `verifyRefreshToken`, `process.env.FB_APP_ID`/`FB_APP_SECRET`/`META_REDIRECT_URI`/`BASE_URL` — all now in scope.

- [ ] **Step 2: Replace the inline block in `index.js`**

Delete from the `// ─── AUTH ROUTES ───` banner through the closing `});` of the `app.get("/api/auth/meta/callback"` route (anchors: `// ─── AUTH ROUTES ─` … the blank line before `// ─── INTEGRATIONS ─`). At that position add:

```js
const { registerAuthRoutes } = require("./src/routes/auth");
registerAuthRoutes(app, { authLimiter, authenticateAdmin, requireAdmin });
```

(Place the `require` at the top of index.js with the other route-module requires near line 84–86; the `registerAuthRoutes(app, …)` call goes where the block was removed, preserving registration order relative to `registerChatRoutes` and the integrations block that follows.)

- [ ] **Step 3: Verify**

Run: `node --check index.js; node --check src/routes/auth.js`
Expected: clean.

Run: `node --test "tests/*.test.js"`
Expected: 64 passing.

Run: `node scripts/route-audit.js diff`
Expected: `Route audit OK: 72 routes match snapshot.`

- [ ] **Step 4: Commit**

```bash
git add src/routes/auth.js index.js
git commit -m "refactor(routes): extract auth.js (signup/login/refresh/logout/meta)"
```

---

### Task 6: Extract `src/routes/integrations.js`

**Files:**
- Create: `src/routes/integrations.js`
- Modify: `index.js` (delete INTEGRATIONS 357–387 AND INTEGRATIONS API 1610–1656, register module in place)

- [ ] **Step 1: Create `src/routes/integrations.js`**

```js
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

  // (route bodies verbatim from index.js:358-387 and 1611-1656)
  // Cut #1: app.get("/api/admin/integrations", adminLimiter, authenticateAdmin, …
  //         through closing "});" of app.delete("/api/admin/integrations/:id", …
  // Cut #2: app.post("/api/admin/integrations/shopify", …
  //         through closing "});" of app.post("/api/admin/integrations/woocommerce", …
}

module.exports = { registerIntegrationsRoutes };
```

Paste both verbatim blocks inside the function body after the idempotency flag. They use `Integration`, `EcommerceConnection` (module requires), `adminLimiter`, `authenticateAdmin`, `requireAdmin` (deps), and `req`/`res` (Express).

- [ ] **Step 2: Replace both inline blocks in `index.js`**

Delete block #1: `// ─── INTEGRATIONS ───` banner through the closing `});` of `app.delete("/api/admin/integrations/:id"` (anchor: the blank line before `// ─── WEBHOOKS ─`).
Delete block #2: `// ─── INTEGRATIONS API (Shopify/WooCommerce) ─` banner through the closing `});` of `app.post("/api/admin/integrations/woocommerce"` (anchor: the blank line before `// ─── API 404 ─`).

Add the require near the top with other route-module requires:
```js
const { registerIntegrationsRoutes } = require("./src/routes/integrations");
```
Add the registration call where block #1 was removed (preserves order: webhooks follows):
```js
registerIntegrationsRoutes(app, { adminLimiter, authenticateAdmin, requireAdmin });
```

- [ ] **Step 3: Verify**

Run: `node --check index.js; node --check src/routes/integrations.js`
Expected: clean.

Run: `node --test "tests/*.test.js"`
Expected: 64 passing.

Run: `node scripts/route-audit.js diff`
Expected: `Route audit OK: 72 routes match snapshot.`

- [ ] **Step 4: Commit**

```bash
git add src/routes/integrations.js index.js
git commit -m "refactor(routes): extract integrations.js (social + shopify/woo)"
```

---

### Task 7: Extract `src/routes/webhooks.js`

**Files:**
- Create: `src/routes/webhooks.js`
- Modify: `index.js` (delete WEBHOOKS block 389–593, register module in place)

- [ ] **Step 1: Create `src/routes/webhooks.js`**

```js
/**
 * src/routes/webhooks.js
 * Messenger / WhatsApp / Instagram webhook GET (verify) + POST (event) routes.
 */
const { verifyMetaSignature } = require("../utils/security");
const { verifyWebhookToken, getTenantByChannel } = require("../utils/webhookHelpers");
const { atomicDedupCheck } = require("../../utils/dedup");
const { runWithTenantContext } = require("../../utils/tenantContext");

function registerWebhookRoutes(app, { io, handleMessengerEvent, handleWhatsAppEvent, handleInstagramEvent }) {
  if (!app || typeof app.get !== "function") {
    throw new Error("registerWebhookRoutes requires an Express app");
  }
  if (app.__webhookRoutesRegistered) return;
  app.__webhookRoutesRegistered = true;

  // (route bodies verbatim from index.js:390-593)
  // Cut: app.get("/webhook/messenger", … through closing "});" of
  //      app.post("/webhook/instagram", …
  // References to handleMessengerEvent/handleWhatsAppEvent/handleInstagramEvent,
  // verifyWebhookToken, getTenantByChannel, verifyMetaSignature, atomicDedupCheck,
  // runWithTenantContext, and process.env.* resolve from module scope / deps.
}

module.exports = { registerWebhookRoutes };
```

Paste the six webhook handlers verbatim after the idempotency flag.

- [ ] **Step 2: Replace the inline block in `index.js`**

Delete `// ─── WEBHOOKS ───` banner through the closing `});` of `app.post("/webhook/instagram"` (anchor: the blank line before `// ─── ADMIN DASHBOARD API ─`).

Add near the top:
```js
const { registerWebhookRoutes } = require("./src/routes/webhooks");
```
Add where the block was removed (order: after auth + integrations, before admin):
```js
registerWebhookRoutes(app, { io, handleMessengerEvent, handleWhatsAppEvent, handleInstagramEvent });
```
`handleMessengerEvent`/`handleWhatsAppEvent`/`handleInstagramEvent` are in scope in `index.js` — Task 4 places the `createMessageHandlers` factory call immediately after the `io` definition (before this webhook registration point), so no TDZ hazard.

- [ ] **Step 3: Verify**

Run: `node --check index.js; node --check src/routes/webhooks.js`
Expected: clean.

Run: `node --test "tests/*.test.js"`
Expected: 64 passing.

Run: `node scripts/route-audit.js diff`
Expected: `Route audit OK: 72 routes match snapshot.`

- [ ] **Step 4: Commit**

```bash
git add src/routes/webhooks.js index.js
git commit -m "refactor(routes): extract webhooks.js (messenger/whatsapp/instagram)"
```

---

### Task 8: Extract `src/routes/admin.js`

**Files:**
- Create: `src/routes/admin.js`
- Modify: `index.js` (delete ADMIN DASHBOARD API 596–808 AND FEEDBACK & AI LEARNING 1074–1236, register module in place)

- [ ] **Step 1: Create `src/routes/admin.js`**

```js
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

function registerAdminRoutes(app, { io, adminLimiter, authenticateAdmin, requireAdmin }) {
  if (!app || typeof app.get !== "function") {
    throw new Error("registerAdminRoutes requires an Express app");
  }
  if (app.__adminRoutesRegistered) return;
  app.__adminRoutesRegistered = true;

  // (route bodies verbatim from index.js:596-808 and 1074-1236)
  // Cut #1: app.get("/api/admin/conversations", … through closing "});" of
  //         app.delete("/api/admin/team/:id", …
  // Cut #2: app.post("/api/admin/feedback", … through closing "});" of
  //         app.get("/api/admin/ai-performance", …
}

module.exports = { registerAdminRoutes };
```

Paste both verbatim blocks after the idempotency flag. All referenced symbols (`bcrypt`, `User`, `Message`, `Order`, `Admin`, `Settings`, `Feedback`, `saveMessage`, `sendMessage`, `sendWhatsAppMessage`, `sendInstagramMessage`, `getQueueStats`, `deleteUserMessages`, `purgeExpiredMessages`, `analyzeConversations`, `identifyFailurePatterns`, `suggestKnowledgeAdditions`, `exportFineTuningData`, `io`, `adminLimiter`, `authenticateAdmin`, `requireAdmin`) are in scope.

Note (spec deviation): the spec §2 table lists `withSuperadmin` among admin.js deps, but no admin route uses it (grep: `withSuperadmin` appears only in auth routes and bootstrap). Per YAGNI it is omitted from deps. Flagged for reviewer awareness; re-add if a future route needs it.

- [ ] **Step 2: Replace both inline blocks in `index.js`**

Delete block #1: `// ─── ADMIN DASHBOARD API ─` banner through the closing `});` of `app.delete("/api/admin/team/:id"` (anchor: the blank line before `// ─── MESSENGER HANDLER ─`).
Delete block #2: `// ── FEEDBACK & AI LEARNING ENDPOINTS ─` banner through the closing `});` of `app.get("/api/admin/ai-performance"` (anchor: the blank line before `// ── AD SYSTEM ENDPOINTS ─`).

Add near the top:
```js
const { registerAdminRoutes } = require("./src/routes/admin");
```
Add where block #1 was removed (order: after webhooks, before ads/products):
```js
registerAdminRoutes(app, { io, adminLimiter, authenticateAdmin, requireAdmin });
```

- [ ] **Step 3: Verify**

Run: `node --check index.js; node --check src/routes/admin.js`
Expected: clean.

Run: `node --test "tests/*.test.js"`
Expected: 64 passing.

Run: `node scripts/route-audit.js diff`
Expected: `Route audit OK: 72 routes match snapshot.`

- [ ] **Step 4: Commit**

```bash
git add src/routes/admin.js index.js
git commit -m "refactor(routes): extract admin.js (dashboard api + feedback/analytics/ai-performance)"
```

---

### Task 9: Extract `src/routes/ads.js`

**Files:**
- Create: `src/routes/ads.js`
- Modify: `index.js` (delete AD SYSTEM block 1238–1315, register module in place)

- [ ] **Step 1: Create `src/routes/ads.js`**

```js
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

  // (route bodies verbatim from index.js:1239-1315)
  // Cut: app.get("/api/admin/ads", … through closing "});" of
  //      app.delete("/api/admin/ads/:adId", …
}

module.exports = { registerAdsRoutes };
```

Paste the six ad routes verbatim after the idempotency flag (`getAdPerformance`, `getRecentClicks`, `Ad`, `AdClick`, `adminLimiter`, `authenticateAdmin`, `requireAdmin` all in scope).

- [ ] **Step 2: Replace the inline block in `index.js`**

Delete `// ── AD SYSTEM ENDPOINTS ─` banner through the closing `});` of `app.delete("/api/admin/ads/:adId"` (anchor: the blank line before `// ─── PUBLIC API ROUTES ─`).

Add near the top:
```js
const { registerAdsRoutes } = require("./src/routes/ads");
```
Add where the block was removed (order: after admin, before products):
```js
registerAdsRoutes(app, { adminLimiter, authenticateAdmin, requireAdmin });
```

- [ ] **Step 3: Verify**

Run: `node --check index.js; node --check src/routes/ads.js`
Expected: clean.

Run: `node --test "tests/*.test.js"`
Expected: 64 passing.

Run: `node scripts/route-audit.js diff`
Expected: `Route audit OK: 72 routes match snapshot.`

- [ ] **Step 4: Commit**

```bash
git add src/routes/ads.js index.js
git commit -m "refactor(routes): extract ads.js (ad system admin api)"
```

---

### Task 10: Extract `src/routes/products.js`

**Files:**
- Create: `src/routes/products.js`
- Modify: `index.js` (delete PUBLIC PRODUCTS 1317–1339 + ADMIN PRODUCT CRUD 1341–1429, register module in place)

- [ ] **Step 1: Create `src/routes/products.js`**

```js
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

  // (route bodies verbatim from index.js:1327-1339 and 1342-1429)
  // Cut #1: app.get("/api/products", withPublicTenant, … through closing "});" of
  //         app.get("/api/products/category/:category", …
  // Cut #2: app.get("/api/admin/products", … through closing "});" of
  //         app.put("/api/admin/products/:id/restore", …
  // `withPublicTenant` is defined above in this module; `Product` in scope.
}

module.exports = { registerProductsRoutes };
```

Note (spec deviation): the spec §2 table lists `withPublicTenant` as a runtime dep, but it only depends on the leaf singletons `resolveTenantFromRequest` + `runWithTenantContext`, so per Style A it is defined here and required directly. Public + admin product routes are grouped in one module per the spec table.

Paste both verbatim blocks after the idempotency flag.

- [ ] **Step 2: Replace both inline blocks in `index.js`**

Delete block #1: `// ─── PUBLIC API ROUTES ─` banner through the closing `});` of `app.get("/api/products/category/:category"` (including the inline `async function withPublicTenant` at 1319–1325).
Delete block #2: `// ─── ADMIN PRODUCT CRUD ─` banner through the closing `});` of `app.put("/api/admin/products/:id/restore"` (anchor: the blank line before `// ─── KNOWLEDGE BASE API ─`).

Add near the top:
```js
const { registerProductsRoutes } = require("./src/routes/products");
```
Add where block #1 was removed (order: after ads, before knowledge):
```js
registerProductsRoutes(app, { adminLimiter, authenticateAdmin, requireAdmin });
```
Remove the now-unused `resolveTenantFromRequest` from the index.js require line 86 (keep `registerChatRoutes`). If `runWithTenantContext` becomes unused in index.js, keep the require (it is re-exported and used elsewhere).

- [ ] **Step 3: Verify**

Run: `node --check index.js; node --check src/routes/products.js`
Expected: clean.

Run: `node --test "tests/*.test.js"`
Expected: 64 passing.

Run: `node scripts/route-audit.js diff`
Expected: `Route audit OK: 72 routes match snapshot.`

- [ ] **Step 4: Commit**

```bash
git add src/routes/products.js index.js
git commit -m "refactor(routes): extract products.js (public catalog + admin CRUD)"
```

---

### Task 11: Extract `src/routes/knowledge.js`

**Files:**
- Create: `src/routes/knowledge.js`
- Modify: `index.js` (delete KNOWLEDGE BASE API block 1431–1608, register module in place)

- [ ] **Step 1: Create `src/routes/knowledge.js`**

```js
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

  // (route bodies verbatim from index.js:1433-1608)
  // Cut: app.get("/api/admin/knowledge", … through closing "});" of
  //      app.post("/api/admin/knowledge/reindex", …
  // `KnowledgeBase`, `indexAllKnowledge`, adminLimiter, authenticateAdmin,
  // requireAdmin all in scope.
}

module.exports = { registerKnowledgeRoutes };
```

Paste the seven knowledge routes verbatim after the idempotency flag (including the manual multipart upload handler at 1503–1599).

- [ ] **Step 2: Replace the inline block in `index.js`**

Delete `// ─── KNOWLEDGE BASE API ─` banner through the closing `});` of `app.post("/api/admin/knowledge/reindex"` (anchor: the blank line before `// ─── INTEGRATIONS API (Shopify/WooCommerce) ─`).

Add near the top:
```js
const { registerKnowledgeRoutes } = require("./src/routes/knowledge");
```
Add where the block was removed (order: after products, before API 404):
```js
registerKnowledgeRoutes(app, { adminLimiter, authenticateAdmin, requireAdmin });
```

- [ ] **Step 3: Verify**

Run: `node --check index.js; node --check src/routes/knowledge.js`
Expected: clean.

Run: `node --test "tests/*.test.js"`
Expected: 64 passing.

Run: `node scripts/route-audit.js diff`
Expected: `Route audit OK: 72 routes match snapshot.`

- [ ] **Step 4: Commit**

```bash
git add src/routes/knowledge.js index.js
git commit -m "refactor(routes): extract knowledge.js (knowledge base admin api)"
```

---

### Task 12: Composition root `src/app.js`

**Files:**
- Create: `src/app.js`
- Modify: `index.js` (replace inline app/server/io/middleware/registration setup with `createApp`)

- [ ] **Step 1: Create `src/app.js`**

```js
/**
 * src/app.js
 * Composition root: builds Express app + HTTP server + Socket.IO, wires body
 * parsers/static/CORS/limiters, registers every register*Routes in the current
 * order, and serves the Next.js dashboard via the passed-in nextHandle (last).
 */
const express = require("express");
const http = require("http");
const path = require("path");
const socketIo = require("socket.io");
const rateLimit = require("express-rate-limit");

const { registerHealthRoutes } = require("./routes/health");
const { registerOrderRoutes } = require("./routes/orders");
const { registerChatRoutes } = require("./routes/chat");
const { registerAuthRoutes } = require("./routes/auth");
const { registerWebhookRoutes } = require("./routes/webhooks");
const { registerIntegrationsRoutes } = require("./routes/integrations");
const { registerAdminRoutes } = require("./routes/admin");
const { registerAdsRoutes } = require("./routes/ads");
const { registerProductsRoutes } = require("./routes/products");
const { registerKnowledgeRoutes } = require("./routes/knowledge");

const { createMessageHandlers } = require("./services/channels/messageHandlers");
const { upsertUser, saveMessage } = require("./utils/messageHelpers");
const { generateReply } = require("./services/ai/gemini");
const { extractAdContext, trackAdClick } = require("../utils/adTracking");
const { makeRequireRole } = require("../utils/rbac");
const { authenticateTenant } = require("./middleware/auth");
const { Settings } = require("./config/db");

function createApp({ nextHandle }) {
  const app = express();
  const server = http.createServer(app);

  // Public health endpoints (registered before Next.js catch-all)
  registerHealthRoutes(app);

  const allowedOrigins = process.env.ALLOWED_ORIGINS
    ? process.env.ALLOWED_ORIGINS.split(",").map(o => o.trim()).filter(Boolean)
    : [];

  const io = socketIo(server, {
    cors: {
      origin: (origin, callback) => {
        if (!origin) return callback(null, true);
        if (allowedOrigins.length === 0) {
          if (process.env.NODE_ENV !== "production") {
            return callback(null, true);
          }
          return callback(new Error("CORS: ALLOWED_ORIGINS not configured in production"));
        }
        if (allowedOrigins.includes(origin)) {
          return callback(null, true);
        }
        return callback(new Error("CORS: Origin not allowed"));
      },
      methods: ["GET", "POST"],
      credentials: true
    },
    pingTimeout: 60000,
    pingInterval: 25000,
    transports: ["websocket", "polling"]
  });

  const adminLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 100, message: { error: "Too many requests" }, standardHeaders: true, legacyHeaders: false });
  const chatLimiter = rateLimit({ windowMs: 60 * 1000, max: 10, message: { error: "Rate limit exceeded" } });
  const authLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 20, message: { error: "Too many auth attempts" } });

  app.use(express.json({
    limit: "10mb",
    verify: (req, _res, buf) => { req.rawBody = buf.toString(); }
  }));
  app.use(express.urlencoded({ extended: true }));
  app.use(express.static(path.join(__dirname, "..", "landing")));

  registerOrderRoutes(app);

  app.use((req, res, next) => {
    const origin = req.headers.origin;
    if (allowedOrigins.length > 0) {
      if (allowedOrigins.includes(origin)) {
        res.header("Access-Control-Allow-Origin", origin);
      }
    } else {
      if (process.env.NODE_ENV !== "production") {
        res.header("Access-Control-Allow-Origin", origin || "*");
      } else {
        console.warn("⚠️ WARNING: ALLOWED_ORIGINS is not set in production! CORS requests will be blocked.");
      }
    }
    res.header("Access-Control-Allow-Headers", "Origin, X-Requested-With, Content-Type, Accept, Authorization, X-Tenant-ID");
    res.header("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, PATCH, OPTIONS");
    res.header("Access-Control-Allow-Credentials", "true");

    if (req.method === "OPTIONS") {
      return res.sendStatus(200);
    }
    next();
  });

  registerChatRoutes(app, {
    chatLimiter,
    generateReply,
    upsertUser,
    saveMessage,
    io,
    extractAdContext,
    trackAdClick,
    Settings,
  });

  const authenticateAdmin = authenticateTenant;
  const requireAdmin = makeRequireRole("admin");

  registerAuthRoutes(app, { authLimiter, authenticateAdmin, requireAdmin });
  registerIntegrationsRoutes(app, { adminLimiter, authenticateAdmin, requireAdmin });

  const { handleMessengerEvent, handleWhatsAppEvent, handleInstagramEvent } =
    createMessageHandlers({ io, upsertUser, saveMessage });
  registerWebhookRoutes(app, { io, handleMessengerEvent, handleWhatsAppEvent, handleInstagramEvent });

  registerAdminRoutes(app, { io, adminLimiter, authenticateAdmin, requireAdmin });
  registerAdsRoutes(app, { adminLimiter, authenticateAdmin, requireAdmin });
  registerProductsRoutes(app, { adminLimiter, authenticateAdmin, requireAdmin });
  registerKnowledgeRoutes(app, { adminLimiter, authenticateAdmin, requireAdmin });

  // ─── API 404 ────────────────────────────────────────
  app.use('/api', (req, res) => { res.status(404).json({ error: "Route not found", path: req.url }); });
  app.use('/webhook', (req, res) => { res.status(404).json({ error: "Route not found", path: req.url }); });

  // ─── NEXT.JS DASHBOARD (catch-all, last) ────────────
  if (nextHandle) {
    app.all("*", (req, res) => {
      return nextHandle(req, res);
    });
  }

  io.on("connection", (socket) => {
    socket.on("disconnect", (reason) => {
      if (reason === "transport close" || reason === "ping timeout") {}
    });
  });

  return { app, server, io };
}

module.exports = { createApp };
```

- [ ] **Step 2: Rewire `index.js` to use `createApp`**

Replace everything from line 88 (`const dev = …`) through line 181 (closing `});` of `registerChatRoutes(app, {…})`) — i.e. the next app setup, `app`/`server` creation, io, env validation, limiters, body parsers, static, order routes, CORS middleware, and chat routes — with:

```js
const dev = process.env.NODE_ENV !== "production";
const dashboardDir = path.join(__dirname, "dashboard");
const nextApp = next({ dev, dir: dashboardDir });
const nextHandle = nextApp.getRequestHandler();

const { createApp } = require("./src/app");
const { app, server, io } = createApp({ nextHandle });
```

Keep (unchanged) lines 1–14 (dotenv + core requires), the service/helper requires (they are used by init + `index.js`'s remaining lifecycle code), the `PORT`/`JWT_SECRET` block if still referenced, `require("./src/config/env")` if `validateEnv` is still called, and everything from the auth-middleware line (`const { authenticateTenant } = …`) onward EXCEPT: remove `const authenticateAdmin = authenticateTenant;` and `const requireAdmin = makeRequireRole("admin");` only if no remaining `index.js` code uses them (Task 8 removed the admin routes; check remaining references — `requireAdmin` is no longer used, remove it; `JWT_SECRET` is now used only inside `src/routes/auth.js`, so remove the `index.js` copy).

Keep: `initAdmin`, `initSettings`, `seedProducts`, `initTemplates`, `initRAG`, `startServer`, `shutdown`, the `io.on("connection")` block (now also in app.js — delete the index.js copy to avoid double handlers; app.js owns it), process handlers, the `require.main === module` listen block, and `module.exports = { app, server, io, PORT, startServer, shutdown };`.

If `validateEnv()` was previously invoked at index.js module load (current line 128, inside the replaced range), re-add it at module scope in index.js (with its `require("./src/config/env")`), e.g. just before the `require.main === module` listen block:
```js
const { requireEnv, validateEnv } = require("./src/config/env");
validateEnv();
```
This preserves boot-time validation through Task 12's intermediate state. Task 13 then moves `validateEnv()` to the top of `src/server.js` (single entry) and removes the index.js copy.

- [ ] **Step 3: Verify**

Run: `node --check index.js; node --check src/app.js`
Expected: clean.

Run: `node --test "tests/*.test.js"`
Expected: 64 passing.

Boot smoke (PowerShell, from repo root):
```powershell
$env:PORT="3999"; $env:REDIS_URL="redis://127.0.0.1:6399"; $env:SUPABASE_URL="https://placeholder.supabase.co"; $env:SUPABASE_ANON_KEY="x"; $env:SUPABASE_SERVICE_KEY="x"; $env:JWT_SECRET="0123456789abcdef0123456789abcdef"; $env:TOKEN_ENCRYPTION_KEY="a1b2c3d4e5f60718293a4b5c6d7e8f90123456789abcdef0123456789abcdef"; $env:GROQ_API_KEY="x"; $env:GEMINI_API_KEY="x"; $env:FB_APP_SECRET="x"; $env:VERIFY_TOKEN="x"; $env:ALLOWED_ORIGINS="http://localhost:3000"; node index.js
```
Expected: boots to `Dashboard + API on Port 3999` / `BOOT OK`; Redis ECONNREFUSED warning is the expected local fallback. Kill the process (Ctrl+C) after confirming.

Run: `node scripts/route-audit.js diff`
Expected: `Route audit OK: 72 routes match snapshot.`

- [ ] **Step 4: Commit**

```bash
git add src/app.js index.js
git commit -m "refactor(app): composition root createApp() + rewire index.js"
```

---

### Task 13: Single entry point `src/server.js`, slim `index.js`, test rework

**Files:**
- Rewrite: `src/server.js`
- Modify: `index.js` (thin re-export)
- Modify: `tests/enforcement.test.js` (line 149 source-scan rework)

- [ ] **Step 1: Rewrite `src/server.js`**

```js
require("dotenv").config();
const path = require("path");
const bcrypt = require("bcryptjs");
const next = require("next");

const { createApp } = require("./app");
const { validateEnv } = require("./config/env");
const { connectDB, Admin, Settings, Product } = require("./config/db");
const { withSuperadmin } = require("./config/superadmin");
const { seedTemplates } = require("../utils/whatsappTemplates");
const { initPinecone, getIndexStats } = require("../utils/vectorDB");
const { startAutoPurgeCron } = require("../utils/dataRetention");
const { closeRedis } = require("../utils/dedup");
const { closeQueues } = require("../utils/queue");
const { closeWorkers } = require("../utils/worker");

validateEnv();

const dev = process.env.NODE_ENV !== "production";
const PORT = process.env.PORT || 3000;
const dashboardDir = path.join(__dirname, "..", "dashboard");
const nextApp = next({ dev, dir: dashboardDir });
const nextHandle = nextApp.getRequestHandler();

const { app, server, io } = createApp({ nextHandle });

// ─── INITIALIZE ADMIN ─────────────────────────────────────
async function initAdmin() {
  const existing = await Admin.findOne({ username: "admin" });
  if (!existing) {
    const bootstrap = process.env.BOOTSTRAP_ADMIN === "true" || process.env.NODE_ENV !== "production";
    if (bootstrap) {
      const password = process.env.ADMIN_PASSWORD;
      if (!password && process.env.NODE_ENV === "production") {
        console.error("❌ ERROR: ADMIN_PASSWORD must be configured in production when bootstrapping an admin!");
        process.exit(1);
      }
      const finalPassword = password || "admin123";
      const hashed = await bcrypt.hash(finalPassword, 10);
      await Admin.save({ username: "admin", password: hashed, role: "admin" });
      console.log(` Default admin created (admin/${password ? "******" : "admin123"})`);
    } else {
      console.log(" Skipping admin auto-bootstrap in production because BOOTSTRAP_ADMIN is not true.");
    }
  }
}

async function initSettings() {
  const existing = await Settings.findOne({ configId: "global" });
  if (!existing) {
    await Settings.save({ configId: "global" });
    console.log(" Default settings initialized");
  }
}

async function seedProducts() {
  const count = await Product.countDocuments();
  if (count === 0) {
    const { seedProducts } = require("../utils/seedProducts");
    await seedProducts();
    console.log(" Products seeded");
  } else {
    console.log(` Products already exist (${count} found). Skipping seed.`);
  }
}

async function initTemplates() {
  await seedTemplates();
}

async function initRAG() {
  try {
    await initPinecone();
    const stats = await getIndexStats();
    console.log(` [RAG] Vector DB: ${stats.totalVectors || 0} vectors indexed`);
  } catch (err) {
    console.log(" [RAG] Vector DB not available (set PINECONE_API_KEY to enable)");
  }
}

// ─── START SERVER ─────────────────────────────────────────
async function startServer() {
  await nextApp.prepare();
  console.log(" Dashboard (Next.js) ready");
  await connectDB();
  await withSuperadmin(async () => {
    await initAdmin();
    await initSettings();
    await seedProducts();
    await initTemplates();
  });
  await initRAG();
  startAutoPurgeCron();
  console.log(`\n${"─".repeat(50)}`);
  console.log(` Cyberbot AI Server`);
  console.log(` Dashboard + API on Port ${PORT}`);
  console.log(` FB_APP_ID: ${process.env.FB_APP_ID ? "Configured " : "MISSING "}`);
  console.log(` FB_APP_SECRET: ${process.env.FB_APP_SECRET ? "Configured " : "MISSING "}`);
  console.log(` VERIFY_TOKEN:  ${process.env.MESSENGER_VERIFY_TOKEN || process.env.VERIFY_TOKEN}`);
  console.log(` Redis: ${process.env.REDIS_URL || "redis://127.0.0.1:6379"}`);
  console.log(` Data Retention: auto-purge enabled (daily 3 AM)`);
  console.log(`${"─".repeat(50)}\n`);
}

async function shutdown() {
  console.log("\n [Server] Shutting down gracefully...");
  await new Promise((resolve) => server.close(resolve));
  io.close();
  await closeRedis().catch(() => {});
  await closeQueues().catch(() => {});
  await closeWorkers().catch(() => {});
  console.log(" [Server] Cleanup complete.");
}

process.on("unhandledRejection", (reason, promise) => {
  console.error(" Unhandled Rejection at:", promise, "reason:", reason);
});

process.on("uncaughtException", (err) => {
  console.error(" Uncaught Exception:", err.message);
  console.error(err.stack);
  shutdown();
  process.exit(1);
});

process.on("SIGINT", async () => { await shutdown(); process.exit(0); });
process.on("SIGTERM", async () => { await shutdown(); process.exit(0); });

if (require.main === module) {
  server.listen(PORT, async () => {
    try {
      await startServer();
    } catch (err) {
      console.error(" Failed to initialize server:", err.message);
      console.error(err.stack);
      process.exit(1);
    }
  });

  server.on("error", (err) => {
    if (err.code === "EADDRINUSE") {
      console.error(` Port ${PORT} is already in use. Please stop the other process or use a different port.`);
    } else {
      console.error(" Server error:", err.message);
    }
    process.exit(1);
  });

  process.stdin.resume();
}

module.exports = { app, server, io, PORT, startServer, shutdown };
```

- [ ] **Step 2: Slim `index.js`**

Replace the entire contents of `index.js` with:

```js
require("./src/server");
```

- [ ] **Step 3: Rework `tests/enforcement.test.js`**

> Note (deviation, applied during Task 2): the "defines withSuperadmin" assertion was already pulled forward to Task 2 (Task 2 removed `withSuperadmin` from index.js, which the original test scanned). The Task 2 version asserts `superadmin.js` defines it and that `index.js` wraps login/refresh/bootstrap; the regex accepts both `const withSuperadmin = ...` and `function withSuperadmin(...) { ... return runWithTenantContext }`. By Task 13 the login/refresh slices live in `auth.js` (moved in Task 5) and the bootstrap slice in `server.js`, so the final rework below is still required — replace the whole test.

Replace the test at lines 149–159 with (purpose preserved — `withSuperadmin` wraps still exist on login/refresh/bootstrap — only the scanned locations change):

```js
test("auth.js and server.js wrap superadmin-critical operations with withSuperadmin", () => {
  const fs = require("fs");
  const path = require("path");
  const superadminSrc = fs.readFileSync(
    path.join(__dirname, "..", "src", "config", "superadmin.js"), "utf8");
  assert.match(superadminSrc, /const withSuperadmin = .*runWithTenantContext/);

  const authSrc = fs.readFileSync(
    path.join(__dirname, "..", "src", "routes", "auth.js"), "utf8");
  const login = authSrc.slice(authSrc.indexOf('app.post("/api/auth/login"'), authSrc.indexOf('app.post("/api/auth/refresh"'));
  const refresh = authSrc.slice(authSrc.indexOf('app.post("/api/auth/refresh"'), authSrc.indexOf('app.post("/api/auth/logout"'));
  assert.match(login, /withSuperadmin\(/);
  assert.match(refresh, /withSuperadmin\(/);

  const serverSrc = fs.readFileSync(
    path.join(__dirname, "..", "src", "server.js"), "utf8");
  const bootStart = serverSrc.indexOf("await withSuperadmin(");
  const bootstrap = serverSrc.slice(bootStart, serverSrc.indexOf("startAutoPurgeCron", bootStart));
  assert.match(bootstrap, /withSuperadmin\(/);
});
```

- [ ] **Step 4: Verify**

Run: `node --check src/server.js; node --check index.js; node --check src/app.js`
Expected: clean.

Run: `node --test "tests/*.test.js"`
Expected: all pass (64 baseline with the reworked enforcement test).

Boot smoke BOTH entries (PowerShell, from repo root, same env block as Task 12):
1. `node src/server.js` → boots to `Dashboard + API on Port 3999`.
2. `node index.js` → boots identically (thin re-export).

Run: `node scripts/route-audit.js diff`
Expected: `Route audit OK: 72 routes match snapshot.`

- [ ] **Step 5: Commit**

```bash
git add src/server.js index.js tests/enforcement.test.js
git commit -m "refactor(entry): single entry src/server.js, thin index.js, update enforcement test"
```

---

### Task 14: Final verification + cleanup sweep

**Files:**
- Verify: all touched files, full suite, both boots, route audit
- Sweep: remove any dead requires left in `src/server.js` / `src/app.js` (e.g. unused model imports) that `node --check`-cleanup exposes, without touching behavior

- [ ] **Step 1: Full syntax + test verification**

Run: `node --check index.js; node --check src/server.js; node --check src/app.js; node --check src/routes/auth.js; node --check src/routes/webhooks.js; node --check src/routes/integrations.js; node --check src/routes/admin.js; node --check src/routes/ads.js; node --check src/routes/products.js; node --check src/routes/knowledge.js; node --check src/services/channels/messageHandlers.js; node --check src/services/channels/messenger.js; node --check src/services/channels/instagram.js`
Expected: all clean.

Run: `node --test "tests/*.test.js"`
Expected: all pass.

Run: `node scripts/route-audit.js diff`
Expected: `Route audit OK: 72 routes match snapshot.`

- [ ] **Step 2: Boot both entries one final time**

Repeat the Task 12/13 boot smoke for `node src/server.js` and `node index.js`; confirm both reach `Dashboard + API on Port 3999` and shut down cleanly on SIGINT (Ctrl+C) with the `[Server] Shutting down gracefully...` / `[Server] Cleanup complete.` output (proves `server.close → io.close → closeRedis → closeQueues → closeWorkers` order runs).

- [ ] **Step 3: Grep for leftover inline route registrations**

Run: `Select-String -Path "index.js","src/server.js" -Pattern "app\.(get|post|put|patch|delete)\("`
Expected: no matches (all routes live in `src/routes/*.js`; `index.js` is a one-line require; `src/server.js` only calls `createApp`).

- [ ] **Step 4: Commit any sweep fixes**

If Step 1/3 required changes:
```bash
git add -A
git commit -m "chore(monolith-split): final cleanup"
```
Otherwise: working tree should be clean (except pre-existing untracked `docs/` + modified `AGENTS.md`, which are out of scope per spec §8).

---

## Self-Review (against spec)

**1. Spec coverage:**
- §1 target structure → Tasks 2, 3, 4, 12, 13 (helpers, channel moves, messageHandlers, app.js, server.js, thin index.js). ✓
- §2 route grouping → Tasks 5–11; all 10 route modules created; `chat.js`/`orders.js`/`health.js` untouched. ✓
- §3 shared helpers → Task 2 (superadmin, tenantResolve, webhookHelpers, messageHelpers) + Task 4 (createMessageHandlers factory with explicit io/upsertUser/saveMessage). ✓
- §4 composition root ordering → Task 12 `createApp` preserves: health → orderRoutes → CORS → chatRoutes → authMiddleware deps → route groups → 404 → Next catch-all. ✓
- §5 entry point + graceful shutdown order (server.close → io.close → closeRedis → closeQueues → closeWorkers) → Task 13. ✓
- §6 test rework (enforcement.test.js:149 scans auth.js + server.js) → Task 13 Step 3. ✓
- §7 verification (64 tests, node --check, boot both, route-audit) → Tasks 13–14. ✓
- §8 out-of-scope → none of these introduced. ✓
- §9 risks → route-audit (Task 1) is the acceptance gate; dual-entry resolved (Task 13); hidden globals via factory (Task 4); ordering verified by boot + audit. ✓

**2. Placeholder scan:** all extraction tasks use text anchors + full module wrappers; new files are complete. The `// (verbatim from index.js:…)` markers are explicit cut instructions, not TODOs — every referenced block exists in the canonical file (verified during planning reads). No "similar to Task N", no "add error handling" placeholders.

**3. Type/signature consistency:**
- `createApp({ nextHandle }) → { app, server, io }` used identically in Task 12 (index.js) and Task 13 (server.js). ✓
- `createMessageHandlers({ io, upsertUser, saveMessage }) → { handleMessengerEvent, handleWhatsAppEvent, handleInstagramEvent }` defined Task 4, consumed Task 7 + Task 12. ✓
- `register*Routes(app, deps)` signatures: auth `{ authLimiter, authenticateAdmin, requireAdmin }`; webhooks `{ io, handleMessengerEvent, handleWhatsAppEvent, handleInstagramEvent }`; integrations/admin/ads/products/knowledge `{ adminLimiter, authenticateAdmin, requireAdmin }` (admin adds `io`). Consistent across Task 5–12. ✓
- `withSuperadmin`/`JWT_SECRET` resolved inside `auth.js` (module requires), matching `src/middleware/auth.js` precedent. ✓
- `resolveTenantFromRequest` re-exported by `chat.js` (kept aliases) so `chat.test.js` + `enforcement.test.js` imports stay valid. ✓
- `verifyWebhookToken(req, platform, globalToken)` + `getTenantByChannel(platform, externalId)` signatures unchanged. ✓

**Flagged deviations from spec (intentional, recorded):**
- `admin.js` deps omit `withSuperadmin` (no route uses it; YAGNI). Reviewer can re-add.
- `products.js` defines `withPublicTenant` internally rather than receiving it as a dep (only depends on leaf singletons per Style A).

**Known residual:** `node scripts/route-audit.js diff` includes routes registered by existing modules (`health`, `orders`, `chat`) on both sides, so the 72-route multiset is the correct equality target.
