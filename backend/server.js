require("dotenv").config();
const express     = require("express");
const cors        = require("cors");
const helmet      = require("helmet");
const compression = require("compression");
const morgan      = require("morgan");
const mongoose    = require("mongoose");
const { createClient } = require("./utils/redis");

const app = express();

// ── CORS — robust multi-origin support ───────────────────────────────────────
// Normalise a URL: strip trailing slash, lowercase
const normalise = (u) => (u || "").replace(/\/+$/, "").toLowerCase().trim();

const ALLOWED_ORIGINS = [
  process.env.FRONTEND_URL,
  process.env.FRONTEND_URL_2,
  "http://localhost:5173",
  "http://localhost:4173",
].filter(Boolean).map(normalise);

const corsOptions = {
  origin: (origin, cb) => {
    // No origin = same-origin request, curl, Render health ping → always allow
    if (!origin) return cb(null, true);
    const norm = normalise(origin);
    if (ALLOWED_ORIGINS.some(o => norm === o || norm.startsWith(o + "/"))) {
      return cb(null, true);
    }
    // In development mode allow everything — prevents local headaches
    if (process.env.NODE_ENV !== "production") return cb(null, true);
    console.warn(`[CORS] Blocked origin: ${origin} | Allowed: ${ALLOWED_ORIGINS.join(", ")}`);
    cb(new Error(`CORS: origin not allowed — ${origin}`));
  },
  credentials: true,
  methods: ["GET","POST","PUT","PATCH","DELETE","OPTIONS"],
  allowedHeaders: ["Content-Type","Authorization"],
  exposedHeaders: ["Content-Length"],
};

// OPTIONS pre-flight must come BEFORE app.use(cors()) and all routes
app.options("*", cors(corsOptions));
app.use(cors(corsOptions));

// ── Security & Performance ───────────────────────────────────────────────────
app.use(helmet({ crossOriginEmbedderPolicy: false }));
app.use(compression());
app.use(express.json({ limit: "1mb" }));
app.use(express.urlencoded({ extended: true, limit: "1mb" }));

// Logging — skip in production for speed
if (process.env.NODE_ENV !== "production") app.use(morgan("dev"));

// ── MongoDB ──────────────────────────────────────────────────────────────────
mongoose.connect(process.env.MONGO_URI, {
  maxPoolSize: 10,
  serverSelectionTimeoutMS: 10000,
  socketTimeoutMS: 45000,
}).then(() => console.log("✅  MongoDB connected"))
  .catch(err => { console.error("❌  MongoDB:", err.message); process.exit(1); });

// ── Redis (optional — graceful fallback) ─────────────────────────────────────
createClient();

// ── Routes ───────────────────────────────────────────────────────────────────
app.use("/api/auth",      require("./routes/auth"));
app.use("/api/quiz",      require("./routes/quiz"));
app.use("/api/admin",     require("./routes/admin"));
app.use("/api/questions", require("./routes/questions"));

// ── Health check (Render pings this to keep service alive) ────────────────────
app.get("/api/health", (_req, res) => res.json({ status:"ok", ts:Date.now(), env:process.env.NODE_ENV }));

// ── Debug endpoint — shows config WITHOUT secrets (safe to call publicly) ─────
app.get("/api/debug", (_req, res) => {
  res.json({
    nodeEnv:       process.env.NODE_ENV || "not set",
    port:          process.env.PORT || "not set",
    mongoSet:      !!process.env.MONGO_URI,
    jwtSet:        !!process.env.JWT_SECRET,
    adminJwtSet:   !!process.env.ADMIN_JWT_SECRET,
    adminUserSet:  !!process.env.ADMIN_USERNAME,
    frontendUrl:   process.env.FRONTEND_URL || "not set",
    frontendUrl2:  process.env.FRONTEND_URL_2 || "not set",
    redisSet:      !!process.env.REDIS_URL,
    allowedOrigins: ALLOWED_ORIGINS,
  });
});

// ── Global error handler ─────────────────────────────────────────────────────
app.use((err, _req, res, _next) => {
  console.error(err.message);
  res.status(err.status || 500).json({ success:false, message:err.message || "Server error" });
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, "0.0.0.0", () =>
  console.log(`🚀  Server on port ${PORT} [${process.env.NODE_ENV || "development"}] PID:${process.pid}`)
);
