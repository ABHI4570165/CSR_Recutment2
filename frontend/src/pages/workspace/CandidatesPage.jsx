import React, { useCallback, useEffect, useState } from "react";
import * as XLSX from "xlsx";
import { listApplications, listWorkspaceRounds, fetchApplication } from "../../utils/workspaceApi";
import {
  Loading, Empty, ErrorNote, Modal, Spinner, StatusBadge, useToast, Pagination,
  Field, fmtDate, fmtDateTime, pretty, toneOf,
} from "./ui";

/*
 * All Candidates — the PEOPLE view.
 *
 * One row per candidate application, however many rounds they have taken. The
 * round filter narrows WHICH people are listed; it never multiplies a person
 * into several rows, because the backend resolves round filters to a set of
 * application ids before paginating.
 */

export default function CandidatesPage({ showToastOverride }) {
  const [rows, setRows] = useState([]);
  const [pag, setPag] = useState({});
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const [roundId, setRoundId] = useState("");
  const [qualification, setQualification] = useState("");
  const [roundStatus, setRoundStatus] = useState("");
  const [overallStatus, setOverallStatus] = useState("");
  const [rounds, setRounds] = useState([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");
  const [openId, setOpenId] = useState(null);
  const [exporting, setExporting] = useState(false);
  const { showToast, toastEl } = useToast();
  const toast = showToastOverride || showToast;

  const params = useCallback(() => ({
    page, limit: 20,
    search: search || undefined,
    roundId: roundId || undefined,
    qualification: qualification || undefined,
    roundStatus: roundStatus || undefined,
    overallStatus: overallStatus || undefined,
  }), [page, search, roundId, qualification, roundStatus, overallStatus]);

  const load = useCallback(async () => {
    setLoading(true);
    try { const r = await listApplications(params()); setRows(r.data || []); setPag(r.pagination || {}); setErr(""); }
    catch (e) { setErr(e.message); }
    finally { setLoading(false); }
  }, [params]);

  useEffect(() => { load(); }, [load]);

  // The round filter is populated from THIS WORKSPACE's rounds — whatever they
  // are named, however many there are. No drive is involved.
  useEffect(() => {
    listWorkspaceRounds().then(r => setRounds(r || [])).catch(() => setRounds([]));
  }, []);

  const exportXlsx = async () => {
    setExporting(true);
    try {
      const r = await listApplications({ ...params(), page: 1, limit: 5000 });
      const ws = XLSX.utils.json_to_sheet((r.data || []).map(c => ({
        Name: c.name, Email: c.email, Phone: c.phone || "", College: c.college || "",
        Course: c.course || "", Branch: c.branch || "",
        "Current Round": c.currentRound?.name || (c.finallySelected ? "Final Selection" : "—"),
        "Overall Status": pretty(c.overallStatus),
        "Highest Qualified Round": c.highestQualifiedSequence || 0,
        "Rounds Taken": c.roundsTaken, "Rounds Qualified": c.roundsQualified,
        "Finally Selected": c.finallySelected ? "Yes" : "No",
        Added: fmtDate(c.createdAt),
      })));
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, "Students");
      XLSX.writeFile(wb, "Students.xlsx");
    } catch (e) { toast({ type: "error", title: "Export failed", lines: [e.message] }); }
    finally { setExporting(false); }
  };

  const resetFilters = () => {
    setSearch(""); setRoundId(""); setQualification(""); setRoundStatus(""); setOverallStatus("");
    setPage(1);
  };

  return (
    <div>
      {!showToastOverride && toastEl}
      <div className="ad-section-head">
        <div className="ad-page-title" style={{ marginBottom: 0 }}>
          Students ({pag.total ?? 0})
          <span style={{ fontSize: 12, fontWeight: 500, color: "var(--text-3)", marginLeft: 10 }}>
            one row per person, however many rounds they have taken
          </span>
        </div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <button className="ad-btn ad-btn--export" onClick={exportXlsx} disabled={exporting || !rows.length}>
            {exporting ? <><Spinner />Exporting…</> : "⬇ Export Excel"}
          </button>
        </div>
      </div>

      <div className="ad-toolbar">
        <input className="ad-search" placeholder="Search name, email, phone, college…"
          value={search} onChange={e => { setSearch(e.target.value); setPage(1); }} />
        <select className="ad-select" value={roundId} onChange={e => { setRoundId(e.target.value); setPage(1); }}
          disabled={!rounds.length} title={rounds.length ? "Filter by round" : "No rounds configured yet"}>
          <option value="">All Rounds</option>
          {rounds.map(r => <option key={r._id} value={r._id}>{r.sequence}. {r.name}</option>)}
        </select>
        <select className="ad-select" value={qualification} onChange={e => { setQualification(e.target.value); setPage(1); }}>
          <option value="">Any qualification</option>
          <option value="QUALIFIED">Qualified</option>
          <option value="REJECTED">Rejected</option>
          <option value="PENDING">Pending</option>
        </select>
        <select className="ad-select" value={roundStatus} onChange={e => { setRoundStatus(e.target.value); setPage(1); }}>
          <option value="">Any attempt state</option>
          <option value="NOT_STARTED">Not started</option>
          <option value="IN_PROGRESS">In progress</option>
          <option value="COMPLETED">Completed</option>
          <option value="NOT_ATTEMPTED">Not attempted</option>
        </select>
        <select className="ad-select" value={overallStatus} onChange={e => { setOverallStatus(e.target.value); setPage(1); }}>
          <option value="">Any overall status</option>
          <option value="REGISTERED">Registered</option>
          <option value="IN_PROGRESS">In progress</option>
          <option value="SHORTLISTED">Shortlisted</option>
          <option value="REJECTED">Rejected</option>
          <option value="FINALLY_SELECTED">Finally selected</option>
        </select>
        <button className="ad-btn ad-btn--sm ad-btn--outline" onClick={resetFilters}>Clear</button>
      </div>

      {err && <ErrorNote message={err} onRetry={load} />}

      <div className="ad-table-wrap">
        {loading && !rows.length ? <Loading label="Loading candidates…" />
          : rows.length === 0 ? (
            <Empty icon="👥" title="No candidates match these filters"
              hint="Try clearing the filters. Students appear here once they register or are added to a round." />
          ) : (
            <table className="ad-table">
              <thead>
                <tr>
                  <th>#</th><th>Name</th><th>Email</th><th>Phone</th><th>College</th>
                  <th>Course</th><th>Branch</th><th>Current Round</th><th>Rounds</th><th>Overall</th>
                  <th>Final</th><th></th>
                </tr>
              </thead>
              <tbody>
                {rows.map((c, i) => (
                  <tr key={c._id}>
                    <td className="ad-td-num">{(page - 1) * 20 + i + 1}</td>
                    <td><div className="ad-td-name"><div className="ad-avatar">{(c.name || "?").charAt(0)}</div>{c.name}</div></td>
                    <td className="ad-td-sm">{c.email}</td>
                    <td className="ad-td-sm">{c.phone || "—"}</td>
                    <td className="ad-td-sm">{c.college || "—"}</td>
                    <td className="ad-td-sm">{c.course || "—"}</td>
                    <td className="ad-td-sm">{c.branch || "—"}</td>
                    <td className="ad-td-sm">{c.currentRound?.name || (c.finallySelected ? "Final Selection" : "—")}</td>
                    <td className="ad-td-sm">{c.roundsQualified}/{c.roundsTaken} qualified</td>
                    <td><StatusBadge value={c.overallStatus} /></td>
                    <td>{c.finallySelected ? <span className="ad-badge ad-badge--green">Selected</span> : <span className="ad-badge ad-badge--gray">—</span>}</td>
                    <td><button className="ad-btn ad-btn--sm ad-btn--outline" onClick={() => setOpenId(c._id)}>View</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
      </div>
      <Pagination pag={pag} page={page} setPage={setPage} />

      {openId && <CandidateProfile applicationId={openId} onClose={() => setOpenId(null)} />}
    </div>
  );
}

/* ── Candidate profile + dynamic recruitment journey ──────────────────────── */
export function CandidateProfile({ applicationId, onClose }) {
  const [data, setData] = useState(null);
  const [err, setErr] = useState("");

  useEffect(() => {
    let alive = true;
    fetchApplication(applicationId)
      .then(d => { if (alive) setData(d); })
      .catch(e => { if (alive) setErr(e.message); });
    return () => { alive = false; };
  }, [applicationId]);

  const s = data?.student || {};
  // Custom registration answers live on the application, so one company's
  // extra fields never surface in another company's view.
  const custom = {
    ...(s.customFields && typeof s.customFields === "object" ? s.customFields : {}),
    ...(data?.application?.registrationData && typeof data.application.registrationData === "object"
      ? data.application.registrationData : {}),
  };

  return (
    <Modal wide title={s.name || "Student"} sub={data ? s.email : ""} onClose={onClose}>
      {err && <ErrorNote message={err} />}
      {!data && !err && <Loading label="Loading candidate…" />}
      {data && (
        <>
          <section className="ad-card-section">
            <div className="ad-card-section-title">👤 Personal Information</div>
            <div className="ad-pf-grid">
              <Field label="Full Name" value={s.name} />
              <Field label="Email" value={s.email} />
              <Field label="Contact Number" value={s.phone} />
              <Field label="College" value={s.college} />
              <Field label="Course" value={s.course} />
              <Field label="Branch" value={s.branch} />
              <Field label="Role" value={data.drive?.role} />
              <Field label="Overall Status" value={<StatusBadge value={data.application?.overallStatus} />} />
              <Field label="Current Stage" value={data.currentStage} />
              <Field label="Added" value={fmtDate(data.application?.createdAt)} />
              {Object.entries(custom).map(([k, v]) => <Field key={k} label={pretty(k)} value={String(v)} />)}
            </div>
          </section>

          <section className="ad-card-section">
            <div className="ad-card-section-title">
              🪜 Recruitment Journey
              <span style={{ fontWeight: 500, fontSize: 12, color: "var(--text-3)", marginLeft: 8 }}>
                {data.totalRounds} round{data.totalRounds === 1 ? "" : "s"} configured for this workspace
              </span>
            </div>
            {(!data.journey || data.journey.length === 0)
              ? <Empty icon="🪜" title="No rounds configured for this workspace yet" />
              : (
                <div className="ws-journey">
                  {data.journey.map((r, i) => {
                    const done = r.roundStatus !== "NOT_ATTEMPTED" && r.roundStatus !== "NOT_STARTED";
                    const c = r.qualification ? toneOf(r.qualification) : toneOf(r.roundStatus);
                    const icon = r.qualification === "QUALIFIED" ? "✓" : r.qualification === "REJECTED" ? "✗" : done ? "•" : "○";
                    return (
                      <div className="ws-jrow" key={r.roundId}>
                        <div className="ws-jrail">
                          <div className="ws-jdot" style={{ background: c + "1F", color: c, borderColor: c + "66" }}>{icon}</div>
                          {i < data.journey.length - 1 && <div className="ws-jline" />}
                        </div>
                        <div className="ws-jbody">
                          <div className="ws-jhead">
                            <div>
                              <span className="ws-jseq">Round {r.sequence}</span>
                              <div className="ws-jname">{r.name}</div>
                            </div>
                            <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                              <StatusBadge value={r.roundStatus} />
                              {r.qualification && <StatusBadge value={r.qualification} />}
                            </div>
                          </div>
                          <div className="ws-jstats">
                            <span className="ws-jstat">Score: <b>{r.score != null ? `${r.score}/${r.totalMarks}` : "—"}</b></span>
                            <span className="ws-jstat">Percentage: <b>{r.percentage != null ? `${r.percentage}%` : "—"}</b></span>
                            <span className="ws-jstat">Cutoff: <b>{r.cutoff && r.cutoff.method !== "NONE" && r.cutoff.value != null
                              ? (r.cutoff.method === "PERCENTAGE" ? `${r.cutoff.value}%` : r.cutoff.method === "TOP_N" ? `Top ${r.cutoff.value}` : `${r.cutoff.value}`)
                              : "—"}</b></span>
                            {r.completedAt && <span className="ws-jstat">Completed: <b>{fmtDateTime(r.completedAt)}</b></span>}
                            {r.attempts > 1 && <span className="ws-jstat">Attempts: <b>{r.attempts}</b></span>}
                            {r.violations > 0 && <span className="ws-jstat">Violations: <b>{r.violations}</b></span>}
                          </div>
                          {r.override && (
                            <div className="ws-joverride">
                              Manually changed from <strong>{pretty(r.override.from)}</strong> to <strong>{pretty(r.override.to)}</strong> by {r.override.by} on {fmtDateTime(r.override.at)} — “{r.override.reason}”
                            </div>
                          )}
                        </div>
                      </div>
                    );
                  })}
                  <div className="ws-jrow">
                    <div className="ws-jrail">
                      <div className="ws-jdot" style={{
                        background: data.application?.finalSelection?.selected ? "#16A34A1F" : "var(--surface-2)",
                        color: data.application?.finalSelection?.selected ? "#16A34A" : "var(--text-3)",
                        borderColor: data.application?.finalSelection?.selected ? "#16A34A66" : "var(--border)",
                      }}>{data.application?.finalSelection?.selected ? "★" : "○"}</div>
                    </div>
                    <div className="ws-jbody">
                      <div className="ws-jname">Final Selection</div>
                      <div className="ws-jstats">
                        <span>{data.application?.finalSelection?.selected
                          ? <>Selected on <b>{fmtDate(data.application.finalSelection.selectedAt)}</b></>
                          : "Pending — awaiting the final round"}</span>
                      </div>
                    </div>
                  </div>
                </div>
              )}
          </section>
        </>
      )}
    </Modal>
  );
}
