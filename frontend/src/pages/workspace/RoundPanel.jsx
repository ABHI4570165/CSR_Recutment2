import React, { useCallback, useEffect, useState } from "react";
import {
  roundDashboard, roundCandidates, assignToRound, previewCutoff, applyCutoff,
  advanceRound, recordResults, overrideResult,
} from "../../utils/workspaceApi";
import { Loading, ErrorNote, Empty, Modal, Confirm, Spinner, StatusBadge, useToast, Pagination, pretty } from "./ui";
import { cutoffLabel, CUTOFF_METHODS, usesEngine } from "./RoundBuilder";
import ManualSendDialog from "./ManualSendDialog";

/*
 * Round management: statistics, the candidate table, cutoff preview/apply and
 * advancement to whatever round comes next.
 *
 * The backend stays the authority throughout — the UI never computes who is
 * eligible, it asks. "Next round" is resolved server-side from the sequence, so
 * this screen never needs to know which round follows which.
 */

export default function RoundPanel({ round, driveId, onBack, onChanged, readOnly }) {
  const [dash, setDash] = useState(null);
  const [rows, setRows] = useState([]);
  const [pag, setPag] = useState({});
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  // Candidates picked for a manual email. Stored as whole rows, keyed by id, so
  // the list survives pagination and the dialog can show who it is mailing.
  const [picked, setPicked] = useState(() => new Map());
  const [sending, setSending] = useState(false);
  const [qFilter, setQFilter] = useState("");
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");
  const [showCutoff, setShowCutoff] = useState(false);
  const [confirmAdvance, setConfirmAdvance] = useState(false);
  const [advancing, setAdvancing] = useState(false);
  const [assigning, setAssigning] = useState(false);
  const [manual, setManual] = useState(false);
  const [overrideTarget, setOverrideTarget] = useState(null);
  const { showToast, toastEl } = useToast();

  const loadDash = useCallback(async () => {
    try { setDash(await roundDashboard(round._id)); }
    catch (e) { setErr(e.message); }
  }, [round._id]);

  const loadRows = useCallback(async () => {
    setLoading(true);
    try {
      const r = await roundCandidates(round._id, {
        page, limit: 20, search: search || undefined, qualification: qFilter || undefined,
      });
      setRows(r.data || []); setPag(r.pagination || {});
      setErr("");
    } catch (e) { setErr(e.message); }
    finally { setLoading(false); }
  }, [round._id, page, search, qFilter]);

  useEffect(() => { loadDash(); }, [loadDash]);
  useEffect(() => { loadRows(); }, [loadRows]);

  const refresh = () => { loadDash(); loadRows(); onChanged?.(); };

  const doAssign = async () => {
    setAssigning(true);
    try {
      const r = await assignToRound(round._id, { all: true });
      showToast({
        title: `${r.assigned} candidate(s) assigned`,
        lines: [
          r.alreadyAssigned ? `${r.alreadyAssigned} were already in this round.` : null,
          r.blocked ? `${r.blocked} blocked — they have not qualified the previous round.` : null,
        ].filter(Boolean),
      });
      refresh();
    } catch (e) { showToast({ type: "error", title: "Could not assign", lines: [e.message] }); }
    finally { setAssigning(false); }
  };

  const doAdvance = async () => {
    setAdvancing(true);
    try {
      const r = await advanceRound(round._id);
      showToast({
        title: `${r.advanced} candidate(s) advanced to ${r.toRound}`,
        lines: r.alreadyThere ? [`${r.alreadyThere} were already there.`] : [],
      });
      setConfirmAdvance(false); refresh();
    } catch (e) { showToast({ type: "error", title: "Could not advance", lines: [e.message] }); setConfirmAdvance(false); }
    finally { setAdvancing(false); }
  };

  const s = dash?.stats || {};
  const nextRound = dash?.nextRound;
  const isFinal = dash?.isFinalRound;

  return (
    <div>
      {toastEl}
      <div className="ws-crumb">
        <button onClick={onBack}>← Back to rounds</button>
        <span>/</span>
        <span>Round {round.sequence} — {round.name}</span>
      </div>

      <div className="ad-section-head">
        <div>
          <div className="ad-page-title" style={{ marginBottom: 6 }}>{round.name}</div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <span className="ad-badge ad-badge--blue">{String(round.roundType || "").replace(/_/g, " ")}</span>
            <span className="ad-badge ad-badge--gray">Cutoff: {cutoffLabel(round.cutoff)}</span>
            <StatusBadge value={round.status} />
            {isFinal && <span className="ad-badge ad-badge--amber">Final round</span>}
          </div>
        </div>
        {!readOnly && (
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <button className="ad-btn ad-btn--outline" onClick={doAssign} disabled={assigning}>
              {assigning ? <><Spinner />Assigning…</> : "Assign Eligible Candidates"}
            </button>
            {!usesEngine(round.roundType) && (
              <button className="ad-btn ad-btn--outline" onClick={() => setManual(true)}>Enter Results</button>
            )}
            <button className="ad-btn ad-btn--primary" onClick={() => setShowCutoff(true)}>Cutoff</button>
            {!isFinal && nextRound && (
              <button className="ad-btn ad-btn--primary" onClick={() => setConfirmAdvance(true)} disabled={!s.qualified}>
                Advance to {nextRound.name} →
              </button>
            )}
          </div>
        )}
      </div>

      {err && <ErrorNote message={err} onRetry={refresh} />}

      <div className="ws-stat-strip">
        <StatCell label="Eligible / Assigned" value={s.eligible ?? 0} />
        <StatCell label="Started"       value={s.started ?? 0}      color="#0EA5E9" />
        <StatCell label="Completed"     value={s.completed ?? 0}    color="#4F46E5" />
        <StatCell label="Qualified"     value={s.qualified ?? 0}    color="#16A34A" />
        <StatCell label="Rejected"      value={s.rejected ?? 0}     color="#DC2626" />
        <StatCell label="Pending"       value={s.pending ?? 0}      color="#D97706" />
        <StatCell label="Not Attempted" value={s.notAttempted ?? 0} color="#94A3B8" />
      </div>

      <div className="ad-toolbar">
        <input className="ad-search" placeholder="Search name, email, college…"
          value={search} onChange={e => { setSearch(e.target.value); setPage(1); }} />
        {!readOnly && picked.size > 0 && (
          <div className="ms-bar">
            <span><strong>{picked.size}</strong> candidate{picked.size === 1 ? "" : "s"} selected</span>
            <button className="ad-btn ad-btn--sm ad-btn--primary" onClick={() => setSending(true)}>✉️ Send email</button>
            <button className="ad-btn ad-btn--sm ad-btn--outline" onClick={() => setPicked(new Map())}>Clear</button>
          </div>
        )}
        <select className="ad-select" value={qFilter} onChange={e => { setQFilter(e.target.value); setPage(1); }}>
          <option value="">All qualifications</option>
          <option value="QUALIFIED">Qualified</option>
          <option value="REJECTED">Rejected</option>
          <option value="PENDING">Pending</option>
        </select>
      </div>

      <div className="ad-table-wrap">
        {loading && !rows.length ? <Loading />
          : rows.length === 0 ? (
            <Empty icon="👥" title="No candidates in this round yet"
              hint={round.sequence === 1
                ? "Add candidates to the drive, or use “Assign Eligible Candidates”."
                : "Candidates appear here once they qualify the previous round and you advance them."} />
          ) : (
            <table className="ad-table">
              <thead>
                <tr>
                  {!readOnly && (
                    <th style={{ width: 34 }}>
                      <input type="checkbox" aria-label="Select all on this page"
                        checked={rows.length > 0 && rows.every(r => picked.has(r._id))}
                        onChange={e => setPicked(m => {
                          const n = new Map(m);
                          // Only the visible page is affected, so a tick here never
                          // silently selects candidates the admin has not seen.
                          rows.forEach(r => e.target.checked ? n.set(r._id, r) : n.delete(r._id));
                          return n;
                        })} />
                    </th>
                  )}
                  <th>#</th><th>Student</th><th>Phone</th><th>College</th><th>Attended</th><th>Score</th><th>%</th><th>Result</th><th>Qualification</th><th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((c, i) => (
                  <tr key={c._id}>
                    {!readOnly && (
                      <td>
                        <input type="checkbox" aria-label={`Select ${c.name || "candidate"}`}
                          checked={picked.has(c._id)}
                          onChange={e => setPicked(m => {
                            const n = new Map(m);
                            e.target.checked ? n.set(c._id, c) : n.delete(c._id);
                            return n;
                          })} />
                      </td>
                    )}
                    <td className="ad-td-num">{(page - 1) * 20 + i + 1}</td>
                    <td>
                      <div className="ad-td-name"><div className="ad-avatar">{(c.name || "?").charAt(0)}</div>
                        <div><div style={{ fontWeight: 600 }}>{c.name}</div><div className="ad-td-sm">{c.email}</div></div>
                      </div>
                    </td>
                    <td className="ad-td-sm">{c.phone || "—"}</td>
                    <td className="ad-td-sm">{c.college || "—"}</td>
                    {/* "Attended" is derived from the existing attempt state —
                        there is no separate attendance record anywhere. */}
                    <td>{["IN_PROGRESS", "COMPLETED", "QUALIFIED", "REJECTED"].includes(c.roundStatus)
                      ? <span className="ad-badge ad-badge--green">Attended</span>
                      : <span className="ad-badge ad-badge--gray">Not attended</span>}</td>
                    <td>{c.score != null ? <strong>{c.score}/{c.totalMarks}</strong> : "—"}</td>
                    <td>{c.percentage != null ? `${c.percentage}%` : "—"}</td>
                    <td><StatusBadge value={c.roundStatus} /></td>
                    <td>
                      <StatusBadge value={c.qualification} />
                      {c.override?.at && <div className="ad-td-sm" style={{ marginTop: 3 }}>overridden</div>}
                    </td>
                    <td>
                      {!readOnly && (
                        <button className="ad-btn ad-btn--sm ad-btn--outline" onClick={() => setOverrideTarget(c)}>Override</button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
      </div>
      <Pagination pag={pag} page={page} setPage={setPage} />

      {showCutoff && (
        <CutoffModal round={round} onClose={() => setShowCutoff(false)}
          onApplied={(r) => {
            setShowCutoff(false);
            showToast({ title: `Cutoff applied — ${r.qualified} qualified, ${r.rejected} rejected`,
              lines: r.skippedOverridden ? [`${r.skippedOverridden} manual override(s) left untouched.`] : [] });
            refresh();
          }}
          onError={(m) => showToast({ type: "error", title: "Cutoff failed", lines: [m] })} />
      )}

      {confirmAdvance && (
        <Confirm title={`Advance to ${nextRound?.name}?`}
          message={<><strong>{s.qualified}</strong> candidate(s) who qualified <strong>{round.name}</strong> will become eligible for <strong>{nextRound?.name}</strong>. Candidates already there are skipped.</>}
          confirmLabel="Advance Candidates" busyLabel="Advancing…"
          loading={advancing} onConfirm={doAdvance} onCancel={() => setConfirmAdvance(false)} />
      )}

      {manual && (
        <ManualResultsModal round={round} rows={rows} onClose={() => setManual(false)}
          onSaved={(n) => { setManual(false); showToast({ title: `${n} result(s) saved` }); refresh(); }}
          onError={(m) => showToast({ type: "error", title: "Could not save results", lines: [m] })} />
      )}

      {overrideTarget && (
        <OverrideModal candidate={overrideTarget} onClose={() => setOverrideTarget(null)}
          onSaved={() => { setOverrideTarget(null); showToast({ title: "Qualification overridden" }); refresh(); }}
          onError={(m) => showToast({ type: "error", title: "Could not override", lines: [m] })} />
      )}

      {/* Manual email to the picked candidates. Only ids are sent; the backend
          re-checks every one against the workspace before mailing anybody. */}
      {sending && (
        <ManualSendDialog round={round} candidates={[...picked.values()]}
          onClose={() => setSending(false)}
          onSent={() => { setSending(false); setPicked(new Map()); }}
          toast={showToast} />
      )}
    </div>
  );
}

const StatCell = ({ label, value, color }) => (
  <div className="ws-stat">
    <div className="ws-stat-val" style={{ color: color || "var(--text-1)" }}>{value}</div>
    <div className="ws-stat-lbl">{label}</div>
  </div>
);

/* ── Cutoff preview → apply ───────────────────────────────────────────────── */
function CutoffModal({ round, onClose, onApplied, onError }) {
  const [method, setMethod] = useState(round.cutoff?.method && round.cutoff.method !== "NONE" ? round.cutoff.method : "PERCENTAGE");
  const [value, setValue] = useState(round.cutoff?.value ?? "");
  const [preview, setPreview] = useState(null);
  const [picked, setPicked] = useState(() => new Set());
  const [busy, setBusy] = useState(false);
  const [applying, setApplying] = useState(false);
  const meta = CUTOFF_METHODS.find(m => m.value === method);

  const runPreview = async () => {
    setBusy(true); setPreview(null);
    try {
      const p = await previewCutoff(round._id, {
        method, value: meta?.needsValue ? Number(value) : undefined,
        applicationIds: method === "MANUAL" ? [...picked] : undefined,
      });
      setPreview(p);
    } catch (e) { onError(e.message); }
    finally { setBusy(false); }
  };

  const apply = async () => {
    setApplying(true);
    try {
      const r = await applyCutoff(round._id, {
        method, value: meta?.needsValue ? Number(value) : undefined,
        applicationIds: method === "MANUAL" ? [...picked] : undefined,
      });
      onApplied(r);
    } catch (e) { onError(e.message); setApplying(false); }
  };

  const toggle = (id) => setPicked(s => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });

  return (
    <Modal title={`Cutoff — ${round.name}`} wide
      sub="Preview never writes anything. Nothing changes until you apply."
      onClose={onClose}>
      <div className="ws-form-grid">
        <div className="ad-field">
          <label className="ad-label">Method</label>
          <select className="ad-input ad-select" value={method} onChange={e => { setMethod(e.target.value); setPreview(null); }}>
            {CUTOFF_METHODS.filter(m => m.value !== "NONE").map(m => <option key={m.value} value={m.value}>{m.label}</option>)}
          </select>
          <div className="ws-hint">{meta?.hint}</div>
        </div>
        {meta?.needsValue && (
          <div className="ad-field">
            <label className="ad-label">Value ({meta.unit})</label>
            <input type="number" className="ad-input" value={value} onChange={e => { setValue(e.target.value); setPreview(null); }} />
          </div>
        )}
        <div className="ad-field" style={{ alignSelf: "end" }}>
          <button className="ad-btn ad-btn--outline" onClick={runPreview}
            disabled={busy || (meta?.needsValue && value === "")}>
            {busy ? <><Spinner />Calculating…</> : "Preview"}
          </button>
        </div>
      </div>

      {preview && (
        <>
          <div className="ws-stat-strip" style={{ marginTop: 16 }}>
            <StatCell label="Considered"    value={preview.considered} />
            <StatCell label="Will qualify"  value={preview.willQualify} color="#16A34A" />
            <StatCell label="Will reject"   value={preview.willReject} color="#DC2626" />
            <StatCell label="Not attempted" value={preview.notAttempted} color="#94A3B8" />
          </div>
          <div className="ad-table-wrap" style={{ maxHeight: 340, overflowY: "auto" }}>
            <table className="ad-table">
              <thead>
                <tr>
                  {method === "MANUAL" && <th>Pick</th>}
                  <th>Candidate</th><th>Score</th><th>%</th><th>Attempt</th><th>Expected Result</th>
                </tr>
              </thead>
              <tbody>
                {preview.candidates.map(c => (
                  <tr key={c._id}>
                    {method === "MANUAL" && (
                      <td><input type="checkbox" checked={picked.has(c.applicationId)} onChange={() => toggle(c.applicationId)} /></td>
                    )}
                    <td><div style={{ fontWeight: 600 }}>{c.name}</div><div className="ad-td-sm">{c.email}</div></td>
                    <td>{c.score != null ? `${c.score}/${c.totalMarks}` : "—"}</td>
                    <td>{c.percentage != null ? `${c.percentage}%` : "—"}</td>
                    <td><StatusBadge value={c.roundStatus} /></td>
                    <td><StatusBadge value={c.willQualify ? "QUALIFIED" : "REJECTED"} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div style={{ fontSize: 12, color: "var(--text-3)", marginTop: 10 }}>
            Manual overrides already recorded are left untouched when you apply.
          </div>
        </>
      )}

      <div style={{ display: "flex", gap: 10, justifyContent: "flex-end", marginTop: 20 }}>
        <button className="ad-btn ad-btn--outline" onClick={onClose} disabled={applying}>Cancel</button>
        <button className="ad-btn ad-btn--primary" onClick={apply} disabled={!preview || applying}>
          {applying ? <><Spinner />Applying…</> : "Apply Cutoff"}
        </button>
      </div>
    </Modal>
  );
}

/* ── Manual results for interview-style rounds ────────────────────────────── */
function ManualResultsModal({ round, rows, onClose, onSaved, onError }) {
  const [vals, setVals] = useState(() => Object.fromEntries(rows.map(r => [r.applicationId, { score: r.score ?? "", totalMarks: r.totalMarks ?? "" }])));
  const [saving, setSaving] = useState(false);
  const set = (id, k, v) => setVals(p => ({ ...p, [id]: { ...p[id], [k]: v } }));

  const submit = async () => {
    const results = Object.entries(vals)
      .filter(([, v]) => v.score !== "" && v.score != null)
      .map(([applicationId, v]) => ({ applicationId, score: Number(v.score), totalMarks: Number(v.totalMarks) || 100 }));
    if (!results.length) { onError("Enter at least one score."); return; }
    setSaving(true);
    try { const r = await recordResults(round._id, { results }); onSaved(r.saved); }
    catch (e) { onError(e.message); setSaving(false); }
  };

  return (
    <Modal title={`Enter Results — ${round.name}`} wide
      sub="For interview-style rounds the evaluator records the score here. Qualification is still decided by the round's cutoff." onClose={onClose}>
      {rows.length === 0 ? <Empty icon="👥" title="No candidates in this round yet" /> : (
        <div className="ad-table-wrap">
          <table className="ad-table">
            <thead><tr><th>Candidate</th><th>Score</th><th>Out of</th></tr></thead>
            <tbody>
              {rows.map(c => (
                <tr key={c._id}>
                  <td><div style={{ fontWeight: 600 }}>{c.name}</div><div className="ad-td-sm">{c.email}</div></td>
                  <td><input type="number" className="ad-input" style={{ width: 100 }}
                    value={vals[c.applicationId]?.score ?? ""} onChange={e => set(c.applicationId, "score", e.target.value)} /></td>
                  <td><input type="number" className="ad-input" style={{ width: 100 }}
                    value={vals[c.applicationId]?.totalMarks ?? ""} onChange={e => set(c.applicationId, "totalMarks", e.target.value)} placeholder="100" /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <div style={{ display: "flex", gap: 10, justifyContent: "flex-end", marginTop: 18 }}>
        <button className="ad-btn ad-btn--outline" onClick={onClose} disabled={saving}>Cancel</button>
        <button className="ad-btn ad-btn--primary" onClick={submit} disabled={saving || !rows.length}>
          {saving ? <><Spinner />Saving…</> : "Save Results"}
        </button>
      </div>
    </Modal>
  );
}

/* ── Manual qualification override ────────────────────────────────────────── */
function OverrideModal({ candidate, onClose, onSaved, onError }) {
  const [to, setTo] = useState(candidate.qualification === "QUALIFIED" ? "REJECTED" : "QUALIFIED");
  const [reason, setReason] = useState("");
  const [saving, setSaving] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    if (!reason.trim()) { onError("A reason is required — it is stored with the override."); return; }
    setSaving(true);
    try { await overrideResult(candidate._id, { to, reason: reason.trim() }); onSaved(); }
    catch (e2) { onError(e2.message); setSaving(false); }
  };

  return (
    <Modal title="Override Qualification" sub={`${candidate.name} · currently ${pretty(candidate.qualification)}`} onClose={onClose}>
      <form onSubmit={submit}>
        <div className="ad-field">
          <label className="ad-label">New Decision</label>
          <select className="ad-input ad-select" value={to} onChange={e => setTo(e.target.value)}>
            <option value="QUALIFIED">Qualified</option>
            <option value="REJECTED">Rejected</option>
          </select>
        </div>
        <div className="ad-field" style={{ marginTop: 14 }}>
          <label className="ad-label">Reason<span className="ws-req">*</span></label>
          <textarea className="ad-input" rows={3} value={reason} onChange={e => setReason(e.target.value)}
            placeholder="e.g. Panel decision after review" />
          <div className="ws-hint">The original decision is preserved alongside this override, with your name and the time.</div>
        </div>
        <div style={{ display: "flex", gap: 10, justifyContent: "flex-end", marginTop: 20 }}>
          <button type="button" className="ad-btn ad-btn--outline" onClick={onClose} disabled={saving}>Cancel</button>
          <button type="submit" className="ad-btn ad-btn--primary" disabled={saving}>
            {saving ? <><Spinner />Saving…</> : "Apply Override"}
          </button>
        </div>
      </form>
    </Modal>
  );
}
