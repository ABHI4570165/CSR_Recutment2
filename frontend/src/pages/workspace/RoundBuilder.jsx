import React, { useState } from "react";
import { Modal, Spinner, StatusBadge } from "./ui";

/*
 * Round builder — used both when creating a drive (local list) and when
 * managing an existing drive (server-backed).
 *
 * NOTHING here assumes a round name, a round type or a round count. The admin
 * types the name; the position is the array index / sequence; the list grows
 * as far as the admin wants.
 */

export const ROUND_TYPES = [
  { value: "TEST",              label: "Test (online paper)",      engine: true },
  { value: "CODING",            label: "Coding Assessment",        engine: true },
  { value: "INTERVIEW",         label: "Interview",                engine: false },
  { value: "GROUP_DISCUSSION",  label: "Group Discussion",         engine: false },
  { value: "HR_INTERVIEW",      label: "HR Interview",             engine: false },
  { value: "MANUAL_EVALUATION", label: "Manual Evaluation",        engine: false },
  { value: "CUSTOM",            label: "Custom",                   engine: false },
];
export const usesEngine = (t) => !!ROUND_TYPES.find(r => r.value === t)?.engine;

export const CUTOFF_METHODS = [
  { value: "NONE",       label: "No automatic cutoff",     needsValue: false, hint: "Qualify candidates manually." },
  { value: "PERCENTAGE", label: "Percentage",              needsValue: true,  hint: "Qualify at or above this percentage.", unit: "%" },
  { value: "MARKS",      label: "Marks",                   needsValue: true,  hint: "Qualify at or above this score.",      unit: "marks" },
  { value: "TOP_N",      label: "Top N candidates",        needsValue: true,  hint: "Qualify the highest N scorers.",       unit: "candidates" },
  { value: "MANUAL",     label: "Manual selection",        needsValue: false, hint: "You pick the qualified candidates." },
];
export const cutoffLabel = (c) => {
  if (!c || !c.method || c.method === "NONE") return "No cutoff";
  const m = CUTOFF_METHODS.find(x => x.value === c.method);
  if (!m?.needsValue) return m?.label || c.method;
  if (c.value == null) return `${m.label} — not set`;
  return c.method === "PERCENTAGE" ? `${c.value}%` : c.method === "TOP_N" ? `Top ${c.value}` : `${c.value} marks`;
};

/* ── One round card ───────────────────────────────────────────────────────── */
export function RoundCard({ round, index, total, locked, onEdit, onDelete, onOpen, showStats }) {
  const type = ROUND_TYPES.find(t => t.value === round.roundType);
  return (
    <div className={`ws-round-card ${locked ? "ws-round-card--locked" : ""}`}>
      <div className="ws-round-top">
        <div style={{ display: "flex", gap: 12, minWidth: 0 }}>
          <div className="ws-round-seq">{round.sequence ?? index + 1}</div>
          <div style={{ minWidth: 0 }}>
            <div className="ws-round-name">{round.name}</div>
            <div className="ws-round-meta">
              <span className="ad-badge ad-badge--blue">{type?.label || round.roundType}</span>
              <span className="ad-badge ad-badge--gray">{cutoffLabel(round.cutoff)}</span>
              {round.status && <StatusBadge value={round.status} />}
              {index === total - 1 && <span className="ad-badge ad-badge--amber">Final round</span>}
              {round.requiresPreviousQualification === false && index > 0 &&
                <span className="ad-badge ad-badge--gray">Open to all</span>}
            </div>
          </div>
        </div>
        <div className="ws-round-actions">
          {onOpen && <button className="ad-btn ad-btn--sm ad-btn--primary" onClick={onOpen}>Manage</button>}
          {onEdit && <button className="ad-btn ad-btn--sm ad-btn--outline" onClick={onEdit}>Edit</button>}
          {onDelete && <button className="ad-btn ad-btn--sm ad-btn--danger" onClick={onDelete}>Delete</button>}
        </div>
      </div>

      {showStats && (
        <div className="ws-round-grid">
          <Stat label="Assigned"  value={round.participantCount ?? 0} />
          <Stat label="Qualified" value={round.qualifiedCount ?? 0} color="#16A34A" />
          {round.assessmentId && <Stat label="Test" value="Configured" color="#4F46E5" />}
        </div>
      )}

      {locked && (
        <div className="ws-locked-note">
          <span>🔒</span>
          <span>Candidates have already attempted a round in this drive, so rounds can no longer be reordered or deleted. You can still rename this round and add new rounds after it.</span>
        </div>
      )}
    </div>
  );
}

const Stat = ({ label, value, color }) => (
  <div>
    <div style={{ fontSize: 11, color: "var(--text-3)" }}>{label}</div>
    <div style={{ fontWeight: 800, fontSize: 15, color: color || "var(--text-1)" }}>{value}</div>
  </div>
);

