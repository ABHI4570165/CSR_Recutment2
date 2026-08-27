import axios from "axios";

/*
 * API client for the multi-workspace recruitment architecture.
 *
 * Mirrors utils/api.js (same base-URL resolution, same friendly-error policy)
 * and adds ONE thing: the X-Workspace-Id header. The backend validates that
 * header against the admin's token on every request — the frontend selecting a
 * workspace is a convenience, never the security boundary.
 */

const BACKENDS = (import.meta.env.VITE_API_URLS || import.meta.env.VITE_API_URL || "")
  .split(",").map((s) => s.trim().replace(/\/+$/, "")).filter(Boolean).map((u) => `${u}/api`);

const IDX_KEY = "mh_api_idx";
function currentBase() {
  if (!BACKENDS.length) return "/api";
  let i;
  try { i = parseInt(sessionStorage.getItem(IDX_KEY), 10); } catch { /* ignore */ }
  if (isNaN(i) || i < 0 || i >= BACKENDS.length) i = 0;
  return BACKENDS[i];
}

// ── Active workspace (persisted so a refresh keeps the admin where they were) ─
const WS_KEY = "mh_workspace";
export const getActiveWorkspace = () => { try { return localStorage.getItem(WS_KEY) || ""; } catch { return ""; } };
export const setActiveWorkspace = (id) => { try { id ? localStorage.setItem(WS_KEY, id) : localStorage.removeItem(WS_KEY); } catch { /* ignore */ } };

const ws = axios.create({ timeout: 30000, headers: { "Content-Type": "application/json" } });

ws.interceptors.request.use((cfg) => {
  if (!cfg.baseURL) cfg.baseURL = currentBase();
  const token = localStorage.getItem("adminToken");
  if (token) cfg.headers.Authorization = `Bearer ${token}`;
  // Endpoints that legitimately span workspaces opt out with { noWorkspace: true }.
  if (!cfg.noWorkspace) {
    const id = getActiveWorkspace();
    if (id) cfg.headers["X-Workspace-Id"] = id;
  }
  return cfg;
});

// Same error policy as utils/api.js: technical detail to the console only,
// a clean human message on the thrown Error.
const FRIENDLY = {
  offline: "Unable to connect. Please check your internet connection and try again.",
  timeout: "Your connection looks slow or unstable. Please try again.",
  server:  "The service is temporarily unavailable. Please try again in a few moments.",
  generic: "Something went wrong. Please try again.",
};

let reauthing = false;
ws.interceptors.response.use((r) => r, (err) => {
  if (import.meta.env.DEV) console.error("[wsapi]", err?.config?.url, err?.code, err?.response?.status);

  // A dead admin session bounces to the login screen, same as utils/api.js.
  if (err?.response?.status === 401 && !reauthing) {
    reauthing = true;
    localStorage.removeItem("adminToken");
    localStorage.removeItem("adminRole");
    window.location.reload();
  }
  if (!err.response) {
    const e = new Error(err.code === "ECONNABORTED" ? FRIENDLY.timeout : FRIENDLY.offline);
    e.isNetworkError = true; e.status = 0; throw e;
  }
  const status = err.response.status;
  const data = err.response.data || {};
  const e = new Error(status >= 500 ? FRIENDLY.server
    : (typeof data.message === "string" && data.message) ? data.message : FRIENDLY.generic);
  e.status = status;
  Object.assign(e, data);
  e.message = status >= 500 ? FRIENDLY.server : (data.message || FRIENDLY.generic);
  throw e;
});

const unwrap = (p) => p.then((r) => r.data?.data);
const full = (p) => p.then((r) => r.data);

// The admin's display name, read from the admin JWT (no extra request, and the
// token is already in this browser). Falls back to a neutral greeting.
export function getAdminName() {
  try {
    const t = localStorage.getItem("adminToken");
    if (!t) return "";
    const payload = JSON.parse(atob(t.split(".")[1].replace(/-/g, "+").replace(/_/g, "/")));
    const raw = String(payload.username || "").trim();
    if (!raw) return "";
    return raw.charAt(0).toUpperCase() + raw.slice(1);
  } catch { return ""; }
}

/* ── Workspaces ───────────────────────────────────────────────────────────── */
export const listWorkspaces   = ()    => unwrap(ws.get("/workspaces", { noWorkspace: true }));
// LEVEL 1 — global totals across every workspace. Sends no workspace header.
export const fetchGlobalOverview = () => unwrap(ws.get("/workspaces/overview", { noWorkspace: true }));
export const createWorkspace  = (d)   => unwrap(ws.post("/workspaces", d, { noWorkspace: true }));
export const updateWorkspace  = (d)   => unwrap(ws.put("/workspaces/current", d));
export const fetchWsDashboard = (p)   => unwrap(ws.get("/workspaces/current/dashboard", { params: p }));

