require("dotenv").config();
const express     = require("express");
const cors        = require("cors");
const helmet      = require("helmet");
const compression = require("compression");
const morgan      = require("morgan");
const mongoose    = require("mongoose");
const path        = require("path");
const fs          = require("fs");
const { createClient } = require("./utils/redis");

const app = express();

// Render / Hostinger / nginx terminate TLS and forward via a reverse proxy.
// Without this, req.ip is the proxy address (breaks IP rate-limiting) and
// express-rate-limit v7 raises ERR_ERL_UNEXPECTED_X_FORWARDED_FOR.
app.set("trust proxy", 1);

// ── STEP 1: CORS — must be the VERY FIRST middleware ─────────────────────────
// express.json() CANNOT run before CORS — a blocked preflight returns no body,
// which is why req.body appears empty and "All fields are required" fires.

const normalise = (u) => (u || "").replace(/\/+$/, "").toLowerCase().trim();
// Collapse "www." so https://www.site.com and https://site.com are treated as the SAME origin.
const bare = (u) => normalise(u).replace(/^(https?:\/\/)www\./, "$1");

// Origins are configurable three ways, all additive — use whichever suits:
//   FRONTEND_URLS = https://a.com,https://b.com,https://c.com   ← preferred, unlimited
//   FRONTEND_URL  / FRONTEND_URL_2                              ← legacy, two domains max
// The plural form exists because the app is reachable on several subdomains
// (testportal / assessment / …) and the client-side load balancer retries the
// SAME request against every backend — so every backend must accept every
// front-end origin, or a failover lands on one that blocks it.
const ALLOWED_ORIGINS = [
  ...String(process.env.FRONTEND_URLS || "").split(","),
  process.env.FRONTEND_URL,    // e.g. https://mha-quiz.vercel.app
  process.env.FRONTEND_URL_2,  // e.g. https://yourdomain.com  (optional second domain)
  "http://localhost:5173",
  "http://localhost:4173",
].map((u) => normalise(u)).filter(Boolean);

const ALLOWED_BARE = ALLOWED_ORIGINS.map(bare);
console.log("[CORS] Allowed origins:", ALLOWED_ORIGINS);

// Per-request decision logging. Always on outside production; in production set
// CORS_DEBUG=true to turn it on temporarily while diagnosing a blocked domain.
// Logs the ORIGIN ONLY — never headers, tokens, cookies or request bodies.
const CORS_DEBUG = process.env.CORS_DEBUG === "true" || process.env.NODE_ENV !== "production";
const corsLog = (origin, allowed, why) => {
  if (!allowed) {
    console.warn(`[CORS] Request origin: ${origin || "(none)"} | Allowed: false (${why}) | Allow-list: ${ALLOWED_ORIGINS.join(", ")}`);
  } else if (CORS_DEBUG) {
    console.log(`[CORS] Request origin: ${origin || "(none)"} | Allowed: true (${why})`);
  }
};

const corsOptions = {
  origin: (origin, cb) => {
    // Allow no-origin requests (curl, Render health pings, same-origin)
    if (!origin) { corsLog(origin, true, "no Origin header"); return cb(null, true); }

    // Always allow localhost / 127.0.0.1 on ANY port — local dev (Vite may pick
    // 5173, 5174, 5175… if a port is taken). A browser only sends a localhost
    // origin from the same machine, so this is safe even in production.
    if (/^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/i.test(origin)) {
      corsLog(origin, true, "localhost"); return cb(null, true);
    }

    // Always allow in development
    if (process.env.NODE_ENV !== "production") { corsLog(origin, true, "non-production"); return cb(null, true); }

    const norm = bare(origin); // compare ignoring www. on both sides
    const allowed = ALLOWED_BARE.some(
      (o) => norm === o || norm.startsWith(o + "/")
    );

    if (allowed) { corsLog(origin, true, "in allow-list"); return cb(null, true); }

    // cb(null, false) omits the CORS headers so the browser still blocks the
    // request — but the response stays a clean 204/4xx instead of a 500 thrown
    // through Express, which made this look like a server crash in the logs.
    corsLog(origin, false, "not in allow-list");
    return cb(null, false);
  },
  credentials:    true,
  methods:        ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
  // X-Workspace-Id carries the active workspace on every admin request. Without
  // it here the browser's preflight rejects the request before it is ever sent
  // (server-side tests never see this — only a real browser performs preflight).
  allowedHeaders: ["Content-Type", "Authorization", "X-Requested-With", "X-Workspace-Id"],
  exposedHeaders: ["Content-Length"],
};

