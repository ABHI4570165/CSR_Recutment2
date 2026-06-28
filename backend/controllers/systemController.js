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
