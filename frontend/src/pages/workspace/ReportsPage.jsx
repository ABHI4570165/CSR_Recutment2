import React, { useCallback, useEffect, useState } from "react";
import {
  ollamaStatus, listReportColleges, fetchReport,
  generateCompanyReport, generateCollegeReport,
} from "../../utils/workspaceApi";
import { Loading, Empty, ErrorNote, Spinner, useToast, fmtDateTime } from "./ui";

/*
 * REPORTS — AI analysis of THIS workspace's recruitment data.
 *
 * Every figure in a report is computed by the backend; the local Ollama model
 * only interprets that evidence. Nothing is generated until the admin presses
 * Generate — in particular, college reports are never produced in bulk.
 */

const STAGES = [
  "Collecting recruitment data…",
  "Analysing student answers…",
  "Generating AI insights…",
  "Preparing final report…",
];

export default function ReportsPage({ workspace }) {
  const [tab, setTab] = useState("company");
  const [status, setStatus] = useState(null);
  const { showToast, toastEl } = useToast();

  useEffect(() => { ollamaStatus().then(setStatus).catch(() => setStatus({ ok: false })); }, []);

  return (
    <div>
      {toastEl}
      <div className="ad-section-head">
        <div>
          <div className="ad-page-title" style={{ marginBottom: 4 }}>Reports</div>
          <div className="ws-hint">
            AI analysis of {workspace?.name || "this workspace"}'s recruitment data — answers, questions,
            rounds and progression. Generated locally; nothing leaves this machine.
          </div>
        </div>
        {status && (
          <span className={`ad-badge ${status.ok ? "ad-badge--green" : "ad-badge--red"}`}>
            {status.ok ? `Ollama ready · ${status.model}` : "Ollama unavailable"}
          </span>
        )}
      </div>

      {status && !status.ok && (
        <ErrorNote message={status.message || "Ollama is not reachable. Start it and reload this page."} />
      )}

      <div className="ws-sub-tabs">
        <button className={`ws-sub-tab ${tab === "company" ? "ws-sub-tab--active" : ""}`} onClick={() => setTab("company")}>
          🏢 Company Report
        </button>
        <button className={`ws-sub-tab ${tab === "college" ? "ws-sub-tab--active" : ""}`} onClick={() => setTab("college")}>
          🎓 College Reports
        </button>
      </div>

      {tab === "company"
        ? <CompanyReport workspace={workspace} showToast={showToast} disabled={status && !status.ok} />
        : <CollegeReports showToast={showToast} disabled={status && !status.ok} />}
    </div>
  );
}

/* ── Company report ───────────────────────────────────────────────────────── */
function CompanyReport({ workspace, showToast, disabled }) {
  const [report, setReport] = useState(undefined);   // undefined = loading
  const [busy, setBusy] = useState(false);
  const [stage, setStage] = useState(0);

  const load = useCallback(() => {
    fetchReport({ type: "COMPANY" }).then(r => setReport(r)).catch(() => setReport(null));
  }, []);
  useEffect(() => { load(); }, [load]);

  const run = async () => {
    setBusy(true); setStage(0);
    const tick = setInterval(() => setStage(s => Math.min(s + 1, STAGES.length - 1)), 9000);
    try {
      setReport(await generateCompanyReport());
      showToast({ title: "Company report generated" });
    } catch (e) { showToast({ type: "error", title: "Generation failed", lines: [e.message] }); }
    finally { clearInterval(tick); setBusy(false); }
  };

  if (report === undefined) return <Loading label="Loading report…" />;

  return (
    <div>
      <div className="ad-card-section">
        <div className="ad-card-section-title">🏢 {workspace?.name || "Company"}</div>
        <div className="ws-hint" style={{ marginBottom: 12 }}>
          One report covering every candidate in this workspace, across all rounds and drives.
        </div>
        {report
          ? <ReportMeta r={report} />
          : <div className="ws-hint">No report generated yet.</div>}
        <div style={{ marginTop: 14 }}>
          <button className="ad-btn ad-btn--primary" onClick={run} disabled={busy || disabled}>
            {busy ? <><Spinner />{STAGES[stage]}</> : report ? "Regenerate Report" : "Generate Company Report"}
          </button>
        </div>
      </div>
      {report && <ReportView report={report} />}
    </div>
  );
}

