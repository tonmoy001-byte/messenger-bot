# 🤖 Cyberbot — AI-Powered Customer Automation

A Node.js-powered multi-channel chatbot that uses **OpenRouter AI** to automatically reply to customer messages on Facebook Messenger, WhatsApp, and your website — with order management and a real-time admin dashboard.

---

## ✨ Features

- 📱 **Multi-Channel**: Facebook Messenger, WhatsApp, and Website chat
- 🤖 **AI Auto-Reply**: Uses OpenRouter with model rotation fallback
- 🛒 **Order Management**: AI-guided ordering with product catalog
- 📊 **Real-Time Dashboard**: Monitor conversations, orders, and analytics
- 🔐 **Secure Admin Panel**: JWT authentication with login
- 🧠 **Context-Aware**: Per-user conversation history
- 📦 **Product Catalog**: Dynamic products, courses, and services
- 🔄 **Live Updates**: Socket.io for real-time dashboard updates

---

## 📁 Project Structure

```
messenger-bot/
├── index.js              ← Main Express server
├── gemini.js             ← AI provider (OpenRouter)
├── messenger.js          ← Facebook Messenger API
├── whatsapp.js           ← WhatsApp Business API
├── knowledge.js          ← Business knowledge base
├── security.js           ← Encryption utilities
├── db.js                 ← MongoDB schemas
├── start-all.js          ← Combined startup script
├── dashboard/            ← React admin dashboard
│   ├── src/
│   │   ├── pages/        ← Dashboard pages
│   │   ├── components/   ← UI components
│   │   └── services/     ← API service
│   └── package.json
├── routes/               ← API routes
│   ├── products.js       ← Product & order endpoints
│   └── ...
├── utils/                ← Utilities
│   ├── orderFlow.js      ← Order conversation flow
│   ├── seedProducts.js   ← Sample product seeder
│   └── tokenManager.js   ← Unified token management
└── public/               ← Dashboard build output
```

---

## 🚀 Quick Start

### 1. Install Dependencies

```bash
npm install
```

### 2. Configure Environment Variables

Edit `.env` with your credentials:

```env
# Server
PORT=3000
MONGODB_URI=your_mongodb_connection_string

# Facebook Messenger
VERIFY_TOKEN=your_verify_token
PAGE_ACCESS_TOKEN=your_page_access_token

# WhatsApp Business
WHATSAPP_TOKEN=your_whatsapp_token
WHATSAPP_PHONE_NUMBER_ID=your_phone_number_id

# AI Engine (OpenRouter)
OPENROUTER_API_KEY=your_openrouter_key

# Security
JWT_SECRET=your_jwt_secret
TOKEN_ENCRYPTION_KEY=your_32_char_encryption_key
ADMIN_PASSWORD=admin123
```

### 3. Start Everything

```bash
npm start
```

This starts:
- **Backend Server** on `http://localhost:3000`
- **ngrok Tunnel** for public webhook access
- **Dashboard** served from the same server

---

## 📊 Admin Dashboard

**Access**: `http://localhost:3000`

**Default Login**:
- Username: `admin`
- Password: `admin123`

**Features**:
- 📈 Dashboard stats and analytics
- 💬 Real-time conversations
- 👥 Customer management
- 📦 Order tracking
- ⚙️ Bot settings
- 🔗 Meta integrations

---

## 🛒 Order Flow

The AI can guide customers through ordering:

1. Customer asks to buy something
2. AI shows available products
3. Customer selects product and quantity
4. AI collects delivery address and phone
5. AI confirms order summary
6. Customer confirms → Order saved as "pending"
7. Admin verifies and updates status in dashboard

---

## 🔧 Webhook Setup

### Facebook Messenger
1. Go to **Messenger → Webhooks** in Facebook Developer
2. **Callback URL**: `https://your-ngrok-url.ngrok-free.dev/webhook/messenger`
3. **Verify Token**: `your_verify_token`

### WhatsApp Business
1. Go to **WhatsApp → Configuration**
2. **Callback URL**: `https://your-ngrok-url.ngrok-free.dev/webhook/whatsapp`
3. **Verify Token**: `your_verify_token`
4. Subscribe to `messages` field

---

## 📋 Environment Variables

| Variable | Description |
|----------|-------------|
| `PORT` | Server port (default: 3000) |
| `MONGODB_URI` | MongoDB connection string |
| `VERIFY_TOKEN` | Webhook verification token |
| `PAGE_ACCESS_TOKEN` | Facebook Page access token |
| `WHATSAPP_TOKEN` | WhatsApp Business API token |
| `WHATSAPP_PHONE_NUMBER_ID` | WhatsApp phone number ID |
| `OPENROUTER_API_KEY` | OpenRouter API key for AI |
| `JWT_SECRET` | JWT signing secret |
| `TOKEN_ENCRYPTION_KEY` | AES encryption key (32 chars) |
| `ADMIN_PASSWORD` | Default admin password |

---

## ⚠️ Important Notes

- Keep your `.env` file private — never commit it to GitHub
- Facebook requires **HTTPS** URLs for webhooks (ngrok provides this)
- Free ngrok URLs change on restart — update webhook URL accordingly
- For production, deploy to Railway, Render, or a VPS

---

*Built with ❤️ using Node.js, Express, OpenRouter AI, Socket.io, and React*