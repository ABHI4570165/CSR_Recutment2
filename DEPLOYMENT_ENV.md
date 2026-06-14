# Deployment Environment Audit

Every variable below was found by grepping `process.env.*` (backend) and
`import.meta.env.*` (frontend) across the whole codebase. Nothing is omitted.

Legend — **Required**: 🔴 app/feature breaks without it · 🟡 has a safe default · ⚪ auto/managed.

## Backend variables (26)

| # | Variable | Req | Source / default | If missing | Example production value |
|---|----------|-----|------------------|-----------|--------------------------|
| 1 | `MONGO_URI` | 🔴 | `server.js`, `seed.js` — no default | **Process exits** (`FATAL: MONGO_URI not set`) | `mongodb+srv://user:pass@cluster0.xxx.mongodb.net/CSRQuiz?retryWrites=true&w=majority` |
| 2 | `JWT_SECRET` | 🔴 | `authController`, `auth.js` middleware | Student registration → 500; legacy quiz auth fails | 64-char random hex |
| 3 | `ADMIN_JWT_SECRET` | 🔴 | `authController`, `auth.js` | Admin login → 500 → **cannot manage drives** | 64-char random hex (different from JWT_SECRET) |
| 4 | `ADMIN_USERNAME` | 🔴 | `authController` | No admin can log in | `mhadmin` |
| 5 | `ADMIN_PASSWORD` | 🔴 | `authController` | No admin can log in | strong 16+ char password |
| 6 | `FRONTEND_URL` | 🔴 (prod) | `server.js` CORS + `emailQueue` link build (default `http://localhost:5173`) | Prod CORS blocks the real frontend; invite links point to localhost | `https://yourdomain.com` |
| 7 | `NODE_ENV` | 🔴 (prod) | `server.js` (default `development`) | CORS allows **all** origins; verbose logging | `production` |
| 8 | `PORT` | 🟡 | `server.js` (default `5000`) | Falls back to 5000 (Render injects its own) | `10000` (Render) |
| 9 | `EMAIL_USER` | 🔴 (email) | `email.js` `emailConfigured()` | Scheduler idle → **no invitations / thank-yous sent** | SMTP login / API user |
| 10 | `EMAIL_PASS` | 🔴 (email) | `email.js` | Scheduler idle → no email sent | SMTP password / API key |
| 11 | `EMAIL_HOST` | 🟡 | `email.js` (default `smtp.gmail.com`) | Uses Gmail host | `smtp-relay.brevo.com` |
| 12 | `EMAIL_PORT` | 🟡 | `email.js` (default `587`) | Uses 587 | `587` |
| 13 | `EMAIL_SECURE` | 🟡 | `email.js` (default `false`) | STARTTLS on 587 | `false` (587) / `true` (465) |
| 14 | `EMAIL_FROM` | 🟡 | `email.js` (default `MH Academy <noreply@mhacademy.in>`) | Default sender (poor deliverability) | `MH Academy <no-reply@yourdomain.com>` |
| 15 | `EMAIL_RATE_LIMIT` | 🟡 | `email.js` (default `5`/sec) | 5 msg/sec | `14` (SES) / `5` |
| 16 | `EMAIL_MAX_CONNECTIONS` | 🟡 | `email.js` (default `5`) | 5 pooled connections | `5` |
| 17 | `EMAIL_POLL_INTERVAL_MS` | 🟡 | `emailQueue.js` (default `30000`) | Polls every 30s | `30000` |
| 18 | `EMAIL_BATCH_SIZE` | 🟡 | `emailQueue.js` (default `25`) | 25 sends/tick | `25` |
| 19 | `EMAIL_MAX_ATTEMPTS` | 🟡 | `emailQueue.js` (default `3`) | 3 retries then `failed` | `3` |
| 20 | `FRONTEND_URL_2` | 🟡 | `server.js` CORS | No second origin allowed | `https://yourapp.vercel.app` |
| 21 | `MONGO_POOL_SIZE` | 🟡 | `server.js` (default `20`) | Pool of 20 | `20` |
| 22 | `MONGO_MIN_POOL` | 🟡 | `server.js` (default `2`) | Min 2 | `2` |
| 23 | `REDIS_URL` | 🟡 | `redis.js` (default `redis://localhost:6379`) | Runs **without cache** (graceful) | `redis://:pass@host:6379` (optional) |
| 24 | `JWT_EXPIRES_IN` | 🟡 | `authController` (default `7d`) | Tokens last 7d | `7d` |
| 25 | `RATE_LIMIT_WINDOW_MS` | 🟡 | `rateLimit.js` (default `900000`) | 15-min window | `900000` |
| 26 | `RATE_LIMIT_MAX` | 🟡 | `rateLimit.js` (default `100`) | 100 req/window | `100` |

