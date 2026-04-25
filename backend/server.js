require("dotenv").config();
const express     = require("express");
const cors        = require("cors");
const helmet      = require("helmet");
const compression = require("compression");
const morgan      = require("morgan");
const mongoose    = require("mongoose");
const { createClient } = require("./utils/redis");

const app = express();

// ── STEP 1: CORS — must be the VERY FIRST middleware ─────────────────────────
// express.json() CANNOT run before CORS — a blocked preflight returns no body,
// which is why req.body appears empty and "All fields are required" fires.

const normalise = (u) => (u || "").replace(/\/+$/, "").toLowerCase().trim();

const ALLOWED_ORIGINS = [
  process.env.FRONTEND_URL,    // e.g. https://mha-quiz.vercel.app
  process.env.FRONTEND_URL_2,  // e.g. https://yourdomain.com  (optional second domain)
  "http://localhost:5173",
  "http://localhost:4173",
].filter(Boolean).map(normalise);

console.log("[CORS] Allowed origins:", ALLOWED_ORIGINS);

const corsOptions = {
  origin: (origin, cb) => {
    // Allow no-origin requests (curl, Render health pings, same-origin)
    if (!origin) return cb(null, true);

    // Always allow in development
    if (process.env.NODE_ENV !== "production") return cb(null, true);

    const norm = normalise(origin);
    const allowed = ALLOWED_ORIGINS.some(
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
app.use(helmet({ crossOriginEmbedderPolicy: false }));
app.use(compression());
if (process.env.NODE_ENV !== "production") app.use(morgan("dev"));

// ── STEP 4: MongoDB ───────────────────────────────────────────────────────────
if (!process.env.MONGO_URI) {
  console.error("FATAL: MONGO_URI environment variable is not set");
  process.exit(1);
}
mongoose.connect(process.env.MONGO_URI, {
  maxPoolSize:               10,
  serverSelectionTimeoutMS:  10000,
  socketTimeoutMS:           45000,
}).then(() => console.log("✅  MongoDB connected"))
  .catch((err) => { console.error("❌  MongoDB:", err.message); process.exit(1); });

// ── STEP 5: Redis (optional) ──────────────────────────────────────────────────
createClient();

// ── STEP 6: Routes ────────────────────────────────────────────────────────────
app.use("/api/auth",      require("./routes/auth"));
app.use("/api/quiz",      require("./routes/quiz"));
app.use("/api/admin",     require("./routes/admin"));
app.use("/api/questions", require("./routes/questions"));

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
const PORT = process.env.PORT || 5000;
app.listen(PORT, "0.0.0.0", () =>
  console.log(
    `🚀  Server on port ${PORT} [${process.env.NODE_ENV || "development"}] PID:${process.pid}`
  )
);