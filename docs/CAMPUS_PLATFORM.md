# Campus Recruitment Assessment Platform — Implementation Guide

This document covers the campus-recruitment upgrade layered on top of the existing
MH Academy quiz platform. **Everything is additive.** No existing collection,
route, controller, analytics query, cutoff logic, or admin view was removed or
renamed. The legacy public-registration quiz (`/`, `/ready`, `/quiz`) keeps
working exactly as before.

Branding: **MH ACADEMY** · Hiring Partner: **Inference Labs Private Limited**.

---

## 1. What was added

### Backend (new files)
| File | Purpose |
|------|---------|
| `models/Assessment.js` | A campus "drive" definition (name, duration, sections, deadline, randomization). |
| `models/Candidate.js` | One invited person per drive — secure token, status pipeline, resume progress, violations, email tracking. |
| `utils/tokens.js` | 256-bit non-guessable assessment tokens. |
| `utils/email.js` (extended) | MH Academy / Inference Labs **invitation** + **thank-you** HTML templates, generic sender. Legacy `sendQuizLink` kept. |
| `utils/emailQueue.js` | Scheduled delivery, retry with backoff, delivery-status tracking, atomic claim (multi-instance safe). |
| `controllers/assessmentController.js` | Admin drive/candidate management + candidate token flow. |
| `middleware/candidate.js` | Resolves URL token → Candidate (stateless). |
| `routes/assessments.js` | Admin endpoints (`/api/assessments/*`). |
| `routes/candidate.js` | Public token endpoints (`/api/candidate/*`). |

### Frontend (new / changed)
| File | Purpose |
|------|---------|
| `pages/AssessmentPage.jsx` + `.css` | Candidate flow: clean landing → mandatory fullscreen + camera + identity verify → quiz → thank-you. Handles resume, expiry, already-completed. |
| `pages/AdminDashboard.jsx` | New **Campus Drives** tab: create drives, CSV/Excel/manual upload, schedule emails, college + status filters, counters, shortlist/reject, export. |
| `main.jsx` | Added `/assessment/:token` route; all routes now **lazy-loaded** (route splitting). |
| `utils/api.js` | New admin + candidate API helpers. |
| `pages/QuizReadyPage.jsx` | Fixed a pre-existing crash (`ld` → `TNC_TEXT`). |

---

## 2. Database schema changes

Two **new** collections. Existing `users`, `quizattempts`, `quizconfigs`,
`questions` are untouched.

### `assessments`
```
name, description, durationMinutes, passingScore,
sections: [{ name, displayName, questionCount, color }],
randomizeQuestions (bool), randomizeOptions (bool),
deadline (Date), isActive (bool), timestamps
```

### `candidates`
```
assessmentId (ref), name, email, college,
token (unique), tokenExpiresAt,
status: invited | email-sent | started | in-progress | completed | shortlisted | rejected,
emailStatus: pending | scheduled | sending | sent | failed,
emailScheduledAt, emailSentAt, emailAttempts, emailError,
progress: { questionOrder[], optionOrder{}, answers{}, remainingSeconds, currentQuestion, lastSavedAt },
startedAt, completedAt,
score, totalMarks, passed, sectionScores{}, timeTakenSeconds, submissionReason,
violations: { fullscreenExits, tabSwitches, focusLoss, total },
timestamps
```

**Indexes** (for 200–500+ concurrency):
`{assessmentId, college, status}`, `{assessmentId, status}`, `{assessmentId, score:-1}`,
`{emailStatus, emailScheduledAt}` (scheduler poll), `{assessmentId, email}` unique,
`token` unique, `email`, `college`.

### Questions
Drives draw from the **shared global `Question` pool**, filtered by the section
keys chosen for the drive. So your existing question bank and the Questions admin
tab serve both the legacy quiz and new drives — nothing to migrate.

---

## 3. Migration strategy

**No migration is required.** The new collections are created lazily by Mongoose
on first write. Nothing reads or rewrites legacy data.

1. Deploy backend with the new files + `nodemailer` dependency (`npm install`).
2. Set the new env vars (section 7).
3. Deploy frontend (`npm run build`).
4. Existing data (users, attempts, config, questions) is read by the same code as
   before — verified by the checklist in section 9.

Rollback = redeploy the previous build; the new collections can be ignored or
dropped without affecting legacy data.

---

## 4. Candidate flow (sections 4–12 of the brief)

1. Candidate opens `https://<frontend>/assessment/<token>`.
2. **Landing** shows only: Name, College, Assessment, Duration + a Start button.
   No email, IDs, or technical text.
3. **Start** (user gesture) → `requestFullscreen()`.
   - Fullscreen denied/unsupported → blocked with *"Fullscreen mode is mandatory
     for this assessment."* Quiz never starts.
