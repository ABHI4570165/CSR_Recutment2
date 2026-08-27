import React, { useCallback, useEffect, useState } from "react";
import * as XLSX from "xlsx";
import { listWorkspaceRounds, fetchWsDashboard, listApplications } from "../../utils/workspaceApi";
import { Loading, Empty, ErrorNote, useToast, StatusBadge, Spinner, fmtDate } from "./ui";

/*
 * RESULTS — the outcome of this workspace's recruitment process.
 *
 * Two views over the SAME participation records the rounds already own:
 * a per-round summary, and the final selected list taken from the highest
 * configured round. No drive appears anywhere.
 */

export default function ResultsPage({ workspace }) {
  const [rounds, setRounds] = useState([]);
  const [selected, setSelected] = useState([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");
  const [exporting, setExporting] = useState(false);
  const { showToast, toastEl } = useToast();

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [r, sel] = await Promise.all([
        listWorkspaceRounds(),
        listApplications({ overallStatus: "FINALLY_SELECTED", limit: 1000 }),
      ]);
      setRounds(r || []);
      setSelected(sel?.data || []);
      setErr("");
    } catch (e) { setErr(e.message); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { load(); }, [load]);

  const finalRound = rounds.length ? rounds[rounds.length - 1] : null;

  const exportSelected = () => {
    setExporting(true);
    try {
      const ws = XLSX.utils.json_to_sheet(selected.map(c => ({
        Name: c.name, Email: c.email, Phone: c.phone || "", College: c.college || "",
        Course: c.course || "", Branch: c.branch || "",
        "Rounds Qualified": c.roundsQualified, "Rounds Taken": c.roundsTaken,
        Status: "Finally Selected",
      })));
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, "Final Selection");
      XLSX.writeFile(wb, `Final_Selection_${(workspace?.name || "workspace").replace(/\s+/g, "_")}.xlsx`);
    } catch (e) { showToast({ type: "error", title: "Export failed", lines: [e.message] }); }
    finally { setExporting(false); }
  };

  if (loading && !rounds.length) return <Loading label="Loading results…" />;
  if (err) return <ErrorNote message={err} onRetry={load} />;

  return (
    <div>
      {toastEl}
      <div className="ad-page-title">Results</div>

      {rounds.length === 0 ? (
        <Empty icon="📊" title="No rounds configured yet"
          hint="Add rounds to this workspace and results will appear here as students take them." />
      ) : (
        <>
          <div className="ad-table-wrap">
            <table className="ad-table">
              <thead>
                <tr><th>#</th><th>Round</th><th>Status</th><th>Eligible</th><th>Attended</th><th>Qualified</th><th>Rejected</th><th>Cutoff</th></tr>
              </thead>
              <tbody>
                {rounds.map(r => (
                  <tr key={r._id}>
                    <td className="ad-td-num">{r.sequence}</td>
                    <td><strong>{r.name}</strong></td>
                    <td><StatusBadge value={r.status} /></td>
                    <td>{r.eligible}</td>
                    <td>{r.attended}</td>
                    <td style={{ color: "#16A34A", fontWeight: 700 }}>{r.qualified}</td>
                    <td style={{ color: "#DC2626", fontWeight: 700 }}>{r.rejected}</td>
                    <td className="ad-td-sm">
                      {r.cutoff?.method && r.cutoff.method !== "NONE"
                        ? (r.cutoff.method === "PERCENTAGE" ? `${r.cutoff.value}%`
                          : r.cutoff.method === "TOP_N" ? `Top ${r.cutoff.value}`
                          : r.cutoff.method === "MARKS" ? `${r.cutoff.value} marks` : "Manual")
                        : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="ad-section-head" style={{ marginTop: 26 }}>
            <div>
              <div className="ad-page-title" style={{ marginBottom: 4, fontSize: 16 }}>Final Selection</div>
              <div className="ws-hint">
                Students who qualified <strong>{finalRound?.name}</strong> — the last configured round
                {rounds.length > 1 ? ` of ${rounds.length}` : ""}. Each student appears once.
              </div>
            </div>
            <button className="ad-btn ad-btn--export" onClick={exportSelected} disabled={exporting || !selected.length}>
              {exporting ? <><Spinner />Exporting…</> : "⬇ Export Excel"}
            </button>
          </div>

          {selected.length === 0 ? (
            <Empty icon="🏆" title="No students finally selected yet"
              hint={`Students appear here once they qualify “${finalRound?.name || "the last round"}”.`} />
          ) : (
            <div className="ad-table-wrap">
              <table className="ad-table">
                <thead>
                  <tr><th>#</th><th>Student</th><th>Email</th><th>Phone</th><th>College</th><th>Course</th><th>Branch</th><th>Rounds</th><th>Status</th></tr>
                </thead>
                <tbody>
                  {selected.map((c, i) => (
                    <tr key={c._id}>
                      <td className="ad-td-num">{i + 1}</td>
                      <td><div className="ad-td-name"><div className="ad-avatar">{(c.name || "?").charAt(0)}</div>{c.name}</div></td>
                      <td className="ad-td-sm">{c.email}</td>
                      <td className="ad-td-sm">{c.phone || "—"}</td>
                      <td className="ad-td-sm">{c.college || "—"}</td>
                      <td className="ad-td-sm">{c.course || "—"}</td>
                      <td className="ad-td-sm">{c.branch || "—"}</td>
                      <td className="ad-td-sm">{c.roundsQualified}/{c.roundsTaken}</td>
                      <td><span className="ad-badge ad-badge--green">Selected</span></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </div>
  );
}
