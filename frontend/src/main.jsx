import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import RegisterPage   from "./pages/RegisterPage";
import QuizReadyPage  from "./pages/QuizReadyPage";
import QuizPage       from "./pages/QuizPage";
import AdminDashboard from "./pages/AdminDashboard";
import "./styles/global.css";

ReactDOM.createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <BrowserRouter>
      <Routes>
        <Route path="/"      element={<RegisterPage />} />
        <Route path="/ready" element={<QuizReadyPage />} />
        <Route path="/quiz"  element={<QuizPage />} />
        <Route path="/admin" element={<AdminDashboard />} />
        <Route path="*"      element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  </React.StrictMode>
);
