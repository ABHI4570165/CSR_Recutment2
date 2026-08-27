import React, { useCallback, useEffect, useState } from "react";
import {
  listWorkspaceRounds, createWorkspaceRound, updateWorkspaceRound, deleteWorkspaceRound,
} from "../../utils/workspaceApi";
import { Loading, Empty, ErrorNote, Confirm, StatusBadge, useToast } from "./ui";
import { RoundForm, cutoffLabel, ROUND_TYPES } from "./RoundBuilder";
import RoundPanel from "./RoundPanel";

/*
 * ROUNDS — the sequential stages of this workspace's recruitment process.
 *
 * There is no drive layer here, in the data the admin sees or in the words on
 * screen: a workspace runs one process, and these are its stages. Round 1 is
 * open to everyone; every later stage admits only the candidates who qualified
 * the stage before it.
 */

export default function RoundsPage({ readOnly, onOpenRound = null }) {
  const [rounds, setRounds] = useState([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");
  const [open, setOpen] = useState(null);
  const [editing, setEditing] = useState(null);   // round | "new"
  const [delTarget, setDelTarget] = useState(null);
  const [busy, setBusy] = useState(false);
  const { showToast, toastEl } = useToast();

  const load = useCallback(async () => {
    setLoading(true);
    try { setRounds(await listWorkspaceRounds() || []); setErr(""); }
    catch (e) { setErr(e.message); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { load(); }, [load]);

  const save = async (payload) => {
    setBusy(true);
    try {
      if (editing === "new") await createWorkspaceRound(payload);
      else await updateWorkspaceRound(editing._id, payload);
      setEditing(null); load();
      showToast({ title: editing === "new" ? "Round added" : "Round updated" });
    } catch (e) { showToast({ type: "error", title: "Could not save round", lines: [e.message] }); }
    finally { setBusy(false); }
  };

  const remove = async () => {
    setBusy(true);
    try { await deleteWorkspaceRound(delTarget._id); setDelTarget(null); load(); showToast({ title: "Round deleted" }); }
    catch (e) { setDelTarget(null); showToast({ type: "error", title: "Could not delete round", lines: [e.message] }); }
    finally { setBusy(false); }
  };

  // When the parent supplies onOpenRound it owns the next level (the round's
  // drives), so this page stays a pure ROUND LIST and never renders drives.
  if (open && !onOpenRound) {
    return <RoundPanel round={open} readOnly={readOnly}
      onBack={() => { setOpen(null); load(); }} onChanged={load} />;
  }

  return (
    <div>
      {toastEl}
      <div className="ad-section-head">
        <div>
          <div className="ad-page-title" style={{ marginBottom: 4 }}>Rounds</div>
          <div className="ws-hint">
            Sequential stages of this company's recruitment. Only candidates who qualify a stage
            reach the next one — enforced by the backend.
          </div>
        </div>
        {!readOnly && <button className="ad-btn ad-btn--primary" onClick={() => setEditing("new")}>＋ Create Round</button>}
      </div>

      {err && <ErrorNote message={err} onRetry={load} />}

      {loading && !rounds.length ? <Loading label="Loading rounds…" />
        : rounds.length === 0 ? (
          <Empty icon="🪜" title="No rounds configured yet"
            hint="Add the first stage — Aptitude, Screening, whatever you call it. It will be open to every student in this workspace."
            action={!readOnly && <button className="ad-btn ad-btn--primary" onClick={() => setEditing("new")}>＋ Add the first round</button>} />
        ) : (
          <div className="ws-grid">
            {rounds.map((r, i) => {
              const type = ROUND_TYPES.find(t => t.value === r.roundType);
              const isFinal = i === rounds.length - 1;
              return (
                <article className="ws-round-tile" key={r._id}>
                  <div className="ws-round-tile-top">
                    <span className="ws-round-seq">{r.sequence}</span>
                    <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                      <StatusBadge value={r.status} />
                      {isFinal && <span className="ad-badge ad-badge--amber">Final round</span>}
                    </div>
                  </div>

                  <h3 className="ws-round-tile-name">{r.name}</h3>
                  <div className="ws-round-tile-type">{type?.label || r.roundType} · Cutoff: {cutoffLabel(r.cutoff)}</div>

                  <div className="ws-round-tile-stats">
                    <div><span className="ws-card-num">{r.driveCount ?? 0}</span> {r.driveCount === 1 ? "Drive" : "Drives"}</div>
                    <span className="ws-card-dot">·</span>
                    <div><span className="ws-card-num">{r.eligible}</span> {r.sequence === 1 ? "students" : "eligible"}</div>
                    <span className="ws-card-dot">·</span>
                    <div><span className="ws-card-num">{r.attended}</span> attended</div>
                  </div>
                  <div className="ws-round-tile-stats">
                    <div style={{ color: "#16A34A" }}><span className="ws-card-num" style={{ color: "#16A34A" }}>{r.qualified}</span> qualified</div>
                    <span className="ws-card-dot">·</span>
                    <div style={{ color: "#DC2626" }}><span className="ws-card-num" style={{ color: "#DC2626" }}>{r.rejected}</span> rejected</div>
                  </div>

                  {r.sequence > 1 && (
                    <div className="ws-round-tile-gate">
                      🔒 Only candidates who qualified “{rounds[i - 1].name}”
                    </div>
                  )}

                  <div className="ws-card-actions">
                    <button className="ad-btn ad-btn--primary" onClick={() => (onOpenRound ? onOpenRound(r) : setOpen(r))}>Open Round</button>
                    {!readOnly && <button className="ad-btn ad-btn--outline" onClick={() => setEditing(r)}>Edit</button>}
                    {!readOnly && r.eligible === 0 && (
                      <button className="ad-btn ad-btn--danger ad-btn--sm" onClick={() => setDelTarget(r)}>Delete</button>
                    )}
                  </div>
                </article>
              );
            })}
          </div>
        )}

      {editing && (
        <RoundForm round={editing === "new" ? null : editing}
          sequence={editing === "new" ? rounds.length + 1 : editing.sequence}
          isFirst={editing === "new" ? rounds.length === 0 : editing.sequence === 1}
          saving={busy} onSave={save} onClose={() => setEditing(null)} />
      )}
      {delTarget && (
        <Confirm title={`Delete “${delTarget.name}”?`}
          message="No candidate records belong to this round, so it can be safely removed. Later rounds move up one position."
          confirmLabel="Delete Round" busyLabel="Deleting…" tone="danger"
          loading={busy} onConfirm={remove} onCancel={() => setDelTarget(null)} />
      )}
    </div>
  );
}