/* ── College reports — the admin picks; nothing is generated in bulk ─────── */
function CollegeReports({ showToast, disabled }) {
  const [rows, setRows] = useState(null);
  const [err, setErr] = useState("");
  const [search, setSearch] = useState("");
  const [busyCollege, setBusyCollege] = useState(null);
  const [stage, setStage] = useState(0);
  const [open, setOpen] = useState(null);

  const load = useCallback(() => {
    listReportColleges().then(setRows).catch(e => { setErr(e.message); setRows([]); });
  }, []);
  useEffect(() => { load(); }, [load]);

  const run = async (college) => {
    setBusyCollege(college); setStage(0);
    const tick = setInterval(() => setStage(s => Math.min(s + 1, STAGES.length - 1)), 9000);
    try {
      const r = await generateCollegeReport(college);
      setOpen(r); load();
      showToast({ title: `Report generated for ${college}` });
    } catch (e) { showToast({ type: "error", title: "Generation failed", lines: [e.message] }); }
    finally { clearInterval(tick); setBusyCollege(null); }
  };

  const view = async (college) => {
    try { const r = await fetchReport({ type: "COLLEGE", college }); if (r) setOpen(r); }
    catch (e) { showToast({ type: "error", title: "Could not open report", lines: [e.message] }); }
  };

  if (rows === null) return <Loading label="Loading colleges…" />;
  if (open) return (
    <div>
      <div className="ws-crumb"><button onClick={() => setOpen(null)}>← Back to colleges</button><span>/</span><span>{open.college}</span></div>
      <ReportMeta r={open} />
      <ReportView report={open} />
    </div>
  );

  const filtered = rows.filter(c => !search || (c.college || "").toLowerCase().includes(search.toLowerCase()));

  return (
    <div>
      {err && <ErrorNote message={err} onRetry={load} />}
      <div className="ad-toolbar">
        <input className="ad-search" placeholder="Search college…" value={search} onChange={e => setSearch(e.target.value)} />
        <span className="ws-hint">{rows.length} colleges in this workspace · reports are generated one at a time, on request</span>
      </div>

      {filtered.length === 0 ? <Empty icon="🎓" title="No colleges found" hint="Colleges appear once candidates with a college are in this workspace." />
        : (
          <div className="ad-table-wrap">
            <table className="ad-table">
              <thead><tr><th>#</th><th>College</th><th>Students</th><th>Participations</th><th>Attended</th><th>Qualified</th><th>Last Generated</th><th></th></tr></thead>
              <tbody>
                {filtered.map((c, i) => (
                  <tr key={c.college}>
                    <td className="ad-td-num">{i + 1}</td>
                    <td><strong>{c.college}</strong></td>
                    <td>{c.students}</td>
                    <td>{c.participations}</td>
                    <td>{c.attended}</td>
                    <td style={{ color: "#16A34A", fontWeight: 700 }}>{c.qualified}</td>
                    <td className="ad-td-sm">{c.lastGenerated ? fmtDateTime(c.lastGenerated) : "—"}</td>
                    <td style={{ display: "flex", gap: 6 }}>
                      {c.lastGenerated && <button className="ad-btn ad-btn--sm ad-btn--outline" onClick={() => view(c.college)}>View</button>}
                      <button className="ad-btn ad-btn--sm ad-btn--primary" onClick={() => run(c.college)}
                        disabled={!!busyCollege || disabled}>
                        {busyCollege === c.college ? <><Spinner />{STAGES[stage]}</> : c.lastGenerated ? "Regenerate" : "Generate Report"}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
    </div>
  );
}

/* ── Shared presentation ──────────────────────────────────────────────────── */
const ReportMeta = ({ r }) => {
  const s = r.stats || {};
  return (
    <div className="ws-stat-strip" style={{ marginTop: 4 }}>
      <div className="ws-stat"><div className="ws-stat-val">{s.uniqueStudents ?? "—"}</div><div className="ws-stat-lbl">Unique students</div></div>
      <div className="ws-stat"><div className="ws-stat-val">{s.participations ?? "—"}</div><div className="ws-stat-lbl">Round participations</div></div>
      <div className="ws-stat"><div className="ws-stat-val">{s.answers?.rowsAnalysed ?? "—"}</div><div className="ws-stat-lbl">Answers analysed</div></div>
      <div className="ws-stat"><div className="ws-stat-val" style={{ color: "#16A34A" }}>{s.qualified ?? "—"}</div><div className="ws-stat-lbl">Qualified</div></div>
      <div className="ws-stat"><div className="ws-stat-val">{s.answers?.accuracyPct != null ? `${s.answers.accuracyPct}%` : "—"}</div><div className="ws-stat-lbl">Answer accuracy</div></div>
      <div className="ws-stat"><div className="ws-stat-val" style={{ fontSize: 13 }}>{r.generatedAt ? fmtDateTime(r.generatedAt) : "—"}</div><div className="ws-stat-lbl">Generated · {r.model || ""}</div></div>
    </div>
  );
};

// Minimal, dependency-free markdown rendering (headings, bullets, bold).
function ReportView({ report }) {
  const html = String(report.content || "")
    .replace(/&/g, "&amp;").replace(/</g, "&lt;")
    .replace(/^### (.*)$/gm, '<h3 class="rep-h3">$1</h3>')
    .replace(/^## (.*)$/gm, '<h2 class="rep-h2">$1</h2>')
    .replace(/^# (.*)$/gm, '<h1 class="rep-h1">$1</h1>')
    .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
    .replace(/^[-*] (.*)$/gm, '<li class="rep-li">$1</li>')
    .replace(/^\d+\. (.*)$/gm, '<li class="rep-li">$1</li>')
    .split(/\n{2,}/).map(b => (/^<(h1|h2|h3|li)/.test(b.trim()) ? b : `<p class="rep-p">${b.replace(/\n/g, "<br/>")}</p>`)).join("\n");

  return (
    <div className="ad-card-section rep-body">
      <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginBottom: 8 }}>
        <button className="ad-btn ad-btn--sm ad-btn--primary" onClick={() => {
          // Browser print-to-PDF: no extra dependency, and the page keeps its
          // fonts and layout. The document title becomes the suggested filename.
          const prev = document.title;
          document.title = `${report.reportType === "COLLEGE" ? report.college : "Company"} Report`
            .replace(/[\/:*?"<>|]/g, "-");
          window.print();
          setTimeout(() => { document.title = prev; }, 800);
        }}>⬇ Download PDF</button>
      </div>
      <div dangerouslySetInnerHTML={{ __html: html }} />
      {(report.stats?.limitations || []).length > 0 && (
        <div className="ws-hint" style={{ marginTop: 18, borderTop: "1px solid var(--border)", paddingTop: 12 }}>
          <strong>Data limitations:</strong>
          <ul>{report.stats.limitations.map((l, i) => <li key={i}>{l}</li>)}</ul>
        </div>
      )}
    </div>
  );
}