// Pre-flight OPTIONS must be registered BEFORE app.use(cors()) and all routes
app.options("*", cors(corsOptions));
app.use(cors(corsOptions));

// ── STEP 2: Body parsers — must come AFTER cors, BEFORE routes ───────────────
// Without express.json() the req.body will always be undefined/empty.
// 12mb: resumes (up to 5 MB) are sent as base64 in JSON (~33% larger) plus form
// fields — a 2mb limit rejected normal resumes with HTTP 413 "request entity too large".
app.use(express.json({ limit: "12mb" }));
app.use(express.urlencoded({ extended: true, limit: "12mb" }));

// ── STEP 3: Other middleware ──────────────────────────────────────────────────
// CSP disabled: Express now serves the React SPA on the SAME origin, and the
// app loads Google Fonts + vendored MediaPipe assets that helmet's default CSP
// would block. crossOriginEmbedderPolicy off so the camera/COEP isolation
// doesn't break the proctoring webcam.
app.use(helmet({ contentSecurityPolicy: false, crossOriginEmbedderPolicy: false }));
app.use(compression());
if (process.env.NODE_ENV !== "production") app.use(morgan("dev"));

// ── STEP 4: MongoDB ───────────────────────────────────────────────────────────
if (!process.env.MONGO_URI) {
  console.error("FATAL: MONGO_URI environment variable is not set");
  process.exit(1);
}
mongoose.connect(process.env.MONGO_URI, {
  maxPoolSize:               parseInt(process.env.MONGO_POOL_SIZE) || 20,
  minPoolSize:               parseInt(process.env.MONGO_MIN_POOL)  || 2,
  serverSelectionTimeoutMS:  10000,
  socketTimeoutMS:           45000,
}).then(() => {
  console.log("✅  MongoDB connected");
  // Start the invitation email scheduler once the DB is ready.
  try { require("./utils/emailQueue").startScheduler(); }
  catch (e) { console.warn("Email scheduler not started:", e.message); }
  // Start the Assessment Active Mode auto-off scheduler.
  try { require("./controllers/systemController").startAutoOffScheduler(); }
  catch (e) { console.warn("Active-mode scheduler not started:", e.message); }
  // Start the server-side keep-awake self-ping (runs only while Active Mode is ON,
  // so servers stay awake even with the admin's laptop closed, and sleep when OFF).
  try { require("./utils/keepAlive").startKeepAliveScheduler(); }
  catch (e) { console.warn("Keep-alive scheduler not started:", e.message); }
  // Start the timed-out auto-submit safety net: finalizes students whose time
  // ran out but whose browser never submitted (laptop closed / network drop).
  try { require("./controllers/assessmentController").startTimeoutAutoSubmitScheduler(); }
  catch (e) { console.warn("Auto-submit scheduler not started:", e.message); }
}).catch((err) => { console.error("❌  MongoDB:", err.message); process.exit(1); });

// ── STEP 5: Redis (optional) ──────────────────────────────────────────────────
createClient();

