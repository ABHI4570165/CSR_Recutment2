const rateLimit = require("express-rate-limit");

// TEST_MODE: skip per-IP limits during load testing (a single load generator shares
// one IP, which real candidates do not). Reverted by unsetting TEST_MODE. Test-only.
const skipInTest = (req) => process.env.TEST_MODE === "true" || req.path === "/api/health";

// General API rate limiter
const apiLimiter = rateLimit({
  windowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS) || 15 * 60 * 1000,
  max: parseInt(process.env.RATE_LIMIT_MAX) || 100,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, message: "Too many requests. Please try again later." },
  skip: (req) => req.path === "/api/health",
});

// Strict limiter for auth/registration
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, message: "Too many attempts. Please wait 15 minutes." },
});

// Submission: 3 per user per 10 min
const submitLimiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  max: 3,
  keyGenerator: (req) => req.user?.id || req.ip,
  message: { success: false, message: "Too many submission attempts." },
});

// Candidate (token-based) endpoints — generous, keyed by token so one candidate's
// retries can't lock out others sharing an IP (e.g. a campus lab / NAT).
const candidateLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 120,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => req.params?.token || req.ip,
  message: { success: false, message: "Too many requests. Please slow down." },
  skip: skipInTest,
});

// Walk-in portal — generous per-IP cap. Campus labs share a NAT IP and many
// students register over a few minutes, so this must not lock out a whole lab;
// capacity limits + per-drive duplicate-email guards are the real protections.
const walkinLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: parseInt(process.env.WALKIN_RATE_MAX) || 60,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, message: "Too many requests from this network. Please wait a moment and retry." },
  skip: skipInTest,
});

module.exports = { apiLimiter, authLimiter, submitLimiter, candidateLimiter, walkinLimiter };
