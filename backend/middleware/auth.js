const jwt = require("jsonwebtoken");

// Verify student JWT (from quiz link)
function authStudent(req, res, next) {
  const auth = req.headers.authorization;
  if (!auth?.startsWith("Bearer ")) {
    return res.status(401).json({ success: false, message: "No token provided" });
  }
  try {
    const decoded = jwt.verify(auth.slice(7), process.env.JWT_SECRET);
    req.user = decoded;
    next();
  } catch {
    return res.status(401).json({ success: false, message: "Invalid or expired session. Please re-register." });
  }
}

// Verify admin JWT
function authAdmin(req, res, next) {
  const auth = req.headers.authorization;
  if (!auth?.startsWith("Bearer ")) {
    return res.status(401).json({ success: false, message: "Admin auth required" });
  }
  try {
    const decoded = jwt.verify(auth.slice(7), process.env.ADMIN_JWT_SECRET);
    req.admin = decoded;
    next();
  } catch {
    return res.status(401).json({ success: false, message: "Invalid admin session" });
  }
}

// Require FULL admin (reject read-only viewer tokens) — for any mutating endpoint.
function requireFullAdmin(req, res, next) {
  if (req.admin?.role === "viewer") {
    return res.status(403).json({ success: false, message: "Read-only access — this action is not permitted." });
  }
  next();
}

module.exports = { authStudent, authAdmin, requireFullAdmin };