// ── STEP 6: Routes ────────────────────────────────────────────────────────────
app.use("/api/auth",        require("./routes/auth"));
app.use("/api/quiz",        require("./routes/quiz"));
app.use("/api/admin",       require("./routes/admin"));
app.use("/api/questions",   require("./routes/questions"));
// ── Campus recruitment platform (additive — does not touch legacy routes) ──────
app.use("/api/assessments", require("./routes/assessments")); // admin: drives + candidates
app.use("/api/candidate",   require("./routes/candidate"));   // public: token-based flow
app.use("/api/walkin",      require("./routes/walkin"));      // public: walk-in test-code registration
app.use("/api/system",      require("./routes/system"));      // admin: active-mode + heartbeat
// ── Multi-workspace recruitment architecture (additive — legacy routes above
// keep serving the existing drives untouched) ─────────────────────────────────
app.use("/api/workspaces",     require("./routes/workspaces"));    // companies + dynamic registration fields
app.use("/api/drives",         require("./routes/drives"));        // drives + dynamic rounds
app.use("/api/rounds",         require("./routes/rounds"));        // assign · cutoff · advance · results
app.use("/api/applications",   require("./routes/applications"));  // the PEOPLE view (deduplicated)
app.use("/api/participations", require("./routes/applications").participations);
app.use("/api/reports",        require("./routes/reports"));       // workspace-scoped AI reports
app.use("/api/public",         require("./routes/publicPages"));   // published final-selection page

// ── Health check ──────────────────────────────────────────────────────────────
app.get("/api/health", (_req, res) =>
  res.json({ status: "ok", ts: Date.now(), env: process.env.NODE_ENV })
);

// ── Debug (no secrets exposed) ────────────────────────────────────────────────
app.get("/api/debug", (_req, res) => {
  res.json({
    nodeEnv:        process.env.NODE_ENV    || "NOT SET",
    port:           process.env.PORT        || "NOT SET",
    mongoSet:       !!process.env.MONGO_URI,
    jwtSet:         !!process.env.JWT_SECRET,
    adminJwtSet:    !!process.env.ADMIN_JWT_SECRET,
    adminUsernameSet: !!process.env.ADMIN_USERNAME,
    frontendUrl:    process.env.FRONTEND_URL  || "NOT SET",
    frontendUrl2:   process.env.FRONTEND_URL_2 || "NOT SET",
    redisSet:       !!process.env.REDIS_URL,
    allowedOrigins: ALLOWED_ORIGINS,
  });
});

// ── STEP 7: Serve the React build (same-domain deploy) ──────────────────────────
// The frontend is built and copied to backend/client/dist. We serve those static
// files and fall back to index.html for any non-/api route (client-side routing).
// Guarded by existsSync so the server still runs API-only if the build is absent.
const CLIENT_DIST = path.join(__dirname, "client", "dist");
if (fs.existsSync(path.join(CLIENT_DIST, "index.html"))) {
  console.log("🖥️   Serving React build from", CLIENT_DIST);
  app.use(express.static(CLIENT_DIST));
  // SPA fallback — anything that isn't an /api route returns index.html.
  app.get("*", (req, res, next) => {
    if (req.path.startsWith("/api")) return next();
    res.sendFile(path.join(CLIENT_DIST, "index.html"));
  });
} else {
  console.warn("⚠️   client/dist not found — running API-only (no frontend served).");
}

// ── Global error handler ──────────────────────────────────────────────────────
// eslint-disable-next-line no-unused-vars
app.use((err, _req, res, _next) => {
  console.error("[GlobalError]", err.message);
  res.status(err.status || 500).json({
    success: false,
    message: err.message || "Internal server error",
  });
});

// ── Start ─────────────────────────────────────────────────────────────────────
// Wrap Express in an HTTP server so the live-proctoring Socket.IO signaling can
// attach to the same port. Signaling is only active on the instance the frontend
// points VITE_SIGNALING_URL at; the others simply carry no socket clients.
const http = require("http");
const httpServer = http.createServer(app);
try {
  const { attachSignaling } = require("./signaling");
  attachSignaling(httpServer, ALLOWED_ORIGINS);
} catch (e) {
  console.warn("⚠️   Live proctoring signaling not attached:", e.message);
}

const PORT = process.env.PORT || 8080;
httpServer.listen(PORT, "0.0.0.0", () =>
  console.log(
    `🚀  Server on port ${PORT} [${process.env.NODE_ENV || "development"}] PID:${process.pid}`
  )
);