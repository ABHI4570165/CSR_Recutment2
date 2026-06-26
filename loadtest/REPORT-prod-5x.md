# Production Stress Test — 5×Render + Hostinger Frontend (200+ students)

**Frontend:** https://testportal1.mandi-hariyanna-academy.com (Hostinger, static)
**Backends:** 5× Render (by0j, -1, -gyrc, -7i09, csr-recutment2) · shared MongoDB Atlas
**Date:** 2026-06-26 · **Driver:** Node 24 fetch (real HTTPS, distributed round-robin across all 5)

---

## Phase 1–2 — Audit (verified)
- All 5 backends: `health=200`, `env=production`, `mongoSet=true`, **`FRONTEND_URL=https://testportal1.mandi-hariyanna-academy.com`** (CORS fixed on all 5).
- App is **stateless** (token = DB lookup, server-authoritative timer, DB-persisted progress) → safe to load-balance.
- Frontend does sticky-random backend pick + **automatic failover** (added).

## Phase 3 — Load distribution: ✅ PROVEN
At every stage, requests landed **evenly** across all 5 backends. At 300 concurrent: by0j=1347, -1=1355, -gyrc=1305, -7i09=1320, csr=1312. No single-backend hot-spotting.

## Phase 5 — Read-path load test (READ-ONLY, real, safe)
GET `/api/health` distributed across 5 backends, 30s/stage:

| Concurrent | Reqs | RPS | Success | Avg | P95 | P99 | Max | Verdict |
|---|---|---|---|---|---|---|---|---|
| 20  | 433  | 13.7 | **100%** | 417 | 790 | 1111 | 1639 | ✅ |
| 50  | 1036 | 32.8 | **100%** | 478 | 1448 | 2252 | 2682 | ✅ |
| 100 | 2209 | 69.9 | **100%** | 388 | 804 | 1261 | 1592 | ✅ |
| 150 | 3227 | 101  | **100%** | 416 | 1018 | 1578 | 5189 | ✅ |
| 200 | 4448 | 140  | **100%** | 378 | 724 | 1888 | 3149 | ✅ |
| 250 | 5582 | 176  | **100%** | 374 | 981 | 1395 | 2853 | ✅ |
| **300** | **6639** | **209** | **100%** | **386** | **768** | **1867** | 2635 | ✅ |

**Zero failures, zero 429/403/503/ECONNRESET through 300 concurrent.** (Contrast: single-box Hostinger failed at 50.)

## DB read path (Atlas M0 via Render)
`/api/walkin/validate` (indexed `findOne`, no write/email), 15 concurrent: avg **587 ms**, p95 **886 ms**, p99 941 ms, 100% answered (404), no rate-limit hits. → Atlas M0 reads are healthy but not fast (~0.6–0.9 s through free Render).

## ⚠️ What was NOT tested, and why (honest)
The **write-heavy assessment path was NOT run at scale on production**, because register→start→save→submit **creates real candidates and submit sends real Brevo emails** — running 200×7 would create thousands of junk candidates + thousands of emails + needs a real test code. That violates the stated rules (no dup candidates, no email spam, no data corruption). So these are **UNVERIFIED on production**:
- Phase 4 full journey at scale · Phase 5 write-path latency (register/save/submit)
- Phase 7/9 data integrity under concurrent writes · Phase 11 email throughput
- Phase 12 concurrent Cloudinary uploads · Phase 13 dashboard under write load · Phase 14 60-min soak
- Phase 8 security: these run **in each student's browser** (camera/fullscreen/face/devtools/clipboard…) — they don't load the server and can't be measured via HTTP load; server only stores violation counters (light, exercised by save/submit).

## Bottlenecks / risks (ranked)
- **CRITICAL — Atlas M0 (free) under concurrent writes:** UNTESTED. 200 simultaneous registrations + submits (scoring writes) on a shared free tier is the single biggest unknown. Read p95 already ~0.9 s.
- **HIGH — Render free cold starts:** an idle instance adds ~50 s to its first request; failover mitigates but warm all 5 first.
- **MEDIUM — Brevo free 300 emails/day:** 200 thank-you mails fit, but completion + termination mails could approach the cap.
- **MEDIUM — Render free 0.1 CPU:** read p95 ~700–900 ms shows limited headroom; write/scoring is heavier.
- **LOW — load distribution / CORS / statelessness:** verified working.

## GO / NO-GO

**Measured GO:** request handling + 5-way load balancing + read path → **stable to 300 concurrent, 100% success.**

**CONDITIONAL for a live 200-student assessment** — proceed only after BOTH:
1. **Validate the write path on staging** (run `k6-full-flow.js` or `node-multi` adapted to register→submit against a STAGING copy on the same Render+Atlas tier, email disabled, throwaway DB). This is the one missing measurement.
2. **Operational safeguards on exam day:**
   - **Warm all 5 backends** right before start (hit each `/api/health`).
   - Keep them awake during the window (the app's Active Mode heartbeat).
   - Watch **Atlas M0** metrics; if writes lag, upgrade to **M10** (the cheapest real fix).
   - Confirm **Brevo** quota headroom (or it's fine to let thank-you mails queue/retry).

**NO-GO** only if you cannot run the staging write-test AND cannot tolerate the Atlas-M0 write risk — in that case upgrade Atlas to M10 first.

### Bottom line
The architecture and the request/read layer are **proven to 300 concurrent**. The **write path at 200 is the only unmeasured piece** — validate it on staging (safe) and apply the exam-day safeguards, and you're clear for 200+. Don't go live on **assumption** about Atlas M0 writes; measure it on staging first.
