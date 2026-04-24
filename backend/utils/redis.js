const Redis = require("ioredis");

let client   = null;
let warnOnce = false;

function createClient() {
  if (client) return client;

  client = new Redis(process.env.REDIS_URL || "redis://localhost:6379", {
    maxRetriesPerRequest: 1,
    enableReadyCheck: false,   // don't block on ready check
    lazyConnect: true,         // don't auto-connect — connect on first use
    connectTimeout: 4000,
    retryStrategy(times) {
      if (times > 3) return null; // give up after 3 retries — no spam
      return times * 800;
    },
    reconnectOnError: () => false, // don't reconnect on command errors
  });

  client.on("connect", () => {
    warnOnce = false;
    console.log("✅  Redis connected");
  });

  client.on("error", (e) => {
    if (!warnOnce) {
      console.warn("⚠️  Redis unavailable:", e.message);
      console.warn("   Running without cache — set REDIS_URL in .env to enable Redis.");
      warnOnce = true;
    }
  });

  // Initiate connection (lazy — won't block startup)
  client.connect().catch(() => {}); // errors handled by "error" event above

  return client;
}

function isReady() {
  return client && client.status === "ready";
}

async function cacheGet(key) {
  try {
    if (!isReady()) return null;
    const val = await client.get(key);
    return val ? JSON.parse(val) : null;
  } catch { return null; }
}

async function cacheSet(key, value, ttlSeconds = 3600) {
  try {
    if (!isReady()) return;
    await client.set(key, JSON.stringify(value), "EX", ttlSeconds);
  } catch { /* skip silently */ }
}

async function cacheDel(...keys) {
  try {
    if (!isReady() || !keys.length) return;
    await client.del(...keys);
  } catch { /* skip silently */ }
}

module.exports = { createClient, getClient: () => client, cacheGet, cacheSet, cacheDel };
