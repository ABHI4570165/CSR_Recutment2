import React, { Suspense, lazy } from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import "./styles/global.css";

// Obscure student entry path (in addition to /test). Hard to guess so candidates
// can't wander to the admin page. Change this string anytime you want a new secret link.
const STUDENT_SECURE_PATH = "qmxz7kvr9p";

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
          {/* Admin login/dashboard — password protected, NOT on the root path so a
              student clearing the URL can never land here. */}
          <Route path="/admin"   element={<AdminDashboard />} />

          {/* Public candidate flows — the walk-in portal is reachable at BOTH /test
              and the obscure secret path. */}
          <Route path="/test"                          element={<WalkInPortal />} />
          <Route path={`/${STUDENT_SECURE_PATH}`}      element={<WalkInPortal />} />
          <Route path="/assessment/:token"             element={<AssessmentPage />} />
          <Route path="/candidate/:token"              element={<AssessmentPage />} />

          {/* Legacy public-registration quiz (kept) */}
          <Route path="/register" element={<RegisterPage />} />
          <Route path="/ready"    element={<QuizReadyPage />} />
          <Route path="/quiz"     element={<QuizPage />} />

          {/* Root → walk-in portal. Clearing the URL sends students to the portal,
              NEVER to the admin page. */}
          <Route path="/" element={<Navigate to="/test" replace />} />

          {/* Anything else → friendly 404 (never the admin page). */}
          <Route path="*" element={<ErrorPage code="404" />} />
        </Routes>
      </Suspense>
    </BrowserRouter>
  </React.StrictMode>
);
