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
│   ├── config/                ← db.js, supabaseClient.js
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

Copy `.env.example` to `.env` and fill in your credentials:

```bash
cp .env.example .env
```

Key variables:

```env
# Server
PORT=3000

# Database (Supabase)
SUPABASE_URL=your_project_url
SUPABASE_ANON_KEY=your_anon_key
SUPABASE_SERVICE_KEY=your_service_role_key

# AI (Groq + Gemini fallback)
GROQ_API_KEY=your_groq_api_key
GEMINI_API_KEY=your_gemini_api_key

# Facebook Messenger
VERIFY_TOKEN=your_verify_token
PAGE_ACCESS_TOKEN=your_page_access_token

# WhatsApp
WHATSAPP_TOKEN=your_whatsapp_token
WHATSAPP_PHONE_NUMBER_ID=your_phone_number_id

# Queue
REDIS_URL=redis://localhost:6379

# Security
JWT_SECRET=your_jwt_secret
TOKEN_ENCRYPTION_KEY=your_32_char_encryption_key
ADMIN_PASSWORD=admin123
```

Run the Supabase schema migration first:

```bash
psql "$SUPABASE_URL" -f migration.sql
```

### 3. Start the server

```bash
npm run start
```

This prepares the Next.js dashboard and starts Express — available at:

- **Dashboard**: `http://localhost:3000/dashboard`
- **API**: `http://localhost:3000/api/admin/stats`

**Default login**: `admin` / `admin123`

> For public webhook access, expose port 3000 with ngrok and point your Meta webhook URLs to the tunnel.

---

## 🔧 Webhook Setup

### Facebook Messenger
1. Go to **Messenger → Webhooks** in the [Meta Developer Portal](https://developers.facebook.com)
2. **Callback URL**: `https://your-ngrok-url.ngrok-free.dev/webhook/messenger`
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

## ⚠️ Important Notes

- Keep `.env` private — never commit it
- Meta webhooks require **HTTPS** (ngrok provides this)
- Free ngrok URLs change on restart — update webhook URLs accordingly
- For production, deploy to Railway, Render, or a VPS

---

*Built with Node.js, Express, Groq/Gemini, Supabase, BullMQ, Socket.IO, and Next.js*