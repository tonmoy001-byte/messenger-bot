/**
 * utils/refreshToken.js
 * Refresh token signing/verification helpers.
 */
const jwt = require("jsonwebtoken");

const REFRESH_TTL = "30d";

function signRefreshToken(payload, secret) {
  return jwt.sign(payload, secret, { expiresIn: REFRESH_TTL });
}

function verifyRefreshToken(token, secret) {
  try {
    return jwt.verify(token, secret);
  } catch {
    return null;
  }
}

module.exports = { signRefreshToken, verifyRefreshToken, REFRESH_TTL };
