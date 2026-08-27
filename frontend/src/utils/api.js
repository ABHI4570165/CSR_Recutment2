import axios from "axios";

// ── Resolve backend base URL (with optional client-side load balancing) ────────
//
//  LOCAL DEV  → no env set → vite proxy forwards /api to localhost (BASE = "/api")
//
//  PRODUCTION → set ONE of these in .env.production before `npm run build`:
//    VITE_API_URL  = https://api-1.onrender.com                 (single backend)
//    VITE_API_URLS = https://a.onrender.com,https://b.onrender.com,https://c... (load-balanced)
//
//  When VITE_API_URLS lists several backends, each browser RANDOMLY picks one and
//  sticks to it for the session (stored in sessionStorage). This spreads load
//  across the backends. REQUIREMENT: every backend must share the SAME MongoDB,
//  Cloudinary, Brevo and JWT secrets — otherwise data/login break across instances.
//
// Build the backend list (each entry already includes /api). One or many.
const BACKENDS = (import.meta.env.VITE_API_URLS || import.meta.env.VITE_API_URL || "")
  .split(",").map((s) => s.trim().replace(/\/+$/, "")).filter(Boolean).map((u) => `${u}/api`);

const IDX_KEY = "mh_api_idx";
function getIdx() {
  if (BACKENDS.length <= 1) return 0;
  let i;
  try { i = parseInt(sessionStorage.getItem(IDX_KEY), 10); } catch { /* ignore */ }
  if (isNaN(i) || i < 0 || i >= BACKENDS.length) {
    i = Math.floor(Math.random() * BACKENDS.length);     // sticky random pick per session
    try { sessionStorage.setItem(IDX_KEY, String(i)); } catch { /* ignore */ }
  }
  return i;
}
function rotateIdx() {                                    // failover: move to the next backend
  if (BACKENDS.length <= 1) return 0;
  const i = (getIdx() + 1) % BACKENDS.length;
  try { sessionStorage.setItem(IDX_KEY, String(i)); } catch { /* ignore */ }
  return i;
}
function currentBase() { return BACKENDS.length ? BACKENDS[getIdx()] : "/api"; } // "/api" = dev proxy
const BASE = currentBase(); // for logging / any direct use

if (import.meta.env.DEV) console.log(`[api] backends: ${BACKENDS.length || "(dev proxy)"} · base: ${BASE}`);

// ── Axios instances (baseURL is set per-request so failover can switch backends) ─
const mkInstance = () => axios.create({ timeout: 30000, headers: { "Content-Type": "application/json" } });
const api = mkInstance();
const adminApi = mkInstance();
const candApi = mkInstance();

// Request interceptors: point at the current backend + attach the right auth token.
api.interceptors.request.use((cfg) => {
  if (!cfg.baseURL) cfg.baseURL = currentBase();
  const token = localStorage.getItem("quizToken");
  if (token) cfg.headers.Authorization = `Bearer ${token}`;
  return cfg;
});
adminApi.interceptors.request.use((cfg) => {
  if (!cfg.baseURL) cfg.baseURL = currentBase();
  const token = localStorage.getItem("adminToken");
  if (token) cfg.headers.Authorization = `Bearer ${token}`;
  // The original admin screens (Campus Drives, Rounds, All Candidates,
  // Questions, Cutoff) now open INSIDE a workspace, so they must say which
  // workspace they are looking at — otherwise the backend scopes them to
  // records that belong to no workspace and they come back empty.
  const wsId = localStorage.getItem("mh_workspace");
  if (wsId) cfg.headers["X-Workspace-Id"] = wsId;
  return cfg;
});
candApi.interceptors.request.use((cfg) => {
  if (!cfg.baseURL) cfg.baseURL = currentBase();
  return cfg;
});

// ── Error normaliser ──────────────────────────────────────────────────────────
// Candidates/admins must NEVER see API URLs, env vars, axios internals, stack
// traces or "Network Error". Technical detail goes to the browser console ONLY;
// the thrown Error carries a clean, human-friendly message for the UI.
const FRIENDLY = {
  offline:  "Unable to connect. Please check your internet connection and try again.",
  timeout:  "Your connection looks slow or unstable. Please try again.",
  server:   "The service is temporarily unavailable. Please try again in a few moments. If this continues, inform your assessment coordinator.",
  generic:  "Something went wrong. Please try again.",
};
const handleErr = (err) => {
  // Always log the real detail for developers (console + backend logs only).
  if (import.meta.env.DEV) console.error("[api]", err?.config?.url, err?.code, err?.message, err?.response?.status);

  // No response = network/CORS/server-down/timeout — never expose the URL.
  if (!err.response) {
    const isTimeout = err.code === "ECONNABORTED";
    const e = new Error(isTimeout ? FRIENDLY.timeout : FRIENDLY.offline);
    e.isNetworkError = true;
    e.status = 0;
    throw e;
  }

  const status = err.response.status;
  const data   = err.response.data || {};
  // Use the server's friendly message for expected 4xx (validation, test-code, capacity,
  // window state…) — those are written for end users. Hide raw 5xx detail.
  let message;
  if (status >= 500) message = FRIENDLY.server;
  else message = (typeof data.message === "string" && data.message) ? data.message : FRIENDLY.generic;

  const e  = new Error(message);
  e.status = status;
  // Carry programmatic fields (state, missing, distance, radius…) but NOT a raw message
  // that could contain internals — message is already sanitised above.
  Object.assign(e, data);
  e.message = message;
  throw e;
};

