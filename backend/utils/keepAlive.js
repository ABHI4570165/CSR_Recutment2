// ─────────────────────────────────────────────────────────────────────────────
// SERVER-SIDE keep-awake, gated by Assessment Active Mode.
//
// Problem: the admin dashboard's browser ping stops the moment the laptop is
// closed, so Render instances sleep. UptimeRobot fixes that but runs 24/7 and
// burns the free-tier instance-hours even when no test is happening.
//
// Solution: while Active Mode is ON, EVERY instance self-pings its OWN public
// Render URL every few minutes. A request to the public URL goes out to Render's
// edge and comes back as INBOUND traffic, which resets the 15-min idle timer —
// so the instance never spins down. Because all 6 instances do this, all 6 stay
// awake together. The moment Active Mode is turned OFF, the self-ping stops and
// the instance is allowed to sleep normally (freeing hours).
//
// Zero config: RENDER_EXTERNAL_URL is set automatically by Render. Optionally set
// KEEPALIVE_URLS (comma-separated public roots) to also cross-ping siblings for
// extra redundancy. In local dev neither is set, so this stays dormant.
// ─────────────────────────────────────────────────────────────────────────────
const https = require("https");
const http  = require("http");
const SystemConfig = require("../models/SystemConfig");

const INTERVAL_MS = 5 * 60 * 1000; // 5 min — safely under Render's 15-min idle sleep.
let timer = null;

function ping(url) {
  return new Promise((resolve) => {
    try {
      const lib = url.startsWith("https") ? https : http;
      const req = lib.get(url, { timeout: 20000 }, (res) => { res.resume(); resolve(res.statusCode || 0); });
      req.on("error",   () => resolve(0));
      req.on("timeout", () => { req.destroy(); resolve(0); });
    } catch { resolve(0); }
  });
}

// The URLs this instance should ping to stay awake: always itself (via Render's
// auto-set public URL), plus any siblings listed in KEEPALIVE_URLS.
function targetUrls() {
  const urls = [];
  const self = (process.env.RENDER_EXTERNAL_URL || "").replace(/\/+$/, "");
  if (self) urls.push(self + "/api/health");
  (process.env.KEEPALIVE_URLS || "")
    .split(",").map((s) => s.trim().replace(/\/+$/, "")).filter(Boolean)
    .forEach((root) => urls.push(root + "/api/health"));
  return [...new Set(urls)];
}

function startKeepAliveScheduler() {
  if (timer) return;
  const urls = targetUrls();
  if (!urls.length) {
    console.log("[keepalive] RENDER_EXTERNAL_URL/KEEPALIVE_URLS not set — self-ping disabled (local dev).");
    return;
  }
  timer = setInterval(async () => {
    try {
      const doc = await SystemConfig.getSingleton();
      const active = doc.activeMode && (!doc.autoOffAt || new Date() < new Date(doc.autoOffAt));
      if (!active) return;                    // Active Mode OFF → let this instance sleep.
      urls.forEach((u) => { ping(u); });      // fire-and-forget; keeps this instance awake.
    } catch { /* never let keep-alive crash the process */ }
  }, INTERVAL_MS);
  timer.unref?.();
  console.log(`[keepalive] self-ping scheduler started — ${urls.length} url(s), every 5 min, ONLY while Active Mode is ON.`);
}

module.exports = { startKeepAliveScheduler };
