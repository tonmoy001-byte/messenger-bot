# Security Policy & Hardening Guide

This document describes the security model, configuration guidelines, and threat mitigations for the Cyberbot multi-tenant customer automation application.

---

## 🔐 Core Security Principles

1. **No Hardcoded Cryptographic Fallbacks**
   The application strictly forbids default insecure strings for sensitive parameters such as `JWT_SECRET` and `TOKEN_ENCRYPTION_KEY`. The application validates environment parameters on startup and **fails hard** (terminating the process with `exit(1)`) if they are missing or insecure.

2. **Mandatory Webhook Signature Verification**
   In a production environment (`NODE_ENV=production`), all incoming Meta webhooks (Messenger, WhatsApp, Instagram) require valid `x-hub-signature-256` headers validated timing-safely via `crypto.timingSafeEqual` against the configured `FB_APP_SECRET`. Unsigned or invalid requests are strictly rejected with `403 Forbidden`.

3. **CORS Allow-listing**
   Cross-Origin Resource Sharing (CORS) is restricted. The server reads `ALLOWED_ORIGINS` to allow-list specific hostnames for browser requests and Socket.IO. Allowing `*` is prohibited in production.

4. **Multi-Tenant Scoping & Context Propagation**
   Database operations automatically scope queries to the active tenant (`tenant_id`) resolved from the authenticated JWT session using Node's `AsyncLocalStorage` request boundary context. Standard reads automatically filter out soft-deleted objects (`deleted_at IS NULL`).

---

## 🛠️ Startup Security Checks

The application evaluates environment variables at launch time. The checklist includes:

- **`JWT_SECRET`**: Must be present and at least 16 characters. Default fallback values are rejected.
- **`TOKEN_ENCRYPTION_KEY`**: Must be exactly 32 characters for AES-256-GCM. Common default strings are rejected.
- **`SUPABASE_URL` and `SUPABASE_ANON_KEY`**: Must be present.
- **`FB_APP_SECRET`** and **`VERIFY_TOKEN`**: Required in production for secure webhook operations.

---

## 📦 Webhook Verification Timing Attack Mitigations

The verification routines for Shopify and WooCommerce signatures utilize constant-time string comparisons to prevent timing-based side-channel attacks.

```javascript
// Timing-safe comparison implemented on Webhooks:
const hashBuffer = Buffer.from(hash, "utf8");
const hmacBuffer = Buffer.from(hmac, "utf8");
if (hashBuffer.length !== hmacBuffer.length) {
  return false;
}
return crypto.timingSafeEqual(hashBuffer, hmacBuffer);
```

---

## 🚀 Production Deployment Checklist

Before deploying Cyberbot to production, verify the following configuration:

- [ ] Set `NODE_ENV=production`.
- [ ] Supply a strong, uniquely generated 32-character string for `TOKEN_ENCRYPTION_KEY`.
- [ ] Supply a strong, uniquely generated secret for `JWT_SECRET`.
- [ ] Configure `ALLOWED_ORIGINS` with your precise dashboard frontend domain(s).
- [ ] Configure `FB_APP_SECRET` to validate incoming webhooks.
- [ ] Set `BOOTSTRAP_ADMIN=false` once the initial admin account has been created.
