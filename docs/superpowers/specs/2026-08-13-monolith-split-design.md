# Design: Phase 2 Monolith Split — Extract Routes, Single Entry Point, Channel Helpers

**Goal:** Shrink the `index.js` god-file (1798 LOC, 68 inline route handlers) so routes are individually securable/testable, and give the repo one clean entry point. Behavior unchanged; all tests pass before and after.

**Status:** Approved 2026-08-13 (design presented; refinements folded in below).

**Roadmap source:** `docs/ROADMAP.md` Phase 2 (§3.1–3.4). This plan covers the whole of Phase 2.

---

## 1. Target structure

```
index.js                       → thin: require("./src/server") (kept so `node index.js` still works)
src/server.js                  → OWNER: dotenv, env validation, Next.js prepare, listen,
                                 init sequence, graceful shutdown, signal handlers
src/app.js                     → composition root: builds Express app + http server + socket.io,
                                 wires body parsers/static/CORS/limiters, registers ALL register*Routes,
                                 returns { app, server, io }
src/routes/                    → auth.js, webhooks.js, admin.js, products.js, knowledge.js,
                                 ads.js, integrations.js + existing chat.js, orders.js, health.js
src/services/channels/         → messenger.js + instagram.js (MOVED from root),
                                 whatsapp.js (exists), messageHandlers.js (3 inline handler blocks)
src/config/superadmin.js       → SUPERADMIN_CONTEXT + withSuperadmin (extracted from index.js:17-18)
src/utils/tenantResolve.js     → resolveTenantFromRequest (extracted from chat.js; shared)
src/utils/webhookHelpers.js    → verifyWebhookToken + getTenantByChannel (extracted from index.js:21-59)
src/utils/messageHelpers.js    → upsertUser + saveMessage (extracted from index.js:190-200)
scripts/route-audit.js         → automated route-map diff (before/after split, prevents drift)
```

Root `messenger.js` / `instagram.js` are deleted after moving (verified: only `index.js` imports them).
`package.json` already points at `src/server.js`; Docker + `start-all.js` keep working unchanged.

## 2. Route module grouping

Style **A**: models/utils are required directly by each module (singletons); only genuinely
runtime values (io, limiters, auth middleware, `withSuperadmin`, `JWT_SECRET`, shared helpers)
are passed via the existing `register*Routes(app, deps)` signature. This matches the precedent
set by `chat.js` (DI for runtime deps) and `orders.js`/`health.js` (require deps directly).

| Module | Routes | Runtime deps passed |
|---|---|---|
| `auth.js` | signup, login, refresh, logout, meta/url, meta/callback | `authLimiter`, `authenticateAdmin`, `requireAdmin`, `withSuperadmin`, `JWT_SECRET` |
| `webhooks.js` | messenger/whatsapp/instagram GET+POST | `io`, message handler fns (created in app.js) |
| `admin.js` | conversations, messages, reply, orders, customers, settings, stats, exports, search, notifications, team, feedback, analytics, ai-performance | `io`, limiters, auth, `withSuperadmin` |
| `products.js` | public `/api/products` + admin product CRUD | `withPublicTenant`, auth, limiters |
| `knowledge.js` | knowledge base CRUD/upload/reindex | auth, limiters |
| `ads.js` | ads CRUD + clicks/stats | auth, limiters |
| `integrations.js` | social + shopify/woo + ecommerce connections | auth, limiters |
| `chat.js` | existing web chat (unchanged contract) | existing deps |
| `orders.js` | existing order API (unchanged contract) | none beyond current |
| `health.js` | existing health/ready (unchanged) | none |

`register*Routes` signatures are the shared boundary. Each module keeps its existing idempotency
flag (`app.__<name>RoutesRegistered`) to stay safe if both entries ever load.

## 3. Shared helper extraction (avoids hidden globals)

- **`src/config/superadmin.js`** — `SUPERADMIN_CONTEXT` + `withSuperadmin(fn)`. Imported by `auth.js` (login/refresh wraps), `server.js` (bootstrap init), `admin.js` where needed. Single definition.
- **`src/utils/tenantResolve.js`** — `resolveTenantFromRequest(req)`, moved from `chat.js`.
  Both `chat.js` (web chat) and `products.js` (`withPublicTenant`) import it from here. One place.
  `chat.js` keeps `resolveWebChatTenant` as a thin re-export alias so existing imports stay valid.
- **`src/utils/webhookHelpers.js`** — `verifyWebhookToken(req, platform, globalToken)` +
  `getTenantByChannel(platform, externalId)` (uses `channelCache`). Used by `webhooks.js`.
