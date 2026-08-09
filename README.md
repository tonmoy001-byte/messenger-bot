# 🤖 Cyberbot — AI-Powered Customer Automation

A Node.js/Express multi-channel chatbot that uses **Groq (Qwen)** with **Gemini fallback** to automatically reply to customer messages on Facebook Messenger, WhatsApp, Instagram, and your website — with order management, knowledge-base RAG, and a real-time Next.js admin dashboard.

---

## ✨ Features

- 📱 **Multi-Channel**: Facebook Messenger, WhatsApp, Instagram, and Website chat widget
- 🤖 **AI Auto-Reply**: Groq (Qwen 2.5 72B) primary, Gemini 2.5 Flash fallback, model rotation
- 🛒 **Order Management**: AI-guided ordering with product catalog, payments (bKash/Nagad), WooCommerce/Shopify
- 📊 **Real-Time Dashboard**: Next.js 16 (App Router) admin panel with analytics
- 🔐 **RBAC/Multi-Tenant Security**: JWT auth, role-based access, tenant isolation
- 🧠 **Context-Aware**: Per-user conversation history, RAG knowledge base
- 🔄 **Reliable Delivery**: BullMQ queues, idempotency, retry + dead-letter queue
- ⚙️ **Live Updates**: Socket.io for real-time dashboard updates

---

## 🧱 Tech Stack

| Layer      | Technology |
|------------|------------|
| Backend    | Node.js, Express, Socket.IO |
| Database   | Supabase (PostgreSQL) via `@supabase/supabase-js` |
| AI         | Groq `qwen/qwen-2.5-72b` (primary), Gemini 2.5 Flash (fallback) |
| Queues     | BullMQ + Redis (dedup, retry, DLQ) |
| RAG        | Pinecone vector DB + embeddings |
| Dashboard  | Next.js 16 (App Router), shadcn/ui, Tailwind CSS 4 |
| Auth       | JWT (httpOnly cookie) + RBAC |

---

## 📁 Project Structure

```
messenger-bot/
├── src/
│   ├── server.js              ← Production entry point (Next.js + Express)
│   ├── config/                ← db.js, env.js, supabaseClient.js
│   ├── middleware/auth.js     ← JWT / RBAC middleware
│   ├── services/
│   │   ├── ai/gemini.js       ← AI provider (Groq → Gemini fallback)
│   │   └── channels/whatsapp.js
│   └── utils/security.js      ← Encryption utilities
├── index.js                   ← Express server + all API routes + webhooks
├── messenger.js               ← Facebook Messenger API
├── instagram.js               ← Instagram API
├── knowledge.js               ← Knowledge base helpers
├── start-all.js               ← Combined startup script
├── utils/                     ← Order flow, RAG, RBAC, queues, retry, etc.
├── dashboard/                 ← Next.js 16 admin dashboard
│   └── src/
│       ├── app/               ← App Router pages (login, dashboard/*)
│       ├── components/        ← shadcn/ui + layout components
│       └── lib/               ← API client + proxy
├── public/embed/chat-widget.html
└── tests/                     ← node:test unit tests
```

---

## 🚀 Quick Start

### 1. Install dependencies

```bash
npm install
```

Installs root deps **and** the `dashboard/` deps automatically (via `postinstall`).

### 2. Configure environment variables

Copy `.env.example` to `.env` and fill in **strong, unique values**:

```bash
cp .env.example .env
```

**Required security variables (app will refuse to start with weak/missing values):**

```env
# Must be a strong unique secret (min 16 chars). Never use example values.
JWT_SECRET=

# Must be exactly 32+ characters. Generate with:
# node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
TOKEN_ENCRYPTION_KEY=

# Database
SUPABASE_URL=
SUPABASE_ANON_KEY=
SUPABASE_SERVICE_KEY=

# AI
GROQ_API_KEY=
GEMINI_API_KEY=

# Meta / channels (required in production)
VERIFY_TOKEN=
PAGE_ACCESS_TOKEN=
FB_APP_SECRET=

# Queue
REDIS_URL=redis://localhost:6379

# CORS (comma-separated origins in production)
ALLOWED_ORIGINS=

# Optional: allow one-time admin bootstrap in non-production
BOOTSTRAP_ADMIN=false
ADMIN_PASSWORD=
```

Run the Supabase schema migration first:

```bash
psql "$SUPABASE_URL" -f migration.sql
```

> **Important:** The migration only adds multi-tenant columns. Your core tables (users, orders, products, etc.) must already exist or be created separately.

### 3. Start the server

```bash
npm run start
```

This prepares the Next.js dashboard and starts Express — available at:

- **Dashboard**: `http://localhost:3000/dashboard`
- **API**: `http://localhost:3000/api/admin/stats`

Create your first admin via the bootstrap flow (if enabled) or by inserting a hashed password into the `admins` table. **Never use `admin123` or other default passwords in any environment.**

> For public webhook access, expose port 3000 with a tunnel (ngrok, Cloudflare Tunnel, etc.) and point your Meta webhook URLs to it.

---

## 🔧 Webhook Setup

### Facebook Messenger
1. Go to **Messenger → Webhooks** in the [Meta Developer Portal](https://developers.facebook.com)
2. **Callback URL**: `https://your-public-url/webhook/messenger`
3. **Verify Token**: must match `VERIFY_TOKEN` in your `.env`
4. Subscribe to the `messages` field

**Instagram**: same callback pattern via `/webhook/instagram`.

**WhatsApp**: subscribe to `messages` on `/webhook/whatsapp`.

Full app-setup walkthrough: see [`META_SETUP.md`](META_SETUP.md).

---

## 🛒 Order Flow

1. Customer asks to buy something
2. AI shows available products
3. Customer selects product and quantity
4. AI collects delivery address and phone
5. AI confirms order summary
6. Customer confirms → order saved as `pending`
7. Admin verifies and updates status in the dashboard

---

## 🧪 Testing

Uses the built-in `node:test` runner (no Jest needed):

```bash
npm test
npm run test:unit
```

## ⚠️ Security & Production Notes

- Keep `.env` private — never commit it
- The app **fails hard** if `JWT_SECRET` or `TOKEN_ENCRYPTION_KEY` are missing or use known weak defaults
- Meta webhooks require **HTTPS**
- Set `ALLOWED_ORIGINS` in production
- Use a strong unique password for every admin account
- For production, deploy behind a reverse proxy with TLS, managed Redis, and proper monitoring
- Recommended platforms: Railway, Render, Fly.io, or a hardened VPS

---

*Built with Node.js, Express, Groq/Gemini, Supabase, BullMQ, Socket.IO, and Next.js*
