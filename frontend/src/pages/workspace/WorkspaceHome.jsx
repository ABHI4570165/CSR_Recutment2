import React, { useCallback, useEffect, useState } from "react";
import { fetchWsDashboard } from "../../utils/workspaceApi";
import { Kpi, Loading, Empty, ErrorNote, StatusBadge } from "./ui";

/*
 * WORKSPACE OVERVIEW — recruitment statistics for THIS company only.
 *
 * A workspace runs one recruitment process, so the shape here is students and
 * rounds. There is no drive count, no drive filter and no drive concept: the
 * round rows come from whatever rounds the admin configured, in sequence.
 */

export default function WorkspaceHome({ workspace, onOpenRounds }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");

  const load = useCallback(async () => {
    setLoading(true); setErr("");
    try { setData(await fetchWsDashboard()); }
    catch (e) { setErr(e.message); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  if (loading && !data) return <Loading label="Loading workspace overview…" />;
  if (err) return <ErrorNote message={err} onRetry={load} />;
  if (!data) return null;

  const t = data.totals || {};
  const rounds = data.rounds || [];

  return (
    <div>
      <div className="ad-page-title">{workspace?.name || "Workspace"} — Recruitment Overview</div>

      <div className="ad-kpi-grid">
        <Kpi label="Total Students"   value={t.students ?? 0}        icon="👥" color="#06B6D4" sub="unique people" />
        <Kpi label="Total Rounds"     value={t.rounds ?? 0}          icon="🪜" color="#6366F1" sub="stages configured" />
        <Kpi label="Qualified"        value={t.qualified ?? 0}       icon="✅" color="#16A34A" sub="cleared a round" />
        <Kpi label="Rejected"         value={t.rejected ?? 0}        icon="⛔" color="#DC2626" sub="did not clear" />
        <Kpi label="Pending"          value={t.pending ?? 0}         icon="⏳" color="#D97706" sub="in progress" />
        <Kpi label="Finally Selected" value={t.finallySelected ?? 0} icon="🏆" color="#7C3AED" sub="cleared the last round" />
      </div>

      <div className="ad-page-title" style={{ marginTop: 26, fontSize: 16 }}>Round Statistics</div>
      {rounds.length === 0 ? (
        <Empty icon="🪜" title="No rounds configured yet"
          hint="Add the first round to start this company's recruitment process."
          action={onOpenRounds && <button className="ad-btn ad-btn--primary" onClick={onOpenRounds}>Go to Rounds</button>} />
      ) : (
        <div className="ad-table-wrap">
          <table className="ad-table">
            <thead>
              <tr>
                <th>#</th><th>Round</th><th>Type</th><th>Status</th>
                <th>Eligible</th><th>Attended</th><th>Completed</th>
                <th>Qualified</th><th>Rejected</th><th>Not Attempted</th>
              </tr>
            </thead>
            <tbody>
              {rounds.map(r => (
                <tr key={r.roundId}>
                  <td className="ad-td-num">{r.sequence}</td>
                  <td><strong>{r.name}</strong></td>
                  <td className="ad-td-sm">{String(r.roundType || "").replace(/_/g, " ")}</td>
                  <td><StatusBadge value={r.status} /></td>
                  <td>{r.eligible}</td>
                  <td>{r.started + r.completed}</td>
                  <td>{r.completed}</td>
                  <td style={{ color: "#16A34A", fontWeight: 700 }}>{r.qualified}</td>
                  <td style={{ color: "#DC2626", fontWeight: 700 }}>{r.rejected}</td>
                  <td className="ad-td-sm">{r.notAttempted}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