/* ── Dynamic registration fields ──────────────────────────────────────────── */
export const listFields  = (p)     => unwrap(ws.get("/workspaces/current/registration-fields", { params: p }));
export const createField = (d)     => unwrap(ws.post("/workspaces/current/registration-fields", d));
export const updateField = (id, d) => unwrap(ws.put(`/workspaces/current/registration-fields/${id}`, d));
export const deleteField = (id)    => full(ws.delete(`/workspaces/current/registration-fields/${id}`));

/* ── Drives ───────────────────────────────────────────────────────────────── */
export const listDrives   = (p)     => unwrap(ws.get("/drives", { params: p }));
export const createDrive  = (d)     => unwrap(ws.post("/drives", d));
export const fetchDrive   = (id)    => unwrap(ws.get(`/drives/${id}`));
export const updateDrive  = (id, d) => unwrap(ws.put(`/drives/${id}`, d));
export const deleteDrive  = (id)    => full(ws.delete(`/drives/${id}`));

/* ── Rounds (dynamic — any number, any names) ─────────────────────────────── */
export const listRounds   = (driveId)          => unwrap(ws.get(`/drives/${driveId}/rounds`));
export const createRound  = (driveId, d)       => unwrap(ws.post(`/drives/${driveId}/rounds`, d));
export const updateRound  = (driveId, rid, d)  => unwrap(ws.put(`/drives/${driveId}/rounds/${rid}`, d));
export const deleteRound  = (driveId, rid)     => full(ws.delete(`/drives/${driveId}/rounds/${rid}`));
export const reorderRounds= (driveId, order)   => unwrap(ws.patch(`/drives/${driveId}/rounds/reorder`, { order }));

/* ── Rounds of the workspace's recruitment process ────────────────────────
 * The admin works with Workspace → Rounds. The internal container the engine
 * needs is resolved server-side and never named here. */
export const listWorkspaceRounds  = ()      => unwrap(ws.get("/rounds"));
export const createWorkspaceRound = (d)     => unwrap(ws.post("/rounds", d));
export const updateWorkspaceRound = (id, d) => unwrap(ws.put(`/rounds/${id}`, d));
export const deleteWorkspaceRound = (id)    => full(ws.delete(`/rounds/${id}`));

/* ── Round operations ─────────────────────────────────────────────────────── */
export const roundDashboard   = (rid)    => unwrap(ws.get(`/rounds/${rid}/dashboard`));
export const roundCandidates  = (rid, p) => full(ws.get(`/rounds/${rid}/candidates`, { params: p }));
export const assignToRound    = (rid, d) => unwrap(ws.post(`/rounds/${rid}/assign`, d));
export const previewCutoff    = (rid, d) => unwrap(ws.post(`/rounds/${rid}/cutoff/preview`, d));
export const applyCutoff      = (rid, d) => unwrap(ws.post(`/rounds/${rid}/cutoff/apply`, d));
export const advanceRound     = (rid)    => unwrap(ws.post(`/rounds/${rid}/advance`, {}));
export const recordResults    = (rid, d) => unwrap(ws.post(`/rounds/${rid}/results`, d));
export const overrideResult   = (pid, d) => unwrap(ws.patch(`/participations/${pid}/override`, d));

/* ── Candidates (applications — one row per person) ───────────────────────── */
export const listApplications = (p)   => full(ws.get("/applications", { params: p }));
export const fetchApplication = (id)  => unwrap(ws.get(`/applications/${id}`));
export const addCandidates    = (driveId, candidates) => unwrap(ws.post(`/drives/${driveId}/candidates`, { candidates }));
export const finalSelection   = (driveId) => unwrap(ws.get(`/drives/${driveId}/final-selection`));

/* ── AI Reports (workspace-scoped) ────────────────────────────────────────── */
export const ollamaStatus     = ()   => unwrap(ws.get("/reports/status"));
export const listReports      = ()   => unwrap(ws.get("/reports"));
export const listReportColleges = () => unwrap(ws.get("/reports/colleges"));
export const fetchReport      = (p)  => unwrap(ws.get("/reports/one", { params: p }));
export const generateCompanyReport = () => unwrap(ws.post("/reports/company", {}, { timeout: 960000 }));
export const generateCollegeReport = (college) => unwrap(ws.post("/reports/college", { college }, { timeout: 960000 }));

/* ── Public (no auth, no workspace header) ────────────────────────────────── */
export const publicSelection = (wsSlug, driveSlug) =>
  unwrap(ws.get(`/public/selection/${wsSlug}/${driveSlug}`, { noWorkspace: true, headers: {} }));

// Workspace drive self-registration. The workspace comes from the URL slug, so
// nothing workspace-related is ever sent from the browser.
export const getRegistrationForm = (wsSlug, driveSlug) =>
  unwrap(ws.get(`/public/register/${wsSlug}/${driveSlug}`, { noWorkspace: true, headers: {} }));
export const submitRegistration = (wsSlug, driveSlug, answers) =>
  unwrap(ws.post(`/public/register/${wsSlug}/${driveSlug}`, answers, { noWorkspace: true, headers: {} }));

export default ws;
