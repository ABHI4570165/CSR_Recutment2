// Single-stage constant-load probe (read-only health). VUs + duration from CLI.
import http from "k6/http";
import { check, sleep } from "k6";
import { Trend } from "k6/metrics";
const t = new Trend("origin_ms", true);
export default function () {
  const r = http.get(`${__ENV.BASE_URL}/api/health`, { timeout: "30s", tags: { ep: "health" } });
  t.add(r.timings.duration);
  check(r, { "200": (x) => x.status === 200 });
  sleep(0.5 + Math.random()); // 0.5–1.5s think time
}