// Automatic failover: if the chosen backend is unreachable / times out / 5xx,
// rotate to the next backend and retry the SAME request — up to once per backend.
// This means a cold or crashed Render instance won't strand its students.
function withFailover(instance) {
  return async (err) => {
    const cfg = err.config;
    const retryable = cfg && (!err.response || err.code === "ECONNABORTED" ||
      (err.response.status >= 500 && err.response.status <= 599));
    if (retryable && BACKENDS.length > 1) {
      cfg.__lbTries = (cfg.__lbTries || 0) + 1;
      if (cfg.__lbTries < BACKENDS.length) {
        rotateIdx();
        cfg.baseURL = currentBase();
        if (import.meta.env.DEV) console.warn(`[api] failover → ${cfg.baseURL} (try ${cfg.__lbTries})`);
        return instance(cfg);
      }
    }
    return handleErr(err);
  };
}
// A 401 on any admin endpoint means the stored adminToken is expired or was issued
// by a DIFFERENT backend (each one signs with its own ADMIN_JWT_SECRET — e.g. a
// token from the live site won't verify against a local backend). Every admin
// loader swallows its errors, so without this the dashboard would render blank
// forever with only console noise. Drop the dead session and go back to login.
// The login call itself is exempt — a 401 there is just wrong credentials.
let adminReauthing = false;
const adminAuthGuard = (err) => {
  const url = err?.config?.url || "";
  if (err?.response?.status === 401 && !url.includes("/auth/admin/login") && !adminReauthing) {
    adminReauthing = true;                       // in-flight siblings 401 too — reload once
    clearAdminToken();
    window.location.reload();                    // AdminDashboard sees no token → LoginScreen
  }
  return withFailover(adminApi)(err);
};

api.interceptors.response.use((r) => r, withFailover(api));
adminApi.interceptors.response.use((r) => r, adminAuthGuard);
candApi.interceptors.response.use((r) => r, withFailover(candApi));

// ── Student APIs ──────────────────────────────────────────────────────────────
// Fields sent: { name, email, college, rollNo, phone }
// These MUST match exactly what authController.js destructures from req.body
export const register = (formData) => {
  // Explicitly build the body — never silently send undefined fields
  const body = {
    name:    (formData.name    || "").trim(),
    email:   (formData.email   || "").trim(),
    college: (formData.college || "").trim(),
    rollNo:  (formData.rollNo  || "").trim(),
    phone:   (formData.phone   || "").trim(),
  };
  return api.post("/auth/register", body);
};

export const verifyToken   = () => api.get("/auth/verify");
export const getQuizConfig = () => api.get("/quiz/config");
export const startQuiz     = () => api.post("/quiz/start");
export const autoSave      = (d) => api.post("/quiz/auto-save", d);
export const submitQuiz    = (d) => api.post("/quiz/submit", d);

// ── Admin APIs ────────────────────────────────────────────────────────────────
export const adminLogin      = (d)    => adminApi.post("/auth/admin/login", d);
export const clearAdminToken = ()     => { localStorage.removeItem("adminToken"); localStorage.removeItem("adminRole"); };
export const fetchStats      = ()     => adminApi.get("/admin/stats");
export const fetchUsers      = (p)    => adminApi.get("/admin/users",    { params: p });
export const fetchUserDetail = (id)   => adminApi.get(`/admin/users/${id}`);
export const deleteUser      = (id)   => adminApi.delete(`/admin/users/${id}`);
export const fetchAttempts   = (p)    => adminApi.get("/admin/attempts", { params: p });
export const fetchSettings   = ()     => adminApi.get("/admin/settings");
export const updateSettings  = (d)    => adminApi.put("/admin/settings", d);
export const fetchSections   = ()     => adminApi.get("/admin/sections");
export const addSection      = (d)    => adminApi.post("/admin/sections", d);
export const deleteSection   = (name) => adminApi.delete(`/admin/sections/${name}`);
export const fetchCutoff     = (p)    => adminApi.get("/admin/cutoff",   { params: p });
export const testEmail       = (to)   => adminApi.post("/admin/test-email", { to });

