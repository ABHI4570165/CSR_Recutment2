/*
 * SAFE production load test — READ-ONLY. Creates NO data, sends NO emails.
 *   - GET  /api/health            (no DB, no rate-limit)        → server/TLS/event-loop capacity
 *   - POST /api/walkin/validate   (indexed findOne, no write)   → DB read latency
 *
 * Ramps concurrency 20 → 50 → 100 → 150 → 200, holding each level.
 * Run:  k6 run -e BASE_URL=https://quizportal.mandi-hariyanna-academy.com loadtest/k6-prod-safe.js
 */
import http from "k6/http";
import { check, sleep } from "k6";
import { Trend, Rate, Counter } from "k6/metrics";

const BASE = __ENV.BASE_URL || "https://quizportal.mandi-hariyanna-academy.com";

const healthTrend = new Trend("health_ms", true);
const validateTrend = new Trend("validate_ms", true);
const errRate = new Rate("errors");
const rateLimited = new Counter("rate_limited_429");

export const options = {
  scenarios: {
    // Concurrency capacity ramp on the unlimited health endpoint.
    capacity: {
      executor: "ramping-vus",
      exec: "capacity",
      startVUs: 0,
      stages: [
        { duration: "30s", target: 20 },  { duration: "1m", target: 20 },
        { duration: "30s", target: 50 },  { duration: "1m", target: 50 },
        { duration: "30s", target: 100 }, { duration: "1m", target: 100 },
        { duration: "30s", target: 150 }, { duration: "1m", target: 150 },
        { duration: "30s", target: 200 }, { duration: "1m30s", target: 200 },
        { duration: "20s", target: 0 },
      ],
    },
    // Low, steady DB-read sampling (kept under the 60/min per-IP walk-in limiter).
    dbread: {
      executor: "constant-arrival-rate",
      exec: "dbread",
      rate: 1, timeUnit: "1s", duration: "8m",
      preAllocatedVUs: 5, maxVUs: 10,
    },
  },
  thresholds: {
    "health_ms": ["p(95)<1500", "p(99)<3000"],
    "validate_ms": ["p(95)<2000"],
    "errors": ["rate<0.02"],
    "http_req_failed": ["rate<0.05"],
  },
};

export function capacity() {
  const r = http.get(`${BASE}/api/health`, { tags: { ep: "health" }, timeout: "30s" });
  healthTrend.add(r.timings.duration);
  const ok = check(r, { "health 200": (x) => x.status === 200 });
  errRate.add(!ok);
  sleep(Math.random() * 1 + 0.5); // 0.5–1.5s think time
}

export function dbread() {
  const r = http.post(`${BASE}/api/walkin/validate`,
    JSON.stringify({ testCode: "LOADTEST_INVALID_" + Math.random().toString(36).slice(2, 8) }),
    { headers: { "Content-Type": "application/json" }, tags: { ep: "validate" }, timeout: "30s" });
  validateTrend.add(r.timings.duration);
  if (r.status === 429) rateLimited.add(1);
  // 404 (invalid code) and 200 are both "the server answered a DB query" — only 5xx/timeout are errors.
  check(r, { "validate answered": (x) => x.status === 404 || x.status === 200 || x.status === 429 });
  errRate.add(r.status >= 500 || r.status === 0);
}
