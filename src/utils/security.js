/**
 * security.js
 * ─────────────────────────────────────────────────────────────
 * AES-256-GCM encryption/decryption for sensitive tokens.
 * Requires TOKEN_ENCRYPTION_KEY in .env (min 32 chars).
 * Uses a random salt per encryption for proper key derivation.
 * ─────────────────────────────────────────────────────────────
 */

const crypto = require("crypto");
require("dotenv").config();
const { requireEnv } = require("../config/env");

const ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 16;
const SALT_LENGTH = 32;
const KEY = requireEnv("TOKEN_ENCRYPTION_KEY", {
  minLength: 32,
  forbid: ["temporary-key-do-not-use-in-production-123", "your_32_char_encryption_key_here"]
});

/**
 * Encrypt a string using AES-256-GCM with a random salt.
 * Format: salt:iv:tag:encrypted (all hex)
 * @param {string} text - The string to encrypt (e.g., access token)
 * @returns {string|null}
 */
function encrypt(text) {
  if (!text) return null;

  const salt = crypto.randomBytes(SALT_LENGTH);
  const cryptoKey = crypto.scryptSync(KEY, salt, 32);
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, cryptoKey, iv);

  let encrypted = cipher.update(text, "utf8", "hex");
  encrypted += cipher.final("hex");

  const tag = cipher.getAuthTag();

  return `${salt.toString("hex")}:${iv.toString("hex")}:${tag.toString("hex")}:${encrypted}`;
}

/**
 * Decrypt a value produced by encrypt().
 * Supports both new format (salt:iv:tag:data) and legacy format (iv:tag:data)
 * for backward compatibility during migration.
 * @param {string} encryptedText
 * @returns {string|null}
 */
function decrypt(encryptedText) {
  if (!encryptedText) return null;

  try {
    const parts = encryptedText.split(":");

    let salt, iv, tag, contentHex;

    if (parts.length === 4) {
      // New format: salt:iv:tag:encrypted
      const [saltHex, ivHex, tagHex, dataHex] = parts;
      salt = Buffer.from(saltHex, "hex");
      iv = Buffer.from(ivHex, "hex");
      tag = Buffer.from(tagHex, "hex");
      contentHex = dataHex;
    } else if (parts.length === 3) {
      // Legacy format: iv:tag:encrypted (fixed salt "salt")
      const [ivHex, tagHex, dataHex] = parts;
      salt = Buffer.from("salt", "utf8");
      iv = Buffer.from(ivHex, "hex");
      tag = Buffer.from(tagHex, "hex");
      contentHex = dataHex;
    } else {
      throw new Error("Invalid encrypted format");
    }

    const cryptoKey = crypto.scryptSync(KEY, salt, 32);
    const decipher = crypto.createDecipheriv(ALGORITHM, cryptoKey, iv);
    decipher.setAuthTag(tag);

    let decrypted = decipher.update(contentHex, "hex", "utf8");
    decrypted += decipher.final("utf8");

    return decrypted;
  } catch (err) {
    console.error("❌ Decryption Error:", err.message);
    return null;
  }
}

/**
 * Verify Meta webhook signature (Facebook Messenger / WhatsApp)
 * @param {string|object} payload - The raw request body or string
 * @param {string} signature - The X-Hub-Signature-256 header value
 * @param {string} appSecret - The app secret from Meta developer dashboard
 * @returns {boolean} - True if signature is valid
 */
function verifyMetaSignature(payload, signature, appSecret) {
  if (!signature || !appSecret) {
    console.warn("⚠️ Signature verification: Missing signature or app secret");
    return false;
  }

  try {
    const payloadString = typeof payload === "string" ? payload : JSON.stringify(payload);
    const expectedSignature = "sha256=" + crypto.createHmac("sha256", appSecret)
      .update(payloadString, "utf8")
      .digest("hex");

    const signatureBuffer = Buffer.from(signature, "utf8");
    const expectedBuffer = Buffer.from(expectedSignature, "utf8");

    if (signatureBuffer.length !== expectedBuffer.length) {
      return false;
    }

    return crypto.timingSafeEqual(signatureBuffer, expectedBuffer);
  } catch (err) {
    console.error("❌ Signature verification error:", err.message);
    return false;
  }
}

module.exports = { encrypt, decrypt, verifyMetaSignature };
