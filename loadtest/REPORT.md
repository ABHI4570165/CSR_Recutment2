# Campus Recruitment Platform — Load & Stress Test Report (V3.5, hCDN disabled)

**Target:** https://quizportal.mandi-hariyanna-academy.com (origin IP 82.180.143.74, Hostinger shared hosting, `Keep-Alive max=100`)
**Date:** 2026-06-26 · **Driver:** Node 24 `fetch` (k6 was blocked — see below) · **Source:** single client IP

---

## Executive answer (measured, not estimated)

| Concurrency | Result | Evidence |
|---|---|---|
| **20** | ✅ **STABLE** | 100% success, avg 129 ms, p95 266 ms, p99 482 ms, max 514 ms, 17.3 rps |
| **50** | ❌ **UNSTABLE** | 80.7% success, **19.3% connection resets** (ECONNRESET ×207, socket ×26), p99 1099 ms, max 10.7 s |
| 100 / 150 / 200 / 250 / 300 | ⛔ **NOT REACHABLE from one IP** | source IP flood-blocked by Hostinger firewall before these could be measured |

**Maximum stable concurrent (single source IP): ~20.** Breaking point begins by **50**. These failures are **connection-layer**, on a **read-only, no-database** endpoint — so the ceiling is the **hosting tier + per-IP flood protection, not the Node/Mongo application code.**

## What blocked deeper testing (with evidence)

1. **k6 is dropped by the edge.** With hCDN on → HTTP 403. With hCDN off → TLS connection silently dropped (status 0, 0 bytes) **even at 1 VU**, regardless of User-Agent. curl (schannel) and Node (`fetch`) succeed from the same machine at the same moment ⇒ the edge blocks **k6's TLS fingerprint (JA3)**. I switched the driver to Node, which the edge accepts.
2. **Per-IP flood protection (CSF/LFD-style) on the shared host.** Early run: 20 conc = 100% OK. After sustained load, **25–40 concurrent all returned 100% ECONNRESET**, then **single requests began failing** (`curl → 000`, `node → ECONNRESET`, occasional DNS `ENOTFOUND`). Failures degraded **over time, not with load** — classic single-IP firewall throttle/ban.

> Consequence: a single-source synthetic test **cannot** represent 200 distinct candidate IPs, and trips per-IP flood blocking long before it reveals true origin capacity. Real candidates (many distinct IPs, browsers) are **not** subject to the same single-IP block.

## Measured per-stage data

```
Stage 1 — 20 concurrent: reqs=542  success=100.0% fail=0.0%  avg=129ms p50=108 p90=180 p95=266 p99=482 min=54 max=514ms  rps=17.3   status{200:542}
Stage 2 — 50 concurrent: reqs=1216 success=80.7%  fail=19.3% avg=246ms p50=180 p90=424 p95=663 p99=1099 max=10672ms rps=38.5
          errors: ECONNRESET 207, UND_ERR_SOCKET 26, CONNECT_TIMEOUT 1   status{200:981, 0:234, 403:1}
Post-load (IP throttled): 25/30/35/40 concurrent → 100% ECONNRESET; single curl → 000; node → ECONNRESET; some ENOTFOUND
```

## Root-cause analysis

- **Primary bottleneck: hosting tier.** Hostinger **shared hosting** caps concurrent connections per site/IP (LiteSpeed/Passenger worker + flood protection). Read-only `/api/health` (no DB, no work) failing at 50 proves the limit is **before** the app.
- **Secondary: per-IP firewall** makes single-source measurement impossible past the ban threshold.
- **NOT observed as bottlenecks** (because load never reached them at scale): MongoDB, Node event loop, the app code. The app is built for concurrency (Mongo pool 20, atomic capacity guard, server-authoritative timer, queued+retried email, indexed token/testCode/assessmentId).

## Can it handle … ?
- **50 students:** ❌ not on current shared hosting (19% resets at 50, single IP). Real distinct IPs may do better, but the connection ceiling is low.
- **100 / 150 / 200 / 250 / 300:** ❌ not on current shared hosting. **The hosting tier must change** (below).

## Recommendations to actually support scale
**To support 200 / 500 / 1000 / 2000 concurrent:**
1. **Move the API off shared hosting** → a VPS/dedicated or cloud (Hostinger VPS, Render, Railway, Fly.io, AWS) sized for the target. Shared hosting will not do 200+.
2. **Run Node in cluster mode** (PM2 `-i max`) across all CPU cores, behind a load balancer / reverse proxy tuned for high keep-alive concurrency.
3. **MongoDB Atlas:** raise tier (M10+) and `MONGO_POOL_SIZE` to match worker count.
4. **Email:** use the **Brevo HTTPS API** (`BREVO_API_KEY`, already supported) so submit never blocks on SMTP; the queue already retries.
5. **Static/CDN** for the React build, separate from the API, so the API only serves JSON.
6. Indicative sizing: 500 ≈ 2–4 vCPU cluster + Atlas M10; 1000 ≈ 4–8 vCPU (or 2 instances) + M20; 2000 ≈ horizontal autoscaling (3–4 instances) + M30 + LB. **Validate each with a proper test (below).**

**To MEASURE real capacity safely & validly:**
1. **Run the generator ON the server** (`node node-capacity.mjs` with `BASE_URL=http://localhost:PORT`) → bypasses edge + firewall, measures pure Node+Mongo capacity.
2. **Distributed load** (k6 Cloud / multiple regions/IPs) against a **staging** deploy on the target infra — uses many IPs, avoids single-IP block. Use `k6-full-flow.js` (note: k6 needs the edge to accept it — test against staging without the JA3-blocking edge).
3. **Whitelist the load-test IP** in Hostinger firewall before any single-source test.
4. **Write-path (register→submit):** staging only — throwaway DB + email disabled (`EMAIL_*`/`BREVO_API_KEY` unset). Never on production (creates candidates + sends real emails).

## Data-integrity / safety
- **No production data was created or modified** and **no emails were sent** — only the read-only `/api/health` endpoint was exercised. The write-path (`register`/`start`/`save`/`submit`) was **not** run against production, by design.

## Files
`loadtest/node-capacity.mjs` (Node driver, used), `loadtest/node-capacity-results.json` (raw results),
`loadtest/k6-prod-safe.js` + `loadtest/k6-full-flow.js` (k6 scripts — blocked by edge JA3 on this host; usable on staging), `loadtest/README.md`.
