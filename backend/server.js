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

const ALLOWED_ORIGINS = [
  process.env.FRONTEND_URL,    // e.g. https://mha-quiz.vercel.app
  process.env.FRONTEND_URL_2,  // e.g. https://yourdomain.com  (optional second domain)
  "http://localhost:5173",
  "http://localhost:4173",
].filter(Boolean).map(normalise);

const ALLOWED_BARE = ALLOWED_ORIGINS.map(bare);
console.log("[CORS] Allowed origins:", ALLOWED_ORIGINS);

const corsOptions = {
  origin: (origin, cb) => {
    // Allow no-origin requests (curl, Render health pings, same-origin)
    if (!origin) return cb(null, true);

    // Always allow in development
    if (process.env.NODE_ENV !== "production") return cb(null, true);

    const norm = bare(origin); // compare ignoring www. on both sides
    const allowed = ALLOWED_BARE.some(
      (o) => norm === o || norm.startsWith(o + "/")
    );

    if (allowed) return cb(null, true);

    console.warn(`[CORS] BLOCKED: "${origin}" not in allowed list: ${ALLOWED_ORIGINS.join(", ")}`);
    return cb(new Error(`CORS: origin not allowed — ${origin}`));
  },
  credentials:    true,
  methods:        ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization", "X-Requested-With"],
  exposedHeaders: ["Content-Length"],
};

// Pre-flight OPTIONS must be registered BEFORE app.use(cors()) and all routes
app.options("*", cors(corsOptions));
app.use(cors(corsOptions));

// ── STEP 2: Body parsers — must come AFTER cors, BEFORE routes ───────────────
// Without express.json() the req.body will always be undefined/empty.
app.use(express.json({ limit: "2mb" }));
app.use(express.urlencoded({ extended: true, limit: "2mb" }));

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
const PORT = process.env.PORT || 8080;
app.listen(PORT, "0.0.0.0", () =>
  console.log(
    `🚀  Server on port ${PORT} [${process.env.NODE_ENV || "development"}] PID:${process.pid}`
  )
);