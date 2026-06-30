import React, { Suspense, lazy } from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import "./styles/global.css";

// Admin/viewer dashboards live on hard-to-guess paths (NOT /admin, which is easily
// guessed). Change these strings anytime you want new secret links.
const ADMIN_PATH  = "mh-ctrl-9x7k2q4z";   // full admin (create/edit/delete)
const VIEWER_PATH = "mh-view-3p8w5n6t";   // read-only dashboard

// Lazy-loaded routes → smaller initial bundle, faster first paint under load.
const RegisterPage   = lazy(() => import("./pages/RegisterPage"));
const QuizReadyPage  = lazy(() => import("./pages/QuizReadyPage"));
const QuizPage       = lazy(() => import("./pages/QuizPage"));
const AdminDashboard = lazy(() => import("./pages/AdminDashboard"));
const AssessmentPage = lazy(() => import("./pages/AssessmentPage"));
const WalkInPortal   = lazy(() => import("./pages/WalkInPortal"));
const ErrorPage      = lazy(() => import("./pages/ErrorPage"));

const Loading = () => (
  <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", color: "#6b7280" }}>
    Loading…
  </div>
);

ReactDOM.createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <BrowserRouter>
      <Suspense fallback={<Loading />}>
        <Routes>
          {/* Admin (full) + Viewer (read-only) — on hard-to-guess paths, password protected. */}
          <Route path={`/${ADMIN_PATH}`}  element={<AdminDashboard mode="admin" />} />
          <Route path={`/${VIEWER_PATH}`} element={<AdminDashboard mode="viewer" />} />

          {/* Public candidate flows. */}
          <Route path="/test"               element={<WalkInPortal />} />
          <Route path="/assessment/:token"  element={<AssessmentPage />} />
          <Route path="/candidate/:token"   element={<AssessmentPage />} />

          {/* Legacy public-registration quiz (kept) */}
          <Route path="/register" element={<RegisterPage />} />
          <Route path="/ready"    element={<QuizReadyPage />} />
          <Route path="/quiz"     element={<QuizPage />} />

          {/* Root → walk-in portal. Clearing the URL sends students to the portal,
              NEVER to any dashboard. */}
          <Route path="/" element={<Navigate to="/test" replace />} />

          {/* Anything else → friendly 404 (never a dashboard). */}
          <Route path="*" element={<ErrorPage code="404" />} />
        </Routes>
      </Suspense>
    </BrowserRouter>
  </React.StrictMode>
);
