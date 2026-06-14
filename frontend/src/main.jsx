import React, { Suspense, lazy } from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import "./styles/global.css";

// Lazy-loaded routes → smaller initial bundle, faster first paint under load.
const RegisterPage   = lazy(() => import("./pages/RegisterPage"));
const QuizReadyPage  = lazy(() => import("./pages/QuizReadyPage"));
const QuizPage       = lazy(() => import("./pages/QuizPage"));
const AdminDashboard = lazy(() => import("./pages/AdminDashboard"));
const AssessmentPage = lazy(() => import("./pages/AssessmentPage"));

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
          {/* Legacy public-registration quiz flow (unchanged) */}
          <Route path="/"      element={<RegisterPage />} />
          <Route path="/ready" element={<QuizReadyPage />} />
          <Route path="/quiz"  element={<QuizPage />} />
          <Route path="/admin" element={<AdminDashboard />} />
          {/* Campus recruitment — invitation-based candidate flow */}
          <Route path="/assessment/:token" element={<AssessmentPage />} />
          <Route path="*"      element={<Navigate to="/" replace />} />
        </Routes>
      </Suspense>
    </BrowserRouter>
  </React.StrictMode>
);
