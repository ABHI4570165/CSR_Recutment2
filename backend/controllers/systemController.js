const SystemConfig = require("../models/SystemConfig");

const EXTEND_MS = 2 * 60 * 60 * 1000; // 2 hours

// Default auto-off = today 22:00 server time; if already past, now + 2h.
function computeAutoOff() {
  const d = new Date();
  const tonight = new Date(d); tonight.setHours(22, 0, 0, 0);
  return d.getTime() >= tonight.getTime() ? new Date(d.getTime() + EXTEND_MS) : tonight;
}

function pushLog(doc, action, by) {
  doc.log.unshift({ action, by: by || "system", at: new Date() });
  if (doc.log.length > 50) doc.log = doc.log.slice(0, 50);
}

function publicState(doc) {
  return {
    activeMode: doc.activeMode,
    activatedAt: doc.activatedAt,
    autoOffAt: doc.autoOffAt,
    lastHeartbeat: doc.lastHeartbeat,
    serverTime: new Date(),
    uptimeSec: Math.round(process.uptime()),
    memoryMB: Math.round(process.memoryUsage().rss / 1048576),
    recentLog: doc.log.slice(0, 10),
  };
}

// GET /api/system/status
exports.getStatus = async (_req, res) => {
  try {
    const doc = await SystemConfig.getSingleton();
    res.json({ success: true, data: publicState(doc) });
  } catch (err) {
    console.error("getStatus:", err);
    res.status(500).json({ success: false, message: "Server error." });
  }
};

// POST /api/system/active-mode  { on, extend? }
exports.setActiveMode = async (req, res) => {
  try {
    const { on, extend } = req.body || {};
    const by = req.admin?.username || "admin";
    const doc = await SystemConfig.getSingleton();

    if (extend) {
      const base = doc.autoOffAt && new Date(doc.autoOffAt) > new Date() ? new Date(doc.autoOffAt) : new Date();
      doc.activeMode = true;
      doc.autoOffAt = new Date(base.getTime() + EXTEND_MS);
      pushLog(doc, "extended", by);
    } else if (on) {
      doc.activeMode = true;
      doc.activatedAt = new Date();
      doc.autoOffAt = computeAutoOff();
      pushLog(doc, "enabled", by);
    } else {
      doc.activeMode = false;
      doc.autoOffAt = undefined;
      pushLog(doc, "disabled", by);
    }
    doc.updatedBy = by;
    await doc.save();
    res.json({ success: true, data: publicState(doc) });
  } catch (err) {
    console.error("setActiveMode:", err);
    res.status(500).json({ success: false, message: "Server error." });
  }
};

// POST /api/system/heartbeat — the keep-alive ping (external request keeps Render awake)
exports.heartbeat = async (_req, res) => {
  try {
    const doc = await SystemConfig.getSingleton();
    doc.lastHeartbeat = new Date();
    await doc.save();
    res.json({ success: true, activeMode: doc.activeMode, ts: doc.lastHeartbeat,
      memoryMB: Math.round(process.memoryUsage().rss / 1048576) });
  } catch (err) {
    res.json({ success: true }); // never fail a heartbeat
  }
};

// Server-side safety net: auto-disable Active Mode once autoOffAt passes,
// even if the admin tab is closed. Started from server.js after Mongo connects.
let timer = null;
function startAutoOffScheduler() {
  if (timer) return;
  timer = setInterval(async () => {
    try {
      const doc = await SystemConfig.getSingleton();
      if (doc.activeMode && doc.autoOffAt && new Date() > new Date(doc.autoOffAt)) {
        doc.activeMode = false; doc.autoOffAt = undefined;
        pushLog(doc, "auto-disabled", "system");
        await doc.save();
        console.log("[system] Assessment Active Mode auto-disabled (scheduled auto-off).");
      }
    } catch { /* ignore */ }
  }, 60 * 1000);
  timer.unref?.();
}

exports.startAutoOffScheduler = startAutoOffScheduler;

// ── Server-side keep-alive (the real fix) ──────────────────────────────────────
// While Active Mode is ON, each running instance pings EVERY backend URL every
// 10 min (an outbound→inbound request is what stops Render from sleeping — no
// browser tab needed). Because every instance cross-pings all 5, any one awake
// instance keeps the WHOLE fleet awake (and wakes a sleeping sibling).
//   KEEPALIVE_URLS = comma-separated list of all 5 backend URLs (recommended)
//   else falls back to SELF_PING_URL / RENDER_EXTERNAL_URL (self only)
let keepAliveTimer = null;
const KEEPALIVE_MS = parseInt(process.env.KEEPALIVE_MS) || 10 * 60 * 1000; // 10 min < Render's 15-min sleep
function keepAliveTargets() {
  const list = (process.env.KEEPALIVE_URLS || process.env.SELF_PING_URL || process.env.RENDER_EXTERNAL_URL || "")
    .split(",").map((s) => s.trim().replace(/\/+$/, "")).filter(Boolean);
  return [...new Set(list)];
}
function startKeepAlive() {
  if (keepAliveTimer) return;
  const targets = keepAliveTargets();
  if (!targets.length) {
    console.warn("⏰  Keep-alive idle — set KEEPALIVE_URLS (all 5 backend URLs) or RENDER_EXTERNAL_URL.");
    return;
  }
  if (typeof fetch !== "function") { console.warn("⏰  Keep-alive needs Node 18+ (global fetch)."); return; }
  console.log(`⏰  Keep-alive armed → ${targets.length} backend(s) every ${KEEPALIVE_MS / 60000} min while Active Mode is ON`);
  const pingAll = async () => {
    const doc = await SystemConfig.getSingleton();
    if (!doc.activeMode) return;                       // only ping while Active Mode is on
    await Promise.all(targets.map(async (url) => {
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), 12000);
      try { const r = await fetch(`${url}/api/health`, { signal: ctrl.signal }); console.log(`⏰  keep-alive ${url} → ${r.status}`); }
      catch (e) { console.warn(`⏰  keep-alive ${url} failed: ${e.message}`); }
      finally { clearTimeout(t); }
    }));
  };
  keepAliveTimer = setInterval(() => { pingAll().catch(() => {}); }, KEEPALIVE_MS);
  keepAliveTimer.unref?.();
}
exports.startKeepAlive = startKeepAlive;