- **`src/utils/messageHelpers.js`** — `upsertUser(uid, platform, name, profilePic)` +
  `saveMessage(uid, role, content, mediaUrl, platform)`. Used by `messageHandlers.js` and `chat.js`.
- **`src/services/channels/messageHandlers.js`** — the three inline handler blocks
  (`handleMessengerEvent`, `handleWhatsAppEvent`, `handleInstagramEvent`) moved verbatim.
  Exposed as a factory so runtime-only deps stay explicit, no hidden globals:
  `createMessageHandlers({ io, upsertUser, saveMessage })` → `{ handleMessengerEvent, handleWhatsAppEvent, handleInstagramEvent }`.
  All other deps (Settings, User, generateReply, extractAdContext, isDuplicate, send helpers,
  etc.) are required directly from their modules. Any additional runtime-only dep currently
  closed over (limiters, settings loaders) is added to the factory args at extraction time.

## 4. Composition root (`src/app.js`)

Owns: Express app + `http.createServer` + socket.io (CORS config) + body parsers (with
`req.rawBody` verify) + static + the CORS middleware block + limiters + Next.js dashboard
handling via the passed-in `nextHandle`, then registers every `register*Routes(app, deps)`
in the current order. Returns `{ app, server, io }`.

Current ordering is preserved exactly:
health → orderRoutes → CORS middleware → chatRoutes → authMiddleware deps → inline route
groups (now modules) → 404 handlers → Next.js catch-all (last).

## 5. Entry point (`src/server.js`)

Single real entry. Owns: dotenv, `validateEnv()`, `next.prepare()`, `connectDB()`,
`withSuperadmin` init sequence (`initAdmin`, `initSettings`, `seedProducts`, `initTemplates`),
`initRAG()`, `startAutoPurgeCron()`, `server.listen(PORT)`, signal handlers (SIGINT/SIGTERM),
`uncaughtException`/`unhandledRejection`, `require.main === module` guard.

**Graceful shutdown** — same order as today, plus explicit HTTP/socket close:
1. `server.close()` (stop accepting new HTTP connections)
2. `io.close()` (stop Socket.IO)
3. `closeRedis()`
4. `closeQueues()`
5. `closeWorkers()`
then `process.exit(0)`. Today the process exits via `process.exit` after Redis/queues/workers;
adding the HTTP/socket close first keeps the same relative order of resource teardown.

`index.js` becomes: `require("./src/server");` (plus nothing else), so `node index.js`,
Docker `CMD`, and `start-all.js` all remain valid.

## 6. Test changes (required, in-scope)

- `tests/enforcement.test.js:149` source-scans `index.js` for `withSuperadmin` wraps on
  login/refresh/bootstrap. Rework to scan the new locations:
  - login/refresh → `src/routes/auth.js`
  - bootstrap (`await withSuperadmin(` … `startAutoPurgeCron`) → `src/server.js`
  The test's *purpose* (wraps exist) is preserved; only the scanned file paths change.
- No other test reads `index.js` source (verified by grep). Route-module tests
  (`orders.test.js`, `chat.test.js`) import from `src/routes/*` already and are unaffected.

## 7. Verification

1. `node --test "tests/*.test.js"` — all pass (64 baseline + updated enforcement test).
2. `node --check` on every touched file.
3. Boot `node src/server.js` AND `node index.js` — both start cleanly.
4. **Route-map audit (automated):** `scripts/route-audit.js` greps `app.(get|post|put|patch|delete)(`
   across `index.js` (pre-split, committed as a snapshot) vs. `src/routes/*.js` (post-split).
   It verifies the multiset of `METHOD /path` strings is identical. The script is kept so future
   route changes can be diffed the same way (prevents drift). Recorded: this is a one-time
   behavioral-equality check; a permanent CI gate is optional and not in scope.

## 8. Out of scope (recorded)

- Moving remaining inline handler logic into more granular modules beyond `messageHandlers.js`.
- Adding new routes or changing route behavior.
- Live-DB migration application (separate Phase 1 ops item, blocked on DB credentials).
- New tests for cross-tenant E2E (Phase 1 §2.3 in ROADMAP, separate effort).
- Committing to `docs/` plan/spec + `AGENTS.md` (separate doc/hygiene commit).

## 9. Risks & mitigations

- **Route drift / lost routes** → automated route-audit script (above) is the acceptance gate.
- **Dual-entry confusion** → single entry `src/server.js`; `index.js` is a one-line re-export.
- **Handler hidden globals** → `createMessageHandlers({...})` factory makes runtime deps explicit.
- **Ordering regression** (CORS before routes, catch-all last) → app.js preserves current
  registration order; verified by boot + route-audit.
- **Circular requires** between app.js → route modules → helpers → config: helpers are leaf
  modules (require only config/utils, never app.js), so no cycles.