4. Camera requested (proctoring preview, best-effort) → **Identity Verified**
   screen (image drawn locally, **never uploaded or stored**).
5. Quiz begins. A small **floating webcam preview** runs throughout — no media is
   saved, uploaded, or written to MongoDB.
6. **Randomization**: per-candidate question order + option order, fixed for the
   attempt so resume restores the same paper.
7. **Anti-malpractice**: fullscreen exits, tab switches, focus loss tracked; modal
   warns; **4 total → auto-submit**. Counts stored on the candidate.
8. **Accidental-exit recovery**: progress (answers, current question, violations)
   autosaves every 8 s + on each violation. Reopening the link shows
   **"Assessment In Progress → Resume Assessment"**. Resume **re-enforces
   fullscreen + camera** (*"Fullscreen mode is required to continue…"* if denied).
   The timer is **server-authoritative** (counts elapsed wall-clock from
   `startedAt`), so closing the tab does not pause it.
9. **One attempt**: once submitted, status = `completed`; the link shows
   *"This assessment has already been completed."* No retake.
10. **Expiry**: after `tokenExpiresAt`, the link shows *"This assessment link has
    expired."*
11. On submit → **thank-you email** (MH Academy + Inference Labs) sent best-effort.

The candidate never sees their score (recruitment context).

---

## 5. Admin flow

**Admin → Campus Drives tab:**
- **New Drive**: name, duration, internal passing score, deadline, section picker
  (with per-section question counts) drawn from your shared question pool.
- **Upload Candidates**: CSV / Excel (parsed client-side with `xlsx`; expects
  `Name, Email, College` headers) **or** manual paste (`Name, Email, College` per
  line). Duplicates per drive are skipped and reported.
- **Email delivery**: Send Now / Schedule (date-time) / Don't send yet. Per-drive
  link expiry.
- **Dashboard**: status pipeline counters (Invited → … → Shortlisted/Rejected),
  total violations, **college-wise breakdown** (candidates / completed /
  shortlisted / avg score).
- **Filters**: college, status, search. Pagination.
- **Actions**: bulk Shortlist / Reject, copy individual link, delete, export to
  Excel.

---

## 6. Email queue (sections 2, 3, 17)

- `emailScheduledAt <= now` + `emailStatus = scheduled` rows are claimed atomically
  (`findOneAndUpdate` → `sending`) so concurrent instances never double-send.
- Retry with quadratic backoff up to `EMAIL_MAX_ATTEMPTS`; terminal failures →
  `failed` with `emailError`. Status visible in the candidates table.
- Throughput throttled (`EMAIL_BATCH_SIZE` per tick, SMTP pool `rateLimit`/sec) so
  a 500-candidate blast doesn't trip Gmail/SES limits.
- Thank-you emails are fire-and-forget and never block submission.

> For a true multi-instance deployment at very high volume, swap the poller for a
> Redis-backed queue (BullMQ). The current design is correct for a single Render
> instance and safe (no double-send) across a few instances.

---

## 7. Environment variables

Add to backend `.env` (see `.env.example`):
```
EMAIL_HOST, EMAIL_PORT, EMAIL_SECURE, EMAIL_USER, EMAIL_PASS, EMAIL_FROM
EMAIL_POLL_INTERVAL_MS=30000   EMAIL_BATCH_SIZE=25   EMAIL_MAX_ATTEMPTS=3
EMAIL_RATE_LIMIT=5             EMAIL_MAX_CONNECTIONS=5
FRONTEND_URL=https://<frontend-domain>     # builds /assessment/<token> links
FRONTEND_URL_2=<optional second origin>
MONGO_POOL_SIZE=20  MONGO_MIN_POOL=2
```
If `EMAIL_USER`/`EMAIL_PASS` are unset, invitations queue but don't send (the
scheduler logs that it's idle) — nothing breaks.

Frontend `.env.production`: `VITE_API_URL=https://<backend-domain>`.

---

## 8. Deployment

### Backend → Render
- `npm install` (now pulls `nodemailer`), start `node server.js`.
- Env: all of the above + `MONGO_URI`, `JWT_SECRET`, `ADMIN_JWT_SECRET`,
  `ADMIN_USERNAME`, `ADMIN_PASSWORD`, optional `REDIS_URL`.
- The backend is **stateless** (token + JWT auth, no server sessions) → load-balancer
  / horizontal-scale ready. The email scheduler is safe to run on each instance
  (atomic claims); for many instances prefer one worker or a Redis queue.

### Frontend → Vercel (testing) / Hostinger (production)
- Build: `npm run build` → deploy `dist/`.
- **SPA rewrite is required** so `/assessment/<token>` resolves to `index.html`:
  - Vercel: add `{ "rewrites": [{ "source": "/(.*)", "destination": "/" }] }`.
  - Hostinger (Apache): `.htaccess` with `FallbackResource /index.html`
    (an `nginx.conf` `try_files $uri /index.html` is already in the repo for nginx).
