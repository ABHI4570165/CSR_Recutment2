import React, { useCallback, useEffect, useState } from "react";
import * as XLSX from "xlsx";
import {
  listDrives, createDrive, fetchDrive, updateDrive, deleteDrive,
  createRound, updateRound, deleteRound, finalSelection,
} from "../../utils/workspaceApi";
import {
  Loading, Empty, ErrorNote, Modal, Confirm, Spinner, StatusBadge, useToast, fmtDate,
} from "./ui";
import { RoundCard, RoundForm } from "./RoundBuilder";
import RoundPanel from "./RoundPanel";
import CandidatesPage from "./CandidatesPage";

/*
 * Drives — list, create (with the dynamic round builder), and manage.
 *
 * A drive is created ONCE and owns its rounds. Adding a second round never
 * means adding a second drive.
 */

export default function DrivesPage({ workspace, readOnly }) {
  const [drives, setDrives] = useState([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");
  const [openDrive, setOpenDrive] = useState(null);
  const [showCreate, setShowCreate] = useState(false);
  const { showToast, toastEl } = useToast();

  const load = useCallback(async () => {
    setLoading(true);
    try { setDrives(await listDrives() || []); setErr(""); }
    catch (e) { setErr(e.message); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { load(); }, [load]);

  if (openDrive) {
    return (
      <DriveDetail driveId={openDrive} workspace={workspace} readOnly={readOnly}
        onBack={() => { setOpenDrive(null); load(); }}
        showToast={showToast} toastEl={toastEl} />
    );
  }

  return (
    <div>
      {toastEl}
      <div className="ad-section-head">
        <div className="ad-page-title" style={{ marginBottom: 0 }}>Recruitment Drives ({drives.length})</div>
        {!readOnly && <button className="ad-btn ad-btn--primary" onClick={() => setShowCreate(true)}>＋ Create Drive</button>}
      </div>

      {err && <ErrorNote message={err} onRetry={load} />}

      {loading && !drives.length ? <Loading label="Loading drives…" />
        : drives.length === 0 ? (
          <Empty icon="🎓" title="No drives in this workspace yet"
            hint="A drive is one recruitment campaign — it holds its own rounds, candidates and final selection."
            action={!readOnly && <button className="ad-btn ad-btn--primary" onClick={() => setShowCreate(true)}>＋ Create your first drive</button>} />
        ) : (
          <div className="ad-table-wrap">
            <table className="ad-table">
              <thead>
                <tr><th>#</th><th>Drive</th><th>Role</th><th>Status</th><th>Rounds</th><th>Candidates</th><th>Created</th><th>Selection Page</th><th></th></tr>
              </thead>
              <tbody>
                {drives.map((d, i) => (
                  <tr key={d._id}>
                    <td className="ad-td-num">{i + 1}</td>
                    <td><strong>{d.name}</strong>{d.description && <div className="ad-td-sm">{d.description}</div>}</td>
                    <td className="ad-td-sm">{d.role || "—"}</td>
                    <td><StatusBadge value={d.status} /></td>
                    <td>{d.roundCount || 0}</td>
                    <td>{d.candidateCount || 0}</td>
                    <td className="ad-td-sm">{fmtDate(d.createdAt)}</td>
                    <td>{d.publishSelection
                      ? <span className="ad-badge ad-badge--green">Published</span>
                      : <span className="ad-badge ad-badge--gray">Not published</span>}</td>
                    <td><button className="ad-btn ad-btn--sm ad-btn--primary" onClick={() => setOpenDrive(d._id)}>Manage</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

      {showCreate && (
        <CreateDriveModal onClose={() => setShowCreate(false)}
          onCreated={(r) => {
            setShowCreate(false);
            showToast({ title: `Drive created with ${r.rounds?.length || 0} round(s)` });
            load(); setOpenDrive(r.drive._id);
          }}
          onError={(m) => showToast({ type: "error", title: "Could not create drive", lines: [m] })} />
      )}
    </div>
  );
}

/* ── Create drive + build its rounds ──────────────────────────────────────── */
function CreateDriveModal({ onClose, onCreated, onError }) {
  const [f, setF] = useState({ name: "", role: "", description: "", status: "DRAFT" });
  const [rounds, setRounds] = useState([]);
  const [editing, setEditing] = useState(null);   // {index} | "new"
  const [saving, setSaving] = useState(false);
  const set = (k) => (e) => setF(p => ({ ...p, [k]: e.target.value }));

  const saveRound = (data) => {
    if (editing === "new") setRounds(r => [...r, data]);
    else setRounds(r => r.map((x, i) => (i === editing.index ? { ...x, ...data } : x)));
    setEditing(null);
  };

  const submit = async (e) => {
    e.preventDefault();
    if (!f.name.trim()) { onError("Give the drive a name."); return; }
    if (!rounds.length) { onError("Add at least one round — a drive needs somewhere to start."); return; }
    setSaving(true);
    try {
      const r = await createDrive({
        name: f.name.trim(), role: f.role.trim(), description: f.description.trim(), status: f.status,
        rounds: rounds.map(x => ({
          name: x.name, roundType: x.roundType, description: x.description,
          cutoffMethod: x.cutoffMethod, cutoffValue: x.cutoffValue,
        })),
      });
      onCreated(r);
    } catch (e2) { onError(e2.message); setSaving(false); }
  };

  return (
    <Modal title="Create Recruitment Drive" wide
      sub="Add as many rounds as this drive needs — there is no fixed number and no fixed names."
      onClose={onClose}>
      <form onSubmit={submit}>
        <section className="ad-card-section">
          <div className="ad-card-section-title">🎓 Drive</div>
          <div className="ws-form-grid">
            <div className="ad-field">
              <label className="ad-label">Drive Name<span className="ws-req">*</span></label>
              <input className="ad-input" value={f.name} onChange={set("name")} placeholder="e.g. 2026 Campus Recruitment" autoFocus />
            </div>
            <div className="ad-field">
              <label className="ad-label">Role</label>
              <input className="ad-input" value={f.role} onChange={set("role")} placeholder="e.g. Software Engineer" />
              <div className="ws-hint">Shown on the final-selection page.</div>
            </div>
            <div className="ad-field">
              <label className="ad-label">Status</label>
              <select className="ad-input ad-select" value={f.status} onChange={set("status")}>
                <option value="DRAFT">Draft</option>
                <option value="ACTIVE">Active</option>
              </select>
            </div>
          </div>
          <div className="ad-field" style={{ marginTop: 14 }}>
            <label className="ad-label">Description</label>
            <input className="ad-input" value={f.description} onChange={set("description")} />
          </div>
        </section>

        <section className="ad-card-section">
          <div className="ad-card-section-title">🪜 Rounds ({rounds.length})</div>
          <div className="ws-rounds">
            {rounds.map((r, i) => (
              <RoundCard key={i} round={{ ...r, sequence: i + 1, cutoff: { method: r.cutoffMethod, value: r.cutoffValue } }}
                index={i} total={rounds.length}
                onEdit={() => setEditing({ index: i })}
                onDelete={() => setRounds(list => list.filter((_, j) => j !== i))} />
            ))}
            <button type="button" className="ws-add-round" onClick={() => setEditing("new")}>
              ＋ Add {rounds.length ? "Another " : ""}Round
            </button>
          </div>
          {rounds.length > 0 && (
            <div className="ws-hint" style={{ marginTop: 10 }}>
              Round 1 is open to every candidate in the drive. Each later round admits only candidates who qualified the one before it.
              The last round in this list decides final selection.
            </div>
          )}
        </section>

        <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
          <button type="button" className="ad-btn ad-btn--outline" onClick={onClose} disabled={saving}>Cancel</button>
          <button type="submit" className="ad-btn ad-btn--primary" disabled={saving}>
            {saving ? <><Spinner />Creating…</> : "Create Drive"}
          </button>
        </div>
      </form>

      {editing && (
        <RoundForm
          round={editing === "new" ? null : { ...rounds[editing.index], sequence: editing.index + 1, cutoff: { method: rounds[editing.index].cutoffMethod, value: rounds[editing.index].cutoffValue } }}
          sequence={editing === "new" ? rounds.length + 1 : editing.index + 1}
          isFirst={editing === "new" ? rounds.length === 0 : editing.index === 0}
          onSave={saveRound} onClose={() => setEditing(null)} />
      )}
    </Modal>
  );
}

/* ── Drive detail: rounds · candidates · final selection ──────────────────── */
function DriveDetail({ driveId, workspace, onBack, readOnly, showToast, toastEl }) {
  const [tab, setTab] = useState("rounds");
  const [data, setData] = useState(null);
  const [err, setErr] = useState("");
  const [openRound, setOpenRound] = useState(null);
  const [editingRound, setEditingRound] = useState(null);
  const [delRound, setDelRound] = useState(null);
  const [busy, setBusy] = useState(false);
  const [showEdit, setShowEdit] = useState(false);

  const load = useCallback(async () => {
    try { setData(await fetchDrive(driveId)); setErr(""); }
    catch (e) { setErr(e.message); }
  }, [driveId]);
  useEffect(() => { load(); }, [load]);

  const drive = data?.drive;
  const rounds = data?.rounds || [];
  const locked = rounds.some(r => (r.participantCount || 0) > 0);

  const saveRound = async (payload) => {
    setBusy(true);
    try {
      if (editingRound === "new") await createRound(driveId, payload);
      else await updateRound(driveId, editingRound._id, payload);
      setEditingRound(null); load();
      showToast({ title: editingRound === "new" ? "Round added" : "Round updated" });
    } catch (e) { showToast({ type: "error", title: "Could not save round", lines: [e.message] }); }
    finally { setBusy(false); }
  };

  const removeRound = async () => {
    setBusy(true);
    try { await deleteRound(driveId, delRound._id); setDelRound(null); load(); showToast({ title: "Round deleted" }); }
    catch (e) { setDelRound(null); showToast({ type: "error", title: "Could not delete round", lines: [e.message] }); }
    finally { setBusy(false); }
  };

  const togglePublish = async () => {
    try {
      const d = await updateDrive(driveId, { publishSelection: !drive.publishSelection });
      setData(p => ({ ...p, drive: d }));
      showToast({ title: d.publishSelection ? "Selection page published" : "Selection page unpublished" });
    } catch (e) { showToast({ type: "error", title: "Could not update", lines: [e.message] }); }
  };

  if (err) return <><ErrorNote message={err} onRetry={load} /><button className="ad-btn ad-btn--outline" onClick={onBack}>← Back</button></>;
  if (!drive) return <Loading label="Loading drive…" />;

  if (openRound) {
    return (
      <RoundPanel round={openRound} driveId={driveId} readOnly={readOnly}
        onBack={() => { setOpenRound(null); load(); }}
        onChanged={load} />
    );
  }

  return (
    <div>
      {toastEl}
      <div className="ws-crumb">
        <button onClick={onBack}>← All drives</button>
        <span>/</span><span>{drive.name}</span>
      </div>

      <div className="ad-section-head">
        <div>
          <div className="ad-page-title" style={{ marginBottom: 6 }}>{drive.name}</div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <StatusBadge value={drive.status} />
            {drive.role && <span className="ad-badge ad-badge--blue">{drive.role}</span>}
            <span className="ad-badge ad-badge--gray">{rounds.length} round{rounds.length === 1 ? "" : "s"}</span>
          </div>
        </div>
        {!readOnly && (
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <button className="ad-btn ad-btn--outline" onClick={() => setShowEdit(true)}>Edit Drive</button>
            <button className={`ad-btn ${drive.publishSelection ? "ad-btn--outline" : "ad-btn--primary"}`} onClick={togglePublish}>
              {drive.publishSelection ? "Unpublish Selection" : "Publish Selection"}
            </button>
          </div>
        )}
      </div>

      {/* Public self-registration link — students register here, then go
          straight into whatever the first round is called. */}
      {workspace?.slug && drive.slug && (
        <div className="ws-hint" style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap", marginBottom: 16 }}>
          <span>Registration link:</span>
          <a href={`${window.location.origin}/register/${workspace.slug}/${drive.slug}`} target="_blank" rel="noreferrer"
            style={{ color: "var(--primary)", fontWeight: 700 }}>
            {window.location.origin}/register/{workspace.slug}/{drive.slug}
          </a>
          <button className="ad-btn ad-btn--sm ad-btn--outline"
            onClick={() => {
              navigator.clipboard?.writeText(`${window.location.origin}/register/${workspace.slug}/${drive.slug}`);
              showToast({ title: "Registration link copied" });
            }}>Copy</button>
          {drive.status !== "ACTIVE" && <span className="ad-badge ad-badge--amber">Drive not active — registration is closed</span>}
          {rounds.length > 0 && rounds[0].status !== "ACTIVE" &&
            <span className="ad-badge ad-badge--amber">“{rounds[0].name}” not active — registration is closed</span>}
        </div>
      )}

      <div className="ws-sub-tabs">
        <button className={`ws-sub-tab ${tab === "rounds" ? "ws-sub-tab--active" : ""}`} onClick={() => setTab("rounds")}>Rounds</button>
        <button className={`ws-sub-tab ${tab === "candidates" ? "ws-sub-tab--active" : ""}`} onClick={() => setTab("candidates")}>Candidates</button>
        <button className={`ws-sub-tab ${tab === "final" ? "ws-sub-tab--active" : ""}`} onClick={() => setTab("final")}>Final Selection</button>
      </div>

      {tab === "rounds" && (
        <div className="ws-rounds">
          {rounds.length === 0 && (
            <Empty icon="🪜" title="No rounds yet" hint="Add the first round — it is open to every candidate in this drive." />
          )}
          {rounds.map((r, i) => (
            <RoundCard key={r._id} round={r} index={i} total={rounds.length} showStats
              locked={locked && i === 0}
              onOpen={() => setOpenRound(r)}
              onEdit={readOnly ? null : () => setEditingRound(r)}
              onDelete={readOnly || (r.participantCount || 0) > 0 ? null : () => setDelRound(r)} />
          ))}
          {!readOnly && (
            <button className="ws-add-round" onClick={() => setEditingRound("new")}>
              ＋ Add {rounds.length ? "Another " : ""}Round
            </button>
          )}
        </div>
      )}

      {tab === "candidates" && <CandidatesPage driveId={driveId} driveName={drive.name} showToastOverride={showToast} />}

      {tab === "final" && <FinalSelection driveId={driveId} drive={drive} workspace={workspace} showToast={showToast} />}

      {editingRound && (
        <RoundForm round={editingRound === "new" ? null : editingRound}
          sequence={editingRound === "new" ? rounds.length + 1 : editingRound.sequence}
          isFirst={editingRound === "new" ? rounds.length === 0 : editingRound.sequence === 1}
          saving={busy} onSave={saveRound} onClose={() => setEditingRound(null)} />
      )}
      {delRound && (
        <Confirm title={`Delete “${delRound.name}”?`}
          message="This round has no candidate records, so it can be safely removed. Later rounds move up one position."
          confirmLabel="Delete Round" busyLabel="Deleting…" tone="danger"
          loading={busy} onConfirm={removeRound} onCancel={() => setDelRound(null)} />
      )}
      {showEdit && (
        <EditDriveModal drive={drive} onClose={() => setShowEdit(false)}
          onSaved={(d) => { setShowEdit(false); setData(p => ({ ...p, drive: d })); showToast({ title: "Drive updated" }); }}
          onError={(m) => showToast({ type: "error", title: "Could not update drive", lines: [m] })} />
      )}
    </div>
  );
}

function EditDriveModal({ drive, onClose, onSaved, onError }) {
  const [f, setF] = useState({ name: drive.name, role: drive.role || "", description: drive.description || "", status: drive.status });
  const [saving, setSaving] = useState(false);
  const set = (k) => (e) => setF(p => ({ ...p, [k]: e.target.value }));
  const submit = async (e) => {
    e.preventDefault(); setSaving(true);
    try { onSaved(await updateDrive(drive._id, f)); }
    catch (e2) { onError(e2.message); setSaving(false); }
  };
  return (
    <Modal title="Edit Drive" onClose={onClose}>
      <form onSubmit={submit}>
        <div className="ws-form-grid">
          <div className="ad-field"><label className="ad-label">Drive Name</label>
            <input className="ad-input" value={f.name} onChange={set("name")} /></div>
          <div className="ad-field"><label className="ad-label">Role</label>
            <input className="ad-input" value={f.role} onChange={set("role")} /></div>
          <div className="ad-field"><label className="ad-label">Status</label>
            <select className="ad-input ad-select" value={f.status} onChange={set("status")}>
              <option value="DRAFT">Draft</option><option value="ACTIVE">Active</option>
              <option value="COMPLETED">Completed</option><option value="ARCHIVED">Archived</option>
            </select></div>
        </div>
        <div className="ad-field" style={{ marginTop: 14 }}>
          <label className="ad-label">Description</label>
          <input className="ad-input" value={f.description} onChange={set("description")} />
        </div>
        <div style={{ display: "flex", gap: 10, justifyContent: "flex-end", marginTop: 20 }}>
          <button type="button" className="ad-btn ad-btn--outline" onClick={onClose} disabled={saving}>Cancel</button>
          <button type="submit" className="ad-btn ad-btn--primary" disabled={saving}>{saving ? <><Spinner />Saving…</> : "Save"}</button>
        </div>
      </form>
    </Modal>
  );
}

/* ── Final selection ──────────────────────────────────────────────────────── */
function FinalSelection({ driveId, drive, workspace, showToast }) {
  const [data, setData] = useState(null);
  const [err, setErr] = useState("");
  const [exporting, setExporting] = useState(false);

  useEffect(() => {
    finalSelection(driveId).then(setData).catch(e => setErr(e.message));
  }, [driveId]);

  const exportXlsx = () => {
    setExporting(true);
    try {
      const ws = XLSX.utils.json_to_sheet((data.candidates || []).map(c => ({
        Name: c.name, Email: c.email, Phone: c.phone || "", College: c.college || "",
        Course: c.course || "", Branch: c.branch || "", Role: c.role || "",
        Status: "Selected", "Selected On": fmtDate(c.selectedAt),
      })));
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, "Final Selection");
      XLSX.writeFile(wb, `Final_Selection_${drive.name.replace(/\s+/g, "_")}.xlsx`);
    } catch (e) { showToast({ type: "error", title: "Export failed", lines: [e.message] }); }
    finally { setExporting(false); }
  };

  if (err) return <ErrorNote message={err} />;
  if (!data) return <Loading label="Loading final selection…" />;

  const pageUrl = (workspace?.slug && drive?.slug)
    ? `${window.location.origin}/selection/${workspace.slug}/${drive.slug}`
    : null;

  return (
    <div>
      <div className="ad-section-head">
        <div>
          <div style={{ fontSize: 13, color: "var(--text-3)" }}>Final round</div>
          <div style={{ fontSize: 17, fontWeight: 800, fontFamily: "var(--serif)" }}>
            {data.finalRound ? `${data.finalRound.sequence}. ${data.finalRound.name}` : "No rounds configured"}
          </div>
          <div className="ws-hint">
            Determined by the highest round sequence in this drive — never assumed.
            {data.totalRounds ? ` This drive has ${data.totalRounds} round${data.totalRounds === 1 ? "" : "s"}.` : ""}
          </div>
        </div>
        <button className="ad-btn ad-btn--export" onClick={exportXlsx} disabled={exporting || !data.candidates?.length}>
          {exporting ? <><Spinner />Exporting…</> : "⬇ Export Excel"}
        </button>
      </div>

      {(!data.candidates || data.candidates.length === 0) ? (
        <Empty icon="🏆" title="No candidates finally selected yet"
          hint={`Candidates appear here once they qualify ${data.finalRound ? `“${data.finalRound.name}”` : "the last round"}.`} />
      ) : (
        <div className="ad-table-wrap">
          <table className="ad-table">
            <thead><tr><th>#</th><th>Name</th><th>Email</th><th>College</th><th>Course</th><th>Branch</th><th>Role</th><th>Status</th><th>Selected</th></tr></thead>
            <tbody>
              {data.candidates.map((c, i) => (
                <tr key={c.applicationId}>
                  <td className="ad-td-num">{i + 1}</td>
                  <td><div className="ad-td-name"><div className="ad-avatar">{(c.name || "?").charAt(0)}</div>{c.name}</div></td>
                  <td className="ad-td-sm">{c.email}</td>
                  <td className="ad-td-sm">{c.college || "—"}</td>
                  <td className="ad-td-sm">{c.course || "—"}</td>
                  <td className="ad-td-sm">{c.branch || "—"}</td>
                  <td className="ad-td-sm">{c.role || drive.role || "—"}</td>
                  <td><span className="ad-badge ad-badge--green">Selected</span></td>
                  <td className="ad-td-sm">{fmtDate(c.selectedAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {drive.publishSelection && pageUrl && (
        <div className="ws-hint" style={{ marginTop: 14, display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
          <span>Public page is live:</span>
          <a href={pageUrl} target="_blank" rel="noreferrer" style={{ color: "var(--primary)", fontWeight: 700 }}>{pageUrl}</a>
          <button className="ad-btn ad-btn--sm ad-btn--outline"
            onClick={() => { navigator.clipboard?.writeText(pageUrl); showToast({ title: "Link copied" }); }}>Copy link</button>
        </div>
      )}
      {!drive.publishSelection && (
        <div className="ws-hint" style={{ marginTop: 14 }}>
          The public page is not published yet — use “Publish Selection” in the drive header when you are ready to share it.
        </div>
      )}
    </div>
  );
}
