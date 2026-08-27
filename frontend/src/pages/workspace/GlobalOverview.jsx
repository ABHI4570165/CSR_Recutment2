import React, { useCallback, useEffect, useState } from "react";
import { fetchGlobalOverview, getAdminName } from "../../utils/workspaceApi";
import { Loading, ErrorNote, Empty, fmtDate } from "./ui";

/*
 * LEVEL 1 — GLOBAL ADMIN OVERVIEW.
 *
 * This screen is NOT a workspace. It has no workspaceId, shows totals across
 * every company, and lists the workspaces so the admin can explicitly open one.
 * Nothing here selects or creates a workspace on its own — a workspace exists
 * only because the admin pressed "Create Workspace", and one is opened only
 * because the admin pressed "Open Workspace".
 */

const greetingFor = (d = new Date()) => {
  const h = d.getHours();
  if (h < 12) return "Good morning";
  if (h < 17) return "Good afternoon";
  return "Good evening";
};

const initial = (s) => String(s || "?").trim().charAt(0).toUpperCase();

export default function GlobalOverview({ workspaces, loading, error, onReload, onOpen, onCreate, onEdit, readOnly }) {
  const [stats, setStats] = useState(null);
  const [statsErr, setStatsErr] = useState("");
  const name = getAdminName();

  const loadStats = useCallback(async () => {
    setStatsErr("");
    try { setStats(await fetchGlobalOverview()); }
    catch (e) { setStatsErr(e.message); }
  }, []);
  useEffect(() => { loadStats(); }, [loadStats, workspaces.length]);

  if (loading && !workspaces.length && !stats) return <Loading label="Loading your workspaces…" />;

  return (
    <div>
      {/* ── Greeting ─────────────────────────────────────────────────────── */}
      <header className="ws-hero">
        <h1 className="ws-hero-title">
          {greetingFor()}{name ? <>, {name}</> : ""}
        </h1>
        <p className="ws-hero-sub">Manage all your recruitment workspaces from one place.</p>
      </header>

      {error && <ErrorNote message={error} onRetry={onReload} />}
      {statsErr && <ErrorNote message={statsErr} onRetry={loadStats} />}

      {/* ── The ONLY statistic that belongs at the global level ───────────
          Everything about students, candidates, applications, drives, rounds,
          questions, cutoffs, scores and results lives INSIDE a workspace. */}
      <div className="ws-global-stat">
        <div className="ws-global-stat-label">Total Workspaces</div>
        <div className="ws-global-stat-value">{stats?.totalWorkspaces ?? workspaces.length}</div>
        <div className="ws-global-stat-sub">{workspaces.length === 1 ? "company" : "companies"} you manage</div>
      </div>

      {/* ── Workspace list ───────────────────────────────────────────────── */}
      <div className="ad-section-head" style={{ marginTop: 28 }}>
        <div className="ad-page-title" style={{ marginBottom: 0 }}>
          Recruitment Workspaces
          <span style={{ fontSize: 12, fontWeight: 500, color: "var(--text-3)", marginLeft: 10 }}>
            {workspaces.length} {workspaces.length === 1 ? "company" : "companies"}
          </span>
        </div>
        {!readOnly && <button className="ad-btn ad-btn--primary" onClick={onCreate}>＋ Create Workspace</button>}
      </div>

      {workspaces.length === 0 ? (
        <Empty icon="🏢" title="No workspaces yet"
          hint="A workspace is one company. Create your first one to start running recruitment drives for it."
          action={!readOnly && <button className="ad-btn ad-btn--primary" onClick={onCreate}>＋ Create Workspace</button>} />
      ) : (
        <div className="ws-grid">
          {workspaces.map(w => (
            <article className="ws-card" key={w._id}>
              <div className="ws-card-top">
                <div className="ws-card-logo">
                  {w.logo?.url
                    ? <img src={w.logo.url} alt="" />
                    : <span>{initial(w.name)}</span>}
                </div>
                <span className={`ad-badge ${w.isActive === false ? "ad-badge--gray" : "ad-badge--green"}`}>
                  {w.isActive === false ? "Inactive" : "Active"}
                </span>
              </div>

              <h3 className="ws-card-name">{w.name}</h3>
              {w.companyName && w.companyName !== w.name && <div className="ws-card-company">{w.companyName}</div>}

              {/* No recruitment numbers here by design — open the workspace to
                  see its drives, candidates and results. */}
              <div className="ws-card-meta">Created {fmtDate(w.createdAt)}</div>

              <div className="ws-card-actions">
                <button className="ad-btn ad-btn--primary" onClick={() => onOpen(w._id)}>Open Workspace</button>
                {!readOnly && onEdit && (
                  <button className="ad-btn ad-btn--outline" onClick={() => onEdit(w._id)} title="Open settings for this workspace">
                    Settings
                  </button>
                )}
              </div>
            </article>
          ))}
        </div>
      )}
    </div>
  );
}