- Set `VITE_API_URL` before building.
- Add the deployed frontend origin(s) to backend `FRONTEND_URL` / `FRONTEND_URL_2`
  for CORS.

---

## 9. Load handling (200–500+, ready for 1000+)

- **Frontend**: routes lazy-loaded / code-split (verified — each page is its own
  chunk), `xlsx` isolated in its own chunk, gzip via build.
- **Backend**: indexed queries, pagination on every list endpoint, connection
  pooling (`MONGO_POOL_SIZE`), Redis caching for the legacy quiz config, autosave
  throttled to 8 s + only-on-change to minimize writes, scoring done in a single
  pass on submit.
- **Writes per candidate during a test**: 1 on start, ~1 per 8 s autosave, 1 on
  submit — modest even at 500 concurrent.

### Load test plan
1. **Tooling**: k6 or Artillery against the backend.
2. **Scenario A (cold open)**: 500 virtual users `GET /api/candidate/<token>` then
   `POST /start` within 60 s. Watch p95 latency + Mongo CPU.
3. **Scenario B (steady state)**: 500 VUs looping `POST /save` every 8 s for the
   full duration; assert error rate < 1%.
4. **Scenario C (submit storm)**: 500 VUs `POST /submit` within 30 s.
5. **Email burst**: upload 500 candidates "Send Now"; confirm the queue drains at
   `EMAIL_BATCH_SIZE`/tick without SMTP rejections.
6. Tune `MONGO_POOL_SIZE`, Render instance size, and add a second instance if p95
   start latency > ~1 s.

---

## 10. Security review (section 21)

| Control | Status |
|---|---|
| Admin JWT (`ADMIN_JWT_SECRET`, 12 h) | ✅ existing, reused for all drive admin routes |
| Secure assessment tokens | ✅ 256-bit `crypto.randomBytes`, base64url, unique, opaque |
| Token expiry validation | ✅ `tokenExpiresAt` enforced on get/start/resume |
| Rate limiting | ✅ candidate limiter (per-token), existing auth/submit limiters |
| Helmet | ✅ existing, app-wide |
| CORS | ✅ existing allow-list (add new origins via env) |
| Input validation | ✅ email/name/college validated on upload; status enum checked; ObjectId guards |
| Duplicate submission prevention | ✅ submit is idempotent; completed status blocks re-entry |
| No media stored | ✅ camera is preview-only; no upload endpoint exists; no media fields |
| Score not leaked to candidates | ✅ candidate responses never include score/correctIndex |

Recommended before production: rotate `ADMIN_PASSWORD`/secrets, enable HTTPS only,
set a real `EMAIL_FROM` domain with SPF/DKIM, and restrict CORS to known origins.

---

## 11. Verification checklist (existing features intact)

Legacy (must still work — code paths unchanged):
- [ ] Public registration `/` creates a `User` and issues a quiz JWT.
- [ ] `/ready` renders (T&C preview crash fixed) and starts the legacy quiz.
- [ ] `/quiz` runs: fullscreen, timer, randomization, 4-strike auto-submit, scoring.
- [ ] Admin **Dashboard** stats (total/started/completed/passed/avg) load.
- [ ] Admin **Students** / **Attempts** lists, search, filters, pagination, export.
- [ ] Admin **Questions** add/edit/delete + **Sections** manager.
- [ ] Admin **Cutoff** preview + Excel export.
- [ ] **Settings** (time limit, passing score, sections) save + cache refresh.
- [ ] Existing `users` / `quizattempts` records unchanged (no schema migration ran).

New (campus platform):
- [ ] Create a drive; upload candidates via CSV, Excel, and manual entry.
- [ ] Schedule / Send Now invitations; status moves to Email Sent; retry on failure.
- [ ] Invitation email shows name, assessment, duration, deadline, Start button, both brands.
- [ ] Open link → clean landing (name/college/assessment/duration only).
- [ ] Start → fullscreen mandatory (denied = blocked) → camera → Identity Verified.
- [ ] Floating webcam preview during the quiz; nothing stored in MongoDB.
- [ ] Refresh / close → reopen shows Resume; resume re-enforces fullscreen + camera; same paper, server timer continued.
- [ ] Submit once → link shows "already completed"; thank-you email sent.
- [ ] After deadline → "link expired".
- [ ] Drive dashboard: status counters, college-wise table, violations, filters, shortlist/reject, export.

> Build verified: `npm run build` (frontend) succeeds with code-split chunks;
> all backend files pass `node --check`; server boots, Mongo connects, scheduler
> starts, candidate route 404s on bad token, admin route 401s without auth.