/* ── Add / edit a round ───────────────────────────────────────────────────── */
export function RoundForm({ round, sequence, isFirst, onSave, onClose, saving }) {
  const [f, setF] = useState({
    name: round?.name || "",
    roundType: round?.roundType || "TEST",
    description: round?.description || "",
    cutoffMethod: round?.cutoff?.method || "NONE",
    cutoffValue: round?.cutoff?.value ?? "",
    requiresPreviousQualification: round ? round.requiresPreviousQualification !== false : !isFirst,
    status: round?.status || "DRAFT",
  });
  const [err, setErr] = useState("");
  const set = (k) => (e) => setF(p => ({ ...p, [k]: e.target.type === "checkbox" ? e.target.checked : e.target.value }));
  const method = CUTOFF_METHODS.find(m => m.value === f.cutoffMethod);

  const submit = (e) => {
    e.preventDefault();
    if (!f.name.trim()) { setErr("Give the round a name."); return; }
    if (method?.needsValue && (f.cutoffValue === "" || isNaN(Number(f.cutoffValue)))) {
      setErr(`Enter a cutoff value in ${method.unit}.`); return;
    }
    setErr("");
    onSave({
      name: f.name.trim(), roundType: f.roundType, description: f.description.trim(),
      cutoffMethod: f.cutoffMethod,
      cutoffValue: method?.needsValue ? Number(f.cutoffValue) : null,
      requiresPreviousQualification: isFirst ? false : f.requiresPreviousQualification,
      ...(round ? { status: f.status } : {}),
    });
  };

  return (
    <Modal title={round ? `Edit Round ${round.sequence}` : `Add Round ${sequence}`}
      sub="The round name is yours — nothing in the system depends on what you call it."
      onClose={onClose}>
      <form onSubmit={submit}>
        <div className="ws-form-grid">
          <div className="ad-field">
            <label className="ad-label">Round Name<span className="ws-req">*</span></label>
            <input className="ad-input" value={f.name} onChange={set("name")} placeholder="e.g. Aptitude, Coding, HR Interview" autoFocus />
          </div>
          <div className="ad-field">
            <label className="ad-label">Round Type</label>
            <select className="ad-input ad-select" value={f.roundType} onChange={set("roundType")}>
              {ROUND_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
            </select>
            <div className="ws-hint">
              {usesEngine(f.roundType)
                ? "Uses the existing online test engine — timer, proctoring and scoring."
                : "Scored by an evaluator; results are entered from the round screen."}
            </div>
          </div>
          <div className="ad-field">
            <label className="ad-label">Cutoff Method</label>
            <select className="ad-input ad-select" value={f.cutoffMethod} onChange={set("cutoffMethod")}>
              {CUTOFF_METHODS.map(m => <option key={m.value} value={m.value}>{m.label}</option>)}
            </select>
            <div className="ws-hint">{method?.hint}</div>
          </div>
          {method?.needsValue && (
            <div className="ad-field">
              <label className="ad-label">Cutoff Value<span className="ws-req">*</span></label>
              <input type="number" className="ad-input" value={f.cutoffValue} onChange={set("cutoffValue")}
                placeholder={method.unit === "%" ? "50" : "20"} />
              <div className="ws-hint">In {method.unit}.</div>
            </div>
          )}
          {round && (
            <div className="ad-field">
              <label className="ad-label">Round Status</label>
              <select className="ad-input ad-select" value={f.status} onChange={set("status")}>
                <option value="DRAFT">Draft — not open</option>
                <option value="ACTIVE">Active — candidates can take it</option>
                <option value="CLOSED">Closed</option>
              </select>
            </div>
          )}
        </div>

        <div className="ad-field" style={{ marginTop: 14 }}>
          <label className="ad-label">Description</label>
          <input className="ad-input" value={f.description} onChange={set("description")} placeholder="Optional note for your team" />
        </div>

        {!isFirst && (
          <label style={{ display: "flex", alignItems: "flex-start", gap: 8, fontSize: 13, marginTop: 16 }}>
            <input type="checkbox" checked={f.requiresPreviousQualification} onChange={set("requiresPreviousQualification")} style={{ marginTop: 3 }} />
            <span>
              Only candidates who qualified the previous round may take this one
              <span className="ws-hint" style={{ marginTop: 2 }}>Enforced by the backend — a candidate cannot bypass it with a direct link.</span>
            </span>
          </label>
        )}
        {isFirst && <div className="ws-hint" style={{ marginTop: 14 }}>This is the first round, so every candidate in the drive is eligible.</div>}

        {err && <div className="ws-error" style={{ marginTop: 14 }}>⚠️ {err}</div>}

        <div style={{ display: "flex", gap: 10, justifyContent: "flex-end", marginTop: 20 }}>
          <button type="button" className="ad-btn ad-btn--outline" onClick={onClose} disabled={saving}>Cancel</button>
          <button type="submit" className="ad-btn ad-btn--primary" disabled={saving}>
            {saving ? <><Spinner />Saving…</> : round ? "Save Round" : "Add Round"}
          </button>
        </div>
      </form>
    </Modal>
  );
}
