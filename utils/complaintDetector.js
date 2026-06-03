/**
 * utils/complaintDetector.js
 * ────────────────────────────────────────────────────────────
 * Detects complaints, frustration, and human handoff requests.
 * Returns: { isComplaint, isHandoffRequest, sentiment, confidence }
 * ────────────────────────────────────────────────────────────
 */

const COMPLAINT_KEYWORDS = [
  "complaint", "complain", "problem", "issue", "broken", "not working", "defective",
  "damaged", "wrong", "error", "fail", "failed", "disappointed", "angry", "frustrated",
  "worst", "terrible", "bad quality", "refund", "return", "cancel", "scam", "fraud",
  "cheat", "useless", "waste", "horrible", "awful", "unacceptable", "ridiculous",
  "অভিযোগ", "সমস্যা", "ভাঙা", "নষ্ট", "খারাপ", "ফেরত", "রাগ", "বিরক্ত"
];

const HANDOFF_KEYWORDS = [
  "human", "agent", "person", "real person", "talk to someone", "speak to", "representative",
  "support", "manager", "supervisor", "customer service", "live chat", "call me",
  "মানুষ", "এজেন্ট", "কল", "সাপোর্ট", "ম্যানেজার"
];

const NEGATIVE_KEYWORDS = [
  "sad", "unhappy", "disappointed", "upset", "annoyed", "irritated", "frustrated",
  "angry", "furious", "disgusted", "hate", "dislike", "boring", "slow", "expensive",
  "দুঃখিত", "রাগ", "বিরক্ত", "খারাপ"
];

function detectComplaint(message) {
  const msg = message.toLowerCase();
  let complaintScore = 0;
  let handoffScore = 0;
  let negativeScore = 0;

  for (const keyword of COMPLAINT_KEYWORDS) {
    if (msg.includes(keyword.toLowerCase())) complaintScore += 2;
  }
  for (const keyword of HANDOFF_KEYWORDS) {
    if (msg.includes(keyword.toLowerCase())) handoffScore += 2;
  }
  for (const keyword of NEGATIVE_KEYWORDS) {
    if (msg.includes(keyword.toLowerCase())) negativeScore += 1;
  }

  // Check for caps (shouting)
  const capsRatio = (message.match(/[A-Z]/g) || []).length / message.length;
  if (capsRatio > 0.5 && message.length > 10) negativeScore += 2;

  // Check for exclamation marks
  const exclamationCount = (message.match(/!/g) || []).length;
  if (exclamationCount > 2) negativeScore += 1;

  const isComplaint = complaintScore >= 2;
  const isHandoffRequest = handoffScore >= 2;
  const sentiment = negativeScore >= 3 ? "negative" : negativeScore >= 1 ? "neutral" : "positive";
  const confidence = Math.min((complaintScore + handoffScore + negativeScore) / 10, 1);

  return { isComplaint, isHandoffRequest, sentiment, confidence: parseFloat(confidence.toFixed(2)) };
}

module.exports = { detectComplaint };