## Frontend variables (1)

| Variable | Req | Source / default | If missing | Example |
|----------|-----|------------------|-----------|---------|
| `VITE_API_URL` | 🔴 (prod) | `api.js` (default `""` → `/api` relative) | Cross-origin deploys (Hostinger/Vercel→Render) hit same-origin `/api` → **all API calls 404** | `https://csr-recutment2.onrender.com` |
| `import.meta.env.DEV` | ⚪ | Vite built-in | n/a (auto) | n/a |

> `VITE_*` vars are **build-time**: they are baked into the bundle at `npm run build`. Changing them requires a rebuild/redeploy.

---

## Backend `.env.production` (complete)

```env
# ── Core ────────────────────────────────────────────────
NODE_ENV=production
PORT=10000

# ── Database (use a dedicated M10+ cluster for 500 students) ──
MONGO_URI=mongodb+srv://USER:PASS@cluster0.xxxxx.mongodb.net/CSRQuiz?retryWrites=true&w=majority
MONGO_POOL_SIZE=20
MONGO_MIN_POOL=2

# ── Auth secrets (rotate — do NOT reuse the dev values) ──
JWT_SECRET=<64-char random hex>
JWT_EXPIRES_IN=7d
ADMIN_JWT_SECRET=<different 64-char random hex>
ADMIN_USERNAME=mhadmin
ADMIN_PASSWORD=<strong 16+ char password>

# ── Frontend origin (CORS + invitation links) ──────────
FRONTEND_URL=https://yourdomain.com
FRONTEND_URL_2=https://yourapp.vercel.app

# ── Email (Brevo/SES/Gmail-Workspace) ──────────────────
EMAIL_HOST=smtp-relay.brevo.com
EMAIL_PORT=587
EMAIL_SECURE=false
EMAIL_USER=<smtp user>
EMAIL_PASS=<smtp key>
EMAIL_FROM=MH Academy <no-reply@yourdomain.com>
EMAIL_RATE_LIMIT=5
EMAIL_MAX_CONNECTIONS=5
EMAIL_POLL_INTERVAL_MS=30000
EMAIL_BATCH_SIZE=25
EMAIL_MAX_ATTEMPTS=3

# ── Optional cache ──────────────────────────────────────
REDIS_URL=redis://:PASS@HOST:6379

# ── Rate limiting ───────────────────────────────────────
RATE_LIMIT_WINDOW_MS=900000
RATE_LIMIT_MAX=100
```

Generate secrets: `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`

## Frontend `.env.production` (complete)

```env
VITE_API_URL=https://csr-recutment2.onrender.com
```

---

## Render environment variables (backend service)

Set in **Dashboard → Service → Environment** (or via `render.yaml`). `render.yaml`
already declares these; `sync: false` ones must be filled in the dashboard.

