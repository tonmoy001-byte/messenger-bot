/**
 * utils/escalation.js
 * Detect when a customer explicitly asks to speak to a human.
 */
const ESCALATION_PATTERNS = [
  /\b(talk|speak|connect|transfer|chat)\s+(to|with)\s+(a\s+)?(human|person|agent|representative|someone)\b/i,
  /\b(real)\s+(person|human|agent)\b/i,
  /\b(human)\s+(support|agent|representative|help)\b/i,
  /\b(মানুষ|এজেন্ট|সাপোর্ট)\s+(সাথে|সাথে কথা)\b/,
];

function shouldEscalate(message) {
  if (!message) return false;
  return ESCALATION_PATTERNS.some(p => p.test(message));
}

module.exports = { shouldEscalate };
