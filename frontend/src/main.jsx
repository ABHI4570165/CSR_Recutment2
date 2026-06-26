import React, { Suspense, lazy } from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import "./styles/global.css";

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
          {/* Root = Admin login/dashboard (students never land on registration) */}
          <Route path="/"        element={<AdminDashboard />} />
          <Route path="/admin"   element={<AdminDashboard />} />

          {/* Public candidate flows */}
          <Route path="/test"               element={<WalkInPortal />} />     {/* walk-in test-code portal */}
          <Route path="/assessment/:token"  element={<AssessmentPage />} />    {/* invitation links (kept) */}
          <Route path="/candidate/:token"   element={<AssessmentPage />} />    {/* alias for pre-registered */}

          {/* Legacy public-registration quiz (kept, off the root route) */}
          <Route path="/register" element={<RegisterPage />} />
          <Route path="/ready"    element={<QuizReadyPage />} />
          <Route path="/quiz"     element={<QuizPage />} />

          {/* Friendly 404 for unknown links (candidates never land on the admin page) */}
          <Route path="*" element={<ErrorPage code="404" />} />
        </Routes>
      </Suspense>
    </BrowserRouter>
  </React.StrictMode>
);
