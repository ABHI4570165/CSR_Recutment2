import React, { useEffect, useRef, useState } from "react";
import { Modal, Spinner } from "./ui";
import { createWorkspace } from "../../utils/workspaceApi";

/*
 * Workspace switcher — sits in the admin top bar.
 *
 * Switching sets the active workspace id, which the API client sends as
 * X-Workspace-Id on every request. The backend validates it against the admin's
 * token, so this control is convenience only — never the security boundary.
 */

const initial = (s) => String(s || "?").trim().charAt(0).toUpperCase();

export default function WorkspaceSwitcher({ workspaces, activeId, onSwitch, onCreated, onBackToOverview, canCreate }) {
  const [open, setOpen] = useState(false);
  const [showNew, setShowNew] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    const away = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    const esc = (e) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", away);
    window.addEventListener("keydown", esc);
    return () => { document.removeEventListener("mousedown", away); window.removeEventListener("keydown", esc); };
  }, []);

  const active = workspaces.find(w => String(w._id) === String(activeId));

  return (
    <div className="ws-switch" ref={ref}>
      <button className="ws-switch-btn" onClick={() => setOpen(o => !o)}
        aria-haspopup="listbox" aria-expanded={open} title="Switch workspace">
        <span className="ws-switch-logo">
          {/* No active workspace = the global level. Never show a company here. */}
          {active
            ? (active.logo?.url
                ? <img src={active.logo.url} alt="" style={{ width: "100%", height: "100%", objectFit: "cover", borderRadius: "inherit" }} />
                : initial(active.name))
            : "◇"}
        </span>
        <span className="ws-switch-text">
          <span className="ws-switch-label">{active ? "Workspace" : "Viewing"}</span>
          <span className="ws-switch-name">{active ? active.name : "All Workspaces"}</span>
        </span>
        <span className="ws-switch-caret">▼</span>
      </button>

      {open && (
        <div className="ws-menu" role="listbox">
          {/* Way back to the global overview — only meaningful inside a workspace. */}
          {active && onBackToOverview && (
            <button className="ws-menu-item ws-menu-item--overview"
              onClick={() => { onBackToOverview(); setOpen(false); }}>
              ← All Workspaces
            </button>
          )}
          <div className="ws-menu-head">{active ? "Switch company" : "Open a company"}</div>
          {workspaces.length === 0 && (
            <div style={{ padding: "10px 12px", fontSize: 13, color: "var(--text-3)" }}>
              No workspaces yet.
            </div>
          )}
          {workspaces.map(w => (
            <button key={w._id} role="option" aria-selected={String(w._id) === String(activeId)}
              className={`ws-menu-item ${String(w._id) === String(activeId) ? "ws-menu-item--active" : ""}`}
              onClick={() => { onSwitch(w._id); setOpen(false); }}>
              <span className="ws-switch-logo" style={{ width: 22, height: 22, fontSize: 11 }}>
                {w.logo?.url
                  ? <img src={w.logo.url} alt="" style={{ width: "100%", height: "100%", objectFit: "cover", borderRadius: "inherit" }} />
                  : initial(w.name)}
              </span>
              <span style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{w.name}</span>
              <span className="ws-menu-meta">{w.driveCount || 0} drives</span>
            </button>
          ))}
          {canCreate && (
            <button className="ws-menu-item ws-menu-item--new" onClick={() => { setShowNew(true); setOpen(false); }}>
              ＋ Create Workspace
            </button>
          )}
        </div>
      )}

      {showNew && (
        <NewWorkspaceModal
          onClose={() => setShowNew(false)}
          onCreated={(w) => { setShowNew(false); onCreated(w); }}
        />
      )}
    </div>
  );
}

// Shared with the global overview so there is exactly ONE workspace-creation
// screen in the application.
export function NewWorkspaceModal({ onClose, onCreated }) {
  const [form, setForm] = useState({ name: "", companyName: "", website: "", location: "", logoUrl: "" });
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState("");

  const set = (k) => (e) => setForm(f => ({ ...f, [k]: e.target.value }));

  const submit = async (e) => {
    e.preventDefault();
    if (!form.name.trim()) { setErr("Workspace name is required."); return; }
    setSaving(true); setErr("");
    try {
      const w = await createWorkspace({
        name: form.name.trim(),
        companyName: (form.companyName || form.name).trim(),
        logo: form.logoUrl ? { url: form.logoUrl.trim() } : undefined,
        details: { website: form.website.trim(), location: form.location.trim() },
      });
      onCreated(w);
    } catch (e2) { setErr(e2.message); }
    finally { setSaving(false); }
  };

  return (
    <Modal title="Create Workspace" sub="One workspace per company. Its drives, candidates and results stay completely separate." onClose={onClose}>
      <form onSubmit={submit}>
        <div className="ws-form-grid">
          <div className="ad-field">
            <label className="ad-label">Workspace Name<span className="ws-req">*</span></label>
            <input className="ad-input" value={form.name} onChange={set("name")} placeholder="e.g. Inference Labs Pvt Ltd" autoFocus />
          </div>
          <div className="ad-field">
            <label className="ad-label">Company Name</label>
            <input className="ad-input" value={form.companyName} onChange={set("companyName")} placeholder="Shown on the selection page" />
          </div>
          <div className="ad-field">
            <label className="ad-label">Company Logo URL</label>
            <input className="ad-input" value={form.logoUrl} onChange={set("logoUrl")} placeholder="https://…" />
            <div className="ws-hint">Used on the public final-selection page.</div>
          </div>
          <div className="ad-field">
            <label className="ad-label">Website</label>
            <input className="ad-input" value={form.website} onChange={set("website")} placeholder="https://company.com" />
          </div>
          <div className="ad-field">
            <label className="ad-label">Location</label>
            <input className="ad-input" value={form.location} onChange={set("location")} placeholder="Bengaluru" />
          </div>
        </div>
        {err && <div className="ws-error" style={{ marginTop: 14 }}>⚠️ {err}</div>}
        <div style={{ display: "flex", gap: 10, justifyContent: "flex-end", marginTop: 18 }}>
          <button type="button" className="ad-btn ad-btn--outline" onClick={onClose} disabled={saving}>Cancel</button>
          <button type="submit" className="ad-btn ad-btn--primary" disabled={saving}>
            {saving ? <><Spinner />Creating…</> : "Create Workspace"}
          </button>
        </div>
      </form>
    </Modal>
  );
}
