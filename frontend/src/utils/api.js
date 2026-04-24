import axios from "axios";

// ── Resolve base URL ──────────────────────────────────────────────────────────
// Dev:  vite.config.js proxies /api to localhost:5000 (VITE_API_URL not needed)
// Prod: VITE_API_URL must be set to your Render backend URL before npm run build
//       Example:  VITE_API_URL=https://mha-quiz-api.onrender.com
const rawApiUrl = import.meta.env.VITE_API_URL || "";
// Strip trailing slash so we never produce double-slash like https://xxx.com//api
const BASE = rawApiUrl
  ? rawApiUrl.replace(/\/+$/, "") + "/api"
  : "/api";

// ── Axios instances ───────────────────────────────────────────────────────────
const api = axios.create({ baseURL: BASE, timeout: 30000 });
api.interceptors.request.use((cfg) => {
  const token = localStorage.getItem("quizToken");
  if (token) cfg.headers.Authorization = `Bearer ${token}`;
  return cfg;
});

const adminApi = axios.create({ baseURL: BASE, timeout: 30000 });
adminApi.interceptors.request.use((cfg) => {
  const token = sessionStorage.getItem("adminToken");
  if (token) cfg.headers.Authorization = `Bearer ${token}`;
  return cfg;
});

// ── Error normaliser ──────────────────────────────────────────────────────────
const handleErr = (err) => {
  if (!err.response) {
    const isTimeout = err.code === "ECONNABORTED";
    const msg = isTimeout
      ? "Request timed out — please check your connection."
      : `Cannot reach server. Verify VITE_API_URL="${BASE}" is correct. (${err.message})`;
    const e = new Error(msg);
    e.isNetworkError = true;
    throw e;
  }
  const msg = err.response?.data?.message || err.message || "Server error";
  const e   = new Error(msg);
  e.status  = err.response.status;
  Object.assign(e, err.response.data || {});
  throw e;
};
api.interceptors.response.use(r => r, handleErr);
adminApi.interceptors.response.use(r => r, handleErr);

// ── Student APIs ──────────────────────────────────────────────────────────────
export const register      = (d) => api.post("/auth/register", d);
export const verifyToken   = ()  => api.get("/auth/verify");
export const getQuizConfig = ()  => api.get("/quiz/config");
export const startQuiz     = ()  => api.post("/quiz/start");
export const autoSave      = (d) => api.post("/quiz/auto-save", d);
export const submitQuiz    = (d) => api.post("/quiz/submit", d);

// ── Admin APIs ────────────────────────────────────────────────────────────────
export const adminLogin      = (d)    => axios.post(`${BASE}/auth/admin/login`, d);
export const clearAdminToken = ()     => sessionStorage.removeItem("adminToken");
export const fetchStats      = ()     => adminApi.get("/admin/stats");
export const fetchUsers      = (p)    => adminApi.get("/admin/users", { params: p });
export const fetchUserDetail = (id)   => adminApi.get(`/admin/users/${id}`);
export const deleteUser      = (id)   => adminApi.delete(`/admin/users/${id}`);
export const fetchAttempts   = (p)    => adminApi.get("/admin/attempts", { params: p });
export const fetchSettings   = ()     => adminApi.get("/admin/settings");
export const updateSettings  = (d)    => adminApi.put("/admin/settings", d);
export const fetchSections   = ()     => adminApi.get("/admin/sections");
export const addSection      = (d)    => adminApi.post("/admin/sections", d);
export const deleteSection   = (name) => adminApi.delete(`/admin/sections/${name}`);
export const fetchCutoff     = (p)    => adminApi.get("/admin/cutoff", { params: p });

// ── Question APIs ─────────────────────────────────────────────────────────────
export const fetchQuestions = (p)    => adminApi.get("/questions", { params: p });
export const addQuestion    = (d)    => adminApi.post("/questions", d);
export const updateQuestion = (id,d) => adminApi.put(`/questions/${id}`, d);
export const deleteQuestion = (id)   => adminApi.delete(`/questions/${id}`);
