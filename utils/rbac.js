/**
 * utils/rbac.js
 * Role-based access control helpers.
 */
function makeRequireRole(role) {
  return function requireRole(req, res, next) {
    if (!req.admin) return res.status(401).json({ error: "Not authenticated" });
    if (req.admin.role !== role && req.admin.role !== "admin") {
      return res.status(403).json({ error: "Insufficient permissions" });
    }
    next();
  };
}

module.exports = { makeRequireRole };