import axios from "axios";

// ── Resolve backend base URL ──────────────────────────────────────────────────
//
//  LOCAL DEV  → VITE_API_URL is NOT set → vite.config.js proxy forwards /api
//               to localhost:5000, so BASE = "/api"
//
//  PRODUCTION → VITE_API_URL MUST be set in .env.production (Vercel/Hostinger)
//               before running `npm run build`
//               e.g. VITE_API_URL=https://mha-quiz-api.onrender.com
//
const rawUrl = (import.meta.env.VITE_API_URL || "").replace(/\/+$/, ""); // strip trailing slash
const BASE   = rawUrl ? `${rawUrl}/api` : "/api";

// Log in dev so you can immediately see if the URL is wrong
if (import.meta.env.DEV) {
  console.log(`[api] BASE URL: ${BASE}`);
}

// ── Axios instances ───────────────────────────────────────────────────────────
const api = axios.create({
  baseURL: BASE,
  timeout: 30000,
  headers: { "Content-Type": "application/json" },  // explicit — prevents missing header bugs
});

const adminApi = axios.create({
  baseURL: BASE,
  timeout: 30000,
  headers: { "Content-Type": "application/json" },
});

// Attach student JWT to every request
api.interceptors.request.use((cfg) => {
  const token = localStorage.getItem("quizToken");
  if (token) cfg.headers.Authorization = `Bearer ${token}`;
  return cfg;
});

// Attach admin JWT to every request
adminApi.interceptors.request.use((cfg) => {
  const token = sessionStorage.getItem("adminToken");
  if (token) cfg.headers.Authorization = `Bearer ${token}`;
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

api.interceptors.response.use((r) => r, handleErr);
adminApi.interceptors.response.use((r) => r, handleErr);

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
export const adminLogin      = (d)    => axios.post(`${BASE}/auth/admin/login`, d, { headers: { "Content-Type": "application/json" } });
export const clearAdminToken = ()     => sessionStorage.removeItem("adminToken");
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

// ── Question APIs ─────────────────────────────────────────────────────────────
export const fetchQuestions = (p)    => adminApi.get("/questions",        { params: p });
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
export const downloadResumeFile   = (id)    => adminApi.get(`/assessments/candidates/${id}/resume?download=1`, { responseType: "blob" });

// ── Campus Recruitment — Candidate (public, token in URL) ──────────────────────
// No auth header — the opaque token IS the credential.
const candApi = axios.create({ baseURL: BASE, timeout: 30000, headers: { "Content-Type": "application/json" } });
candApi.interceptors.response.use((r) => r, handleErr);
export const getCandidate    = (token)    => candApi.get(`/candidate/${token}`);
export const startCandidate  = (token, d) => candApi.post(`/candidate/${token}/start`, d || {});
export const saveCandidate   = (token, d) => candApi.post(`/candidate/${token}/save`, d);
export const submitCandidate = (token, d) => candApi.post(`/candidate/${token}/submit`, d);

// ── Walk-in portal (public, test-code based) ───────────────────────────────────
export const validateTestCode = (d) => candApi.post("/walkin/validate", d);
export const registerWalkIn   = (d) => candApi.post("/walkin/register", d);
export const resumeWalkIn     = (d) => candApi.post("/walkin/resume", d);