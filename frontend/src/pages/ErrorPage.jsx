import React from "react";
import { useNavigate } from "react-router-dom";

/*
 * Professional, candidate-safe error page (404 / 500 / unavailable).
 * Shows NO technical detail — only a friendly message and a clear action.
 */
export default function ErrorPage({ code = "404", title, message }) {
  const navigate = useNavigate();
  const T = title || (code === "404" ? "Page Not Found" : "Something Went Wrong");
  const M = message || (code === "404"
    ? "The page you are looking for doesn't exist or the link may be incorrect. Please check the link from your invitation."
    : "The service is temporarily unavailable. Please try again in a few moments, or contact your assessment coordinator.");
  return (
    <div style={S.root}>
      <header style={S.top}>
        <img src="/logo.png" alt="M H Foundation" style={S.logo} onError={(e) => { e.currentTarget.style.display = "none"; }} />
        <div>
          <div style={S.brand}>M H FOUNDATION</div>
          <div style={S.partner}>In association with Inference Labs Private Limited</div>
        </div>
      </header>
      <div style={S.body}>
        <div style={S.card}>
          <div style={S.code}>{code}</div>
          <h1 style={S.title}>{T}</h1>
          <p style={S.msg}>{M}</p>
          <button style={S.btn} onClick={() => navigate("/test")}>Go to Assessment Portal</button>
        </div>
      </div>
    </div>
  );
}

const S = {
  root: { minHeight: "100vh", background: "#f3f4f6", display: "flex", flexDirection: "column", fontFamily: "Segoe UI, Arial, sans-serif" },
  top: { background: "linear-gradient(135deg,#1a56db,#1e3a8a)", color: "#fff", padding: "16px 28px", display: "flex", alignItems: "center", gap: 14 },
  logo: { width: 40, height: 40, objectFit: "contain", background: "#fff", borderRadius: 9, padding: 3 },
  brand: { fontSize: 19, fontWeight: 800, letterSpacing: 1 },
  partner: { fontSize: 12, color: "rgba(255,255,255,.85)" },
  body: { flex: 1, display: "flex", alignItems: "center", justifyContent: "center", padding: 24 },
  card: { background: "#fff", border: "1px solid #e5e7eb", borderRadius: 18, padding: "40px 34px", maxWidth: 460, width: "100%", textAlign: "center", boxShadow: "0 16px 50px rgba(15,23,42,.1)" },
  code: { fontSize: 64, fontWeight: 900, color: "#1a56db", lineHeight: 1, marginBottom: 6 },
  title: { fontSize: 22, fontWeight: 800, color: "#111827", margin: "0 0 10px" },
  msg: { fontSize: 14, color: "#6b7280", lineHeight: 1.6, margin: "0 0 22px" },
  btn: { background: "#1a56db", color: "#fff", border: "none", borderRadius: 11, padding: "13px 28px", fontSize: 15, fontWeight: 700, cursor: "pointer" },
};
