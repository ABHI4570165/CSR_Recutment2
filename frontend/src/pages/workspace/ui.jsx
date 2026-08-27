import React, { useEffect, useState } from "react";

/*
 * Small shared pieces for the workspace screens.
 * Everything here reuses the existing .ad-* design system so the new screens
 * look and behave exactly like the rest of the dashboard (including dark mode).
 */

export const Spinner = ({ dark }) => <span className={dark ? "ad-spin-dark" : "ad-spin"} />;

export const Loading = ({ label = "Loading…" }) => (
  <div className="ad-loading"><Spinner dark />{label}</div>
);

export const Empty = ({ icon = "📭", title, hint, action }) => (
  <div className="ad-empty">
    <div style={{ fontSize: 34, marginBottom: 10 }}>{icon}</div>
    <div style={{ fontWeight: 700, color: "var(--text-2)", marginBottom: 6 }}>{title}</div>
    {hint && <div style={{ fontSize: 13, marginBottom: action ? 16 : 0 }}>{hint}</div>}
    {action}
  </div>
);

export const ErrorNote = ({ message, onRetry }) => (
  <div className="ws-error">
    <span>⚠️ {message}</span>
    {onRetry && <button className="ad-btn ad-btn--sm ad-btn--outline" onClick={onRetry}>Retry</button>}
  </div>
);

// Toast — same visual language as the existing tabs' inline toasts.
export function useToast() {
  const [toast, setToast] = useState(null);
  const show = (t) => { setToast(t); setTimeout(() => setToast(null), 6000); };
  const el = toast && (
    <div className={`ws-toast ws-toast--${toast.type || "success"}`} onClick={() => setToast(null)} role="status">
      <div className="ws-toast-title">{toast.title}</div>
      {(toast.lines || []).map((l, i) => <div key={i} className="ws-toast-line">{l}</div>)}
    </div>
  );
  return { showToast: show, toastEl: el };
}

export function Confirm({ title, message, confirmLabel = "Confirm", busyLabel = "Working…", tone = "primary", loading, onConfirm, onCancel }) {
  return (
    <div className="ad-overlay" onClick={onCancel}>
      <div className="ad-modal ad-modal--sm" onClick={(e) => e.stopPropagation()}>
        <h3 className="ad-modal-title">{title}</h3>
        <div style={{ color: "var(--text-2)", fontSize: 14, marginBottom: 18 }}>{message}</div>
        <div style={{ display: "flex", gap: 10 }}>
          <button className="ad-btn ad-btn--outline" style={{ flex: 1 }} onClick={onCancel} disabled={loading}>Cancel</button>
          <button className={`ad-btn ad-btn--${tone}`} style={{ flex: 1 }} onClick={onConfirm} disabled={loading}>
            {loading ? <><Spinner />{busyLabel}</> : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

export function Modal({ title, sub, wide, onClose, children, footer }) {
  useEffect(() => {
    const esc = (e) => { if (e.key === "Escape") onClose?.(); };
    window.addEventListener("keydown", esc);
    return () => window.removeEventListener("keydown", esc);
  }, [onClose]);
  return (
    <div className="ad-overlay" onClick={onClose}>
      <div className={`ad-modal ${wide ? "ad-modal--wide" : ""}`} onClick={(e) => e.stopPropagation()}>
        <div className="ad-modal-head">
          <div>
            <h3 className="ad-modal-title" style={{ margin: 0 }}>{title}</h3>
            {sub && <p className="ad-modal-sub">{sub}</p>}
          </div>
          <button className="ad-modal-x" onClick={onClose} aria-label="Close">✕</button>
        </div>
        <div className="ad-modal-body">{children}</div>
        {footer && <div className="ws-modal-foot">{footer}</div>}
      </div>
    </div>
  );
}

// KPI card — same shape as the existing dashboard tiles.
export const Kpi = ({ label, value, sub, icon, color = "#4F46E5" }) => (
  <div className="ad-kpi" style={{ "--kpi": color }}>
    <div className="ad-kpi-icon">{icon}</div>
    <div className="ad-kpi-body">
      <div className="ad-kpi-label">{label}</div>
      <div className="ad-kpi-val">{value}</div>
      {sub && <div className="ad-kpi-sub">{sub}</div>}
    </div>
  </div>
);

// ── Status vocabulary → colour. Round and overall statuses are backend values;
// nothing here assumes a round NAME or NUMBER. ───────────────────────────────
const TONE = {
  QUALIFIED: "#16A34A", SELECTED: "#16A34A", FINALLY_SELECTED: "#16A34A",
  REJECTED: "#DC2626",
  COMPLETED: "#4F46E5", IN_PROGRESS: "#0EA5E9", SHORTLISTED: "#7C3AED",
  PENDING: "#D97706", REGISTERED: "#64748B",
  NOT_STARTED: "#94A3B8", NOT_ATTEMPTED: "#94A3B8",
  HISTORICAL_NOT_DETERMINED: "#9A6410",
};
export const toneOf = (s) => TONE[s] || "#64748B";
export const pretty = (s) => String(s || "—").replace(/_/g, " ").toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase());

export const StatusBadge = ({ value, title }) => {
  const c = toneOf(value);
  return <span className="ad-badge" title={title} style={{ background: c + "1F", color: c, border: `1px solid ${c}55` }}>{pretty(value)}</span>;
};

export const Field = ({ label, value }) => (
  <div className="ad-pf-field">
    <div className="ad-pf-label">{label}</div>
    <div className="ad-pf-value">{value == null || value === "" ? "—" : value}</div>
  </div>
);

export const fmtDate = (d) => d ? new Date(d).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" }) : "—";
export const fmtDateTime = (d) => d ? new Date(d).toLocaleString("en-IN", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" }) : "—";

export function Pagination({ pag, page, setPage }) {
  const pages = pag?.pages || 1;
  if (pages <= 1) return null;
  const nums = [];
  for (let i = Math.max(1, page - 2); i <= Math.min(pages, page + 2); i++) nums.push(i);
  return (
    <div className="ad-pagination">
      <div className="ad-pag-info">Page {page} of {pages} · {pag.total} total</div>
      <div className="ad-pag-btns">
        <button className="ad-pag-btn" disabled={page <= 1} onClick={() => setPage(page - 1)}>‹ Prev</button>
        {nums.map(n => (
          <button key={n} className={`ad-pag-btn ${n === page ? "ad-pag-btn--active" : ""}`} onClick={() => setPage(n)}>{n}</button>
        ))}
        <button className="ad-pag-btn" disabled={page >= pages} onClick={() => setPage(page + 1)}>Next ›</button>
      </div>
    </div>
  );
}