| Key | Value | Notes |
|-----|-------|-------|
| `NODE_ENV` | `production` | from render.yaml |
| `PORT` | `10000` | from render.yaml |
| `MONGO_URI` | *(secret)* | dashboard |
| `MONGO_POOL_SIZE` | `20` | render.yaml |
| `JWT_SECRET` | *(generate)* | render.yaml `generateValue` |
| `ADMIN_JWT_SECRET` | *(generate)* | render.yaml `generateValue` |
| `ADMIN_USERNAME` | `mhadmin` | change from `admin` |
| `ADMIN_PASSWORD` | *(secret)* | dashboard |
| `FRONTEND_URL` | `https://yourdomain.com` | dashboard |
| `FRONTEND_URL_2` | `https://yourapp.vercel.app` | dashboard, optional |
| `EMAIL_HOST` | `smtp-relay.brevo.com` | dashboard |
| `EMAIL_PORT` | `587` | render.yaml |
| `EMAIL_SECURE` | `false` | render.yaml |
| `EMAIL_USER` | *(secret)* | dashboard |
| `EMAIL_PASS` | *(secret)* | dashboard |
| `EMAIL_FROM` | `MH Academy <no-reply@yourdomain.com>` | dashboard |
| `EMAIL_BATCH_SIZE` | `25` | render.yaml |
| `EMAIL_MAX_ATTEMPTS` | `3` | render.yaml |
| `REDIS_URL` | *(secret)* | optional |
| `JWT_EXPIRES_IN` | `7d` | optional |
| `RATE_LIMIT_WINDOW_MS` | `900000` | optional |
| `RATE_LIMIT_MAX` | `100` | optional |
| `EMAIL_RATE_LIMIT` / `EMAIL_MAX_CONNECTIONS` / `EMAIL_POLL_INTERVAL_MS` / `MONGO_MIN_POOL` | defaults | add only to override |

Build: `npm install` · Start: `node server.js` · Health: `/api/health` ·
**Upgrade off the free plan** (free spins down → ~50s cold start; underpowered for 500 concurrent).

## Vercel environment variables (frontend project)

Only build-time vars. **Project → Settings → Environment Variables** (scope: Production):

| Key | Value |
|-----|-------|
| `VITE_API_URL` | `https://csr-recutment2.onrender.com` |

- Framework preset: **Vite**. Build: `npm run build`. Output: `dist`.
- SPA routing handled by `frontend/vercel.json` (rewrites all paths → `/index.html`) so `/assessment/:token` works on refresh.
- After deploying, add the Vercel URL to backend `FRONTEND_URL` or `FRONTEND_URL_2` (CORS).

## Hostinger deployment checklist (frontend)

1. **Build locally** with the production API URL:
   - Ensure `frontend/.env.production` → `VITE_API_URL=https://<render-backend>`.
   - `cd frontend && npm install && npm run build`.
2. **Upload** the **contents of `frontend/dist/`** to `public_html/` (not the folder itself).
3. **Upload `hostinger-files/.htaccess`** to `public_html/.htaccess` (SPA fallback + cache + security headers — already correct).
4. **Enable SSL** (Hostinger → SSL → free Let's Encrypt). **Required** — the candidate camera (`getUserMedia`) only works over HTTPS.
5. **Force HTTPS** (Hostinger redirect or add to `.htaccess`).
6. In backend (Render), set `FRONTEND_URL=https://yourdomain.com` so CORS allows it and invitation links point to it.
7. **Verify**: open `https://yourdomain.com/assessment/test` → should load the SPA (not a 404 page) and show "Assessment link not found" from the API (confirms frontend + API + CORS all wired).
8. Confirm static assets cache (1y) and `index.html` is `no-cache` (handled by `.htaccess`).
9. (DNS for email) Add **SPF + DKIM** records for your sending domain so invitations don't land in spam.

---

### Critical pre-launch gates
- 🔴 `MONGO_URI`, `JWT_SECRET`, `ADMIN_JWT_SECRET`, `ADMIN_USERNAME`, `ADMIN_PASSWORD` set on Render.
- 🔴 `FRONTEND_URL` + `NODE_ENV=production` on Render.
- 🔴 `EMAIL_USER` + `EMAIL_PASS` (+ provider that allows ~1,000 emails/day) on Render.
- 🔴 `VITE_API_URL` correct in the frontend **build** (Hostinger) or Vercel env.
- 🔴 SSL enabled on the frontend domain (camera requirement).
