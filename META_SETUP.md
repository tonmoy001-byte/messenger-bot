# Meta App Setup Guide

To use the "Connect with Meta" feature, you must configure a Meta App on the [Facebook Developer Portal](https://developers.facebook.com).

## 1. Create a Meta App
1.  Go to [Meta for Developers](https://developers.facebook.com/apps).
2.  Click **Create App**.
3.  Select **Other** as the use case.
4.  Select **Business** as the app type.
5.  Enter your App Name and Contact Email.

## 2. Add Products
Add the following products to your app:
- **Facebook Login for Business** (Crucial for multi-platform OAuth)
- **Messenger**
- **Instagram Graph API**
- **WhatsApp Cloud API**

## 3. Configure OAuth Settings
In **Facebook Login for Business > Settings**:
- **Valid OAuth Redirect URIs**: 
  - `https://sparrowless-forthcomingly-skyler.ngrok-free.dev/api/auth/meta/callback`
- **Allowed Domains for the JavaScript SDK**:
  - `sparrowless-forthcomingly-skyler.ngrok-free.dev`

## 4. Connection Types & Permissions
Our integration now supports granular connections. Depending on the button clicked, the following scopes will be requested:

| Type | Purpose | Key Permissions |
| :--- | :--- | :--- |
| **Facebook Page** | Read page info & posts | `pages_show_list`, `pages_read_engagement` |
| **Messenger** | Enable AI chat replies | `pages_show_list`, `pages_messaging` |
| **WhatsApp** | Connect Cloud API | `whatsapp_business_management`, `whatsapp_business_messaging` |

## 5. Webhooks Configuration
Set your Webhook Callback URL to:
- `https://sparrowless-forthcomingly-skyler.ngrok-free.dev/webhook/messenger` (and same for WhatsApp)
- **Verify Token**: Must match `VERIFY_TOKEN` in your `.env`.

## 6. Environment Variables (.env)
Add these to your root `.env` file:
```env
FB_APP_ID=your_app_id
FB_APP_SECRET=your_app_secret
TOKEN_ENCRYPTION_KEY=your_32_character_secret_key
REDIRECT_URI=https://sparrowless-forthcomingly-skyler.ngrok-free.dev/api/auth/meta/callback
```
> [!IMPORTANT]
> Keep your `TOKEN_ENCRYPTION_KEY` secret. If lost, you will not be able to decrypt existing tokens in the database.
