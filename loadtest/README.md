# Load testing (k6)

## Install
k6 v1.7+ — https://k6.io/docs/get-started/installation/

## Scripts
| File | What | Safe for production? |
|---|---|---|
| `k6-prod-safe.js` | Read-only ramp (health + invalid-code validate) to 200 VUs | ✅ Yes (no writes, no email) |
| `k6-full-flow.js` | Full candidate journey (validate→register→start→save→submit) | ❌ **Staging/local only** — writes data + sends email |

## Run — safe production capacity (read-only)
```
k6 run -e BASE_URL=https://quizportal.mandi-hariyanna-academy.com loadtest/k6-prod-safe.js
```
> Note: Hostinger hCDN may return HTTP 403 to sustained single-IP automated traffic.
> If so, test the origin directly or allowlist your IP (see REPORT.md).

## Run — full flow (STAGING ONLY)
1. Start a staging backend with a throwaway Mongo DB and **email disabled**
   (unset `EMAIL_USER` / `EMAIL_PASS` / `BREVO_API_KEY`).
2. Create an ACTIVE WALK_IN drive; note its test code.
```
k6 run -e BASE_URL=http://localhost:8080 -e TEST_CODE=MH001 loadtest/k6-full-flow.js
```
3. Cleanup after: drop the staging DB (or delete candidates for that drive).

## Metrics collected
avg / p90 / p95 / p99 / max per step (register, start, save, submit), req/s,
http_req_failed, flow_completed rate. See REPORT.md for results + interpretation.
