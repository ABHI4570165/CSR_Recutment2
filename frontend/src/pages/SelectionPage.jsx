import React, { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { publicSelection } from "../utils/workspaceApi";
import "./SelectionPage.css";

/*
 * Public final-selection page.
 *
 * Everything on it is data: company name, logo, brand colours, drive name, role
 * and the selected candidates. Nothing is hardcoded. If the admin has not
 * published the page, the API returns 404 and we show a plain unavailable state
 * rather than leaking that the drive exists.
 */

export default function SelectionPage() {
  const { workspaceSlug, driveSlug } = useParams();
  const [data, setData] = useState(null);
  const [state, setState] = useState("loading");   // loading | ready | unavailable | error

  useEffect(() => {
    let alive = true;
    publicSelection(workspaceSlug, driveSlug)
      .then(d => { if (!alive) return; setData(d); setState("ready"); })
      .catch(e => { if (!alive) return; setState(e.status === 404 ? "unavailable" : "error"); });
    return () => { alive = false; };
  }, [workspaceSlug, driveSlug]);

  if (state === "loading") {
    return <div className="sel-state"><div className="sel-spin" aria-hidden="true" /><p>Loading…</p></div>;
  }
  if (state === "unavailable") {
    return (
      <div className="sel-state">
        <div className="sel-state-icon">🔒</div>
        <h1>Results are not published</h1>
        <p>This page is not available yet. Please check back later, or contact your assessment coordinator.</p>
      </div>
    );
  }
  if (state === "error") {
    return (
      <div className="sel-state">
        <div className="sel-state-icon">⚠️</div>
        <h1>Something went wrong</h1>
        <p>We could not load this page. Please refresh and try again.</p>
      </div>
    );
  }

  const { workspace, drive, candidates } = data;
  const primary = workspace?.branding?.primaryColor || "#4F46E5";
  const accent = workspace?.branding?.accentColor || "#0891B2";
  const company = workspace?.companyName || workspace?.name || "";

  return (
    <div className="sel-page" style={{ "--brand": primary, "--brand-2": accent }}>
      <div className="sel-glow" aria-hidden="true" />

      <header className="sel-head">
        <div className="sel-logo">
          {workspace?.logo?.url
            ? <img src={workspace.logo.url} alt={`${company} logo`} />
            : <span>{(company || "?").charAt(0)}</span>}
        </div>
        <div className="sel-company">{company}</div>
        {drive?.name && <div className="sel-drive">{drive.name}</div>}

        <h1 className="sel-title">Congratulations</h1>
        <p className="sel-sub">
          {candidates.length === 0
            ? "The final results will appear here soon."
            : <>The following {candidates.length === 1 ? "candidate has" : `${candidates.length} candidates have`} been selected
              {drive?.role ? <> for the role of <strong>{drive.role}</strong></> : null}.</>}
        </p>
      </header>

      {candidates.length > 0 && (
        <main className="sel-grid">
          {candidates.map((c, i) => (
            <article className="sel-card" key={`${c.name}-${i}`} style={{ animationDelay: `${Math.min(i * 60, 600)}ms` }}>
              <div className="sel-card-top">
                <div className="sel-avatar">{(c.name || "?").charAt(0)}</div>
                <div className="sel-badge">Selected</div>
              </div>
              <h2 className="sel-name">{c.name}</h2>
              <dl className="sel-meta">
                {c.college && <div><dt>College</dt><dd>{c.college}</dd></div>}
                {c.course && <div><dt>Course</dt><dd>{c.course}</dd></div>}
                {c.branch && <div><dt>Branch</dt><dd>{c.branch}</dd></div>}
                {c.role && <div><dt>Role</dt><dd>{c.role}</dd></div>}
              </dl>
            </article>
          ))}
        </main>
      )}

      <footer className="sel-foot">
        <p>{company}{workspace?.details?.location ? ` · ${workspace.details.location}` : ""}</p>
        {workspace?.details?.website && (
          <p><a href={workspace.details.website} target="_blank" rel="noreferrer">{workspace.details.website}</a></p>
        )}
      </footer>
    </div>
  );
}
