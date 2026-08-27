import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { listWorkspaces, setActiveWorkspace } from "../../utils/workspaceApi";
import { Loading, ErrorNote } from "./ui";
import WorkspaceSwitcher, { NewWorkspaceModal } from "./WorkspaceSwitcher";
import GlobalOverview from "./GlobalOverview";
import WorkspaceHome from "./WorkspaceHome";
import WorkspaceSettings from "./WorkspaceSettings";
import RoundsPage from "./RoundsPage";
import ResultsPage from "./ResultsPage";
import ReportsPage from "./ReportsPage";
import CandidatesPage from "./CandidatesPage";
import "./workspace.css";

/*
 * TWO LEVELS, NEVER CONFUSED.
 *
 *   LEVEL 1 — GLOBAL OVERVIEW   activeId === ""   no workspaceId, all companies
 *   LEVEL 2 — ONE WORKSPACE     activeId set      exactly one company's data
 *
 * The admin always lands on Level 1. A workspace is entered ONLY by pressing
 * "Open Workspace", and left by pressing "← All Workspaces". Nothing here
 * selects a workspace for the admin: there is no first-workspace fallback and
 * no restore-on-load, so a fresh login can never begin inside a company.
 */

const Ctx = createContext(null);
export const useWorkspace = () => useContext(Ctx);

export function WorkspaceProvider({ children }) {
  const [workspaces, setWorkspaces] = useState([]);
  // ALWAYS starts empty — Level 1. Never seeded from storage or from the list.
  const [activeId, setActiveId] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  // Any workspace id left in storage by an earlier session is cleared, so the
  // API client cannot send a stale workspace header before one is chosen.
  useEffect(() => { setActiveWorkspace(""); }, []);

  const load = useCallback(async () => {
    setLoading(true);
    try { setWorkspaces(await listWorkspaces() || []); setError(""); }
    catch (e) { setError(e.message); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { load(); }, [load]);

  // Entering a workspace is always an explicit act.
  const openWorkspace = useCallback((id) => {
    if (!id) return;
    setActiveWorkspace(String(id));
    setActiveId(String(id));
  }, []);

  // Leaving returns to the global level and drops the workspace context.
  const leaveWorkspace = useCallback(() => {
    setActiveWorkspace("");
    setActiveId("");
  }, []);

  const value = useMemo(() => ({
    workspaces, activeId, loading, error,
    workspace: activeId ? (workspaces.find(w => String(w._id) === String(activeId)) || null) : null,
    openWorkspace, leaveWorkspace, reload: load,
    updateLocal: (w) => setWorkspaces(list => list.map(x => (String(x._id) === String(w._id) ? { ...x, ...w } : x))),
  }), [workspaces, activeId, loading, error, openWorkspace, leaveWorkspace, load]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

/* Switcher for the admin top bar. Shows "Select Workspace" at Level 1. */
export function WorkspaceSwitcherSlot({ readOnly }) {
  const ws = useWorkspace();
  if (!ws || ws.loading) return null;
  return (
    <WorkspaceSwitcher
      workspaces={ws.workspaces}
      activeId={ws.activeId}
      canCreate={!readOnly}
      onSwitch={ws.openWorkspace}
      onBackToOverview={ws.leaveWorkspace}
      onCreated={(w) => { ws.reload(); ws.openWorkspace(w._id); }}
    />
  );
}

export default function WorkspaceModule({ readOnly, section = "overview" }) {
  const ws = useWorkspace();
  const [creating, setCreating] = useState(false);

  if (!ws) return null;

  /* ── LEVEL 1 — GLOBAL OVERVIEW ─────────────────────────────────────────── */
  if (!ws.activeId) {
    return (
      <>
        <GlobalOverview
          workspaces={ws.workspaces}
          loading={ws.loading}
          error={ws.error}
          readOnly={readOnly}
          onReload={ws.reload}
          onCreate={() => setCreating(true)}
          onOpen={(id) => ws.openWorkspace(id)}
          onEdit={(id) => ws.openWorkspace(id)}
        />
        {creating && (
          <NewWorkspaceModal
            onClose={() => setCreating(false)}
            onCreated={(w) => {
              setCreating(false);
              // A new workspace is empty: no round, no student, no recruitment
              // container is created with it. The admin decides what to add.
              ws.reload();
              ws.openWorkspace(w._id);
            }}
          />
        )}
      </>
    );
  }

  /* ── LEVEL 2 — ONE WORKSPACE ───────────────────────────────────────────── */
  if (ws.loading && !ws.workspace) return <Loading label="Opening workspace…" />;
  if (ws.error) return <ErrorNote message={ws.error} onRetry={ws.reload} />;

  const company = ws.workspace;

  return (
    <div>
      <div className="ws-crumb">
        <button onClick={ws.leaveWorkspace}>← All Workspaces</button>
        <span>/</span>
        <span>{company?.name || "Workspace"}</span>
      </div>

      <div className="ws-ws-head">
        <div className="ws-ws-logo">
          {company?.logo?.url
            ? <img src={company.logo.url} alt="" />
            : <span>{String(company?.name || "?").charAt(0).toUpperCase()}</span>}
        </div>
        <div style={{ minWidth: 0 }}>
          <div className="ws-ws-name">{company?.name || "Workspace"}</div>
          <div className="ws-ws-sub">
            {company?.companyName && company.companyName !== company.name ? `${company.companyName} · ` : ""}
            Recruitment workspace
          </div>
        </div>
      </div>

      {/* key = activeId → switching company fully remounts these screens, so no
          data from the previous workspace can survive on the page.
          Navigation lives in the tab bar above; there is no drive layer. */}
      <div key={ws.activeId}>
        {section === "overview" && <WorkspaceHome workspace={company} />}
        {section === "students" && <CandidatesPage />}
        {section === "rounds"   && <RoundsPage readOnly={readOnly} />}
        {section === "results"  && <ResultsPage workspace={company} readOnly={readOnly} />}
        {section === "reports"  && <ReportsPage workspace={company} />}
        {section === "settings" && <WorkspaceSettings workspace={company} readOnly={readOnly} onSaved={(w) => ws.updateLocal(w)} />}
      </div>
    </div>
  );
}
