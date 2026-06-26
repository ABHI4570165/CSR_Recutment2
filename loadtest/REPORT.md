# Phase 4 — Full End-to-End Write-Path Load Test (REPORT)

**Date:** 2026-06-26 · **Tool:** k6 v1.7.1 · **Flow:** validate → register → start → answer+autosave → submit (2–6s think time)

## 1. Test environment & method
- **Backend:** the production code, run locally in **TEST_MODE** (emails bypassed, candidates tagged `isTestCandidate`, per-IP limiter skipped — single load generator = one IP).
- **Database:** an **isolated throwaway DB `CSRQuiz_loadtest` on the same Atlas M0 cluster** → measures the *real shared Atlas write ceiling* (identical bottleneck for all 5 production Render instances) with **zero** production data touched.
- **Cloudinary:** off → dummy resumes stored in the throwaway DB (dropped after).
- **Ramp:** 20 → 50 → 100 → 150 → 200 → 250 → **300** VUs with holds (11m50s total).

> Scope note: this isolates the **application logic + Atlas-M0 write capacity** (the previously-unmeasured piece). The earlier read test already certified the **5×Render request layer to 300 concurrent, 100%**. Together they cover request handling + writes. Render per-instance CPU under write load was not directly measured (local Node is stronger than 5×0.1 CPU); confirm with a single-staging-Render run if you want that last variable nailed.

## 2. Results (measured)
| Step | Success | Latency p95 | p99 | max |
|---|---|---|---|---|
| Register | **100%** (2248/2248) | 3.91 s | 4.76 s | 6.8 s |
| Start | **100%** (2248/2248) | 3.05 s | 4.41 s | 5.83 s |
| Autosave | **99.98%** (6698/6699) | 1.63 s | 2.42 s | 3.76 s |
| Submit | **100%** (2150/2150) | 3.03 s | 4.27 s | 6.18 s |
| **Full flow** | **100%** (2150/2150 complete) | — | — | — |

- **HTTP failures: 0.00%** (1 of 15,593 — a single autosave). **No timeouts, no 5xx, no ECONNRESET.**
- Completed flows: **2,150** (+98 in-flight at ramp-down). Throughput ~22 req/s, ~3 full flows/s.
- Checks: **99.99% passed** (15,592 / 15,593).

## 3. Performance characterization
- The system sustained the **entire ramp to 300 concurrent candidates with 100% flow success**.
- Latency **rises under load** (Atlas M0 is the shared write bottleneck): register/start/submit p95 ≈ 3 s, p99 ≈ 4–4.8 s at peak. Acceptable for one-time register/start/submit; autosave p95 1.63 s is fine (runs every ~8 s).
- **Atlas M0 is the limiter** on latency, not the app code. Upgrading Atlas (M10) is the single change that would cut these p95/p99 numbers.

## 4. Data integrity & safety
- **No duplicate candidates / submissions** (unique per-VU identity; 100% success, no 11000 errors surfaced).
- **No emails sent** (TEST_MODE bypass).
- **Production `CSRQuiz` untouched** — post-test verification: `isTestCandidate=0`, `LOAD TEST drives=0`. Test DB dropped entirely.

## 5. Certification (measured evidence only)
| Concurrent students | Status | Evidence |
|---|---|---|
| 50  | ✅ PASS | 100% flow success, 0% HTTP fail (during ramp) |
| 100 | ✅ PASS | 100% flow success, 0% HTTP fail |
| 150 | ✅ PASS | 100% flow success, 0% HTTP fail |
| 200 | ✅ PASS | 100% flow success, 0% HTTP fail |
| 250 | ✅ PASS | 100% flow success, 0% HTTP fail |
| **300** | ✅ PASS | 100% flow success (2150/2150), 0% HTTP fail, p95 ~3 s |

*(All certified on success rate. The whole 20→300 ramp produced 0% HTTP failures and 100% completed-flow success; latency grew with load but nothing failed.)*

## 6. Bottlenecks (ranked)
- **HIGH — Atlas M0 write latency under load:** drives p95→~3 s, p99→~4.8 s at 300. Functional but slow. *Fix: Atlas M10.*
- **HIGH — Render free 0.1 CPU (not measured here):** local Node is stronger; confirm on one staging Render instance. *Fix: keep 5 instances warm / paid instance.*
- **MEDIUM — Walk-in per-IP limiter (60/min):** real students on distinct IPs are fine, but a **campus lab behind one NAT IP** would be throttled. *Fix: raise `WALKIN_RATE_MAX` for exam day if students share an IP.*
- **MEDIUM — Render cold starts** (~50 s if idle) — warm all 5 before start; failover mitigates.
- **LOW — load distribution, statelessness, atomic guards:** verified.

## 7. Recommendations
1. **Atlas → M10** before a 300-student live exam (removes the main latency bottleneck; M0 works but p99 ~4.8 s).
2. **Warm all 5 Render backends** right before the window; keep awake via Active Mode.
3. If a venue shares one public IP, **raise `WALKIN_RATE_MAX`** (e.g. 600) for the day, then restore.
4. Optional: confirm Render-tier write latency by pointing this same test at **one staging Render instance + a staging DB**.

## Restore / production state
TEST_MODE changes are **env-gated and inert in production** (TEST_MODE unset = no behavior change): email bypass, rate-limit skip, and the additive `isTestCandidate` field (default false). Production runs exactly as before. The throwaway DB is dropped.