// ── Assessment Active Mode (Render keep-awake) ─────────────────────────────────
export const getSystemStatus = ()    => adminApi.get("/system/status");
export const setActiveMode   = (d)   => adminApi.post("/system/active-mode", d);
export const sendHeartbeat   = ()    => adminApi.post("/system/heartbeat");

// Warm EVERY backend directly (bypasses the sticky load-balancer, which would
// otherwise only ping the one instance this browser picked). This keeps all 6
// Render instances awake — INCLUDING the live-proctoring signaling server —
// while Active Mode is on. Fire-and-forget; no-cors so CORS never blocks it.
export const BACKEND_COUNT = BACKENDS.length;
export function warmAllBackends() {
  return Promise.allSettled(
    BACKENDS.map((b) =>
      fetch(`${b}/health`, { mode: "no-cors", cache: "no-store", keepalive: true }).catch(() => {})
    )
  );
}

// ── Question APIs ─────────────────────────────────────────────────────────────
export const fetchQuestions = (p)    => adminApi.get("/questions",        { params: p });
// Round-2 paper catalogue, derived from the questions in the DB. Seeding a new
// set is enough for it to appear in the drive-creation dropdown.
export const fetchQuestionCatalog = (p) => adminApi.get("/questions/catalog", { params: p });
export const addQuestion    = (d)    => adminApi.post("/questions", d);
export const updateQuestion = (id,d) => adminApi.put(`/questions/${id}`, d);
export const deleteQuestion = (id)   => adminApi.delete(`/questions/${id}`);

// ── Campus Recruitment — Admin (assessments / drives + candidates) ─────────────
export const fetchAssessments     = ()      => adminApi.get("/assessments");
export const fetchOverview        = ()      => adminApi.get("/assessments/overview");
export const createAssessment     = (d)     => adminApi.post("/assessments", d);
export const updateAssessment     = (id,d)  => adminApi.put(`/assessments/${id}`, d);
export const deleteAssessment     = (id,f)  => adminApi.delete(`/assessments/${id}${f?"?force=true":""}`);
export const uploadCandidates     = (d)     => adminApi.post("/assessments/candidates", d);
export const scheduleInvites      = (d)     => adminApi.post("/assessments/schedule", d);
export const fetchCandidates      = (p)     => adminApi.get("/assessments/candidates", { params: p });
export const fetchCandidateStats  = (p)     => adminApi.get("/assessments/candidate-stats", { params: p });
export const fetchDriveColleges   = (p)     => adminApi.get("/assessments/colleges", { params: p });
export const setCandidateStatus   = (d)     => adminApi.patch("/assessments/candidates/status", d);
export const deleteCandidate      = (id)    => adminApi.delete(`/assessments/candidates/${id}`);
export const downloadResume       = (id)    => adminApi.get(`/assessments/candidates/${id}/resume`, { responseType: "blob" });
export const fetchCandidateAnswers = (id)   => adminApi.get(`/assessments/candidates/${id}/answers`);
export const terminateCandidate    = (id, reason) => adminApi.post(`/assessments/candidates/${id}/terminate`, { reason });
export const refreshTestCode       = (id) => adminApi.post(`/assessments/${id}/refresh-code`);
export const downloadResumeFile   = (id)    => adminApi.get(`/assessments/candidates/${id}/resume?download=1`, { responseType: "blob" });
// ── Round segregation (Aptitude / Technical) ──
export const fetchRoundSummary    = ()      => adminApi.get("/assessments/rounds/summary");
export const fetchCandidateJourney = (id)   => adminApi.get(`/assessments/candidates/${id}/journey`);
export const moveToTechnical      = (candidateIds) => adminApi.post("/assessments/rounds/move-to-technical", { candidateIds });

// ── Campus Recruitment — Candidate (public, token in URL) ──────────────────────
// No auth header — the opaque token IS the credential. (candApi defined above, with failover.)
export const getCandidate    = (token)    => candApi.get(`/candidate/${token}`);
export const startCandidate  = (token, d) => candApi.post(`/candidate/${token}/start`, d || {});
export const saveCandidate   = (token, d) => candApi.post(`/candidate/${token}/save`, d);
export const submitCandidate = (token, d) => candApi.post(`/candidate/${token}/submit`, d);

// ── Walk-in portal (public, test-code based) ───────────────────────────────────
export const validateTestCode = (d) => candApi.post("/walkin/validate", d);
export const registerWalkIn   = (d) => candApi.post("/walkin/register", d);
export const resumeWalkIn     = (d) => candApi.post("/walkin/resume", d);