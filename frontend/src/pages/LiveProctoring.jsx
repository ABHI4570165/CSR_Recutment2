import { useMemo, useState } from "react";
import { useAdminProctor } from "../webrtc/useAdminProctor";
import StudentCard from "../components/proctoring/StudentCard";
import StudentModal from "../components/proctoring/StudentModal";
import { terminateCandidate } from "../utils/api";
import "./LiveProctoring.css";

export default function LiveProctoring() {
  const adminToken = localStorage.getItem("adminToken") || "";
  const { status, students, streams, watch, unwatch } = useAdminProctor(adminToken);
  const [q, setQ] = useState("");
  const [filter, setFilter] = useState("all");   // all | camoff | violations
  const [expanded, setExpanded] = useState(null); // candidateId

  const filtered = useMemo(() => {
    const term = q.trim().toLowerCase();
    return students
      .filter((s) => (filter === "camoff" ? !s.cameraOn : filter === "violations" ? (s.violations || 0) > 0 : true))
      .filter((s) => !term || `${s.name} ${s.college} ${s.testName}`.toLowerCase().includes(term))
      .sort((a, b) => (b.violations || 0) - (a.violations || 0));
  }, [students, q, filter]);

  const expandedStudent = students.find((s) => s.candidateId === expanded) || null;

  const onTerminate = async (candidateId) => {
    await terminateCandidate(candidateId);   // existing REST flow; student page ends on next auto-save
  };

  if (!adminToken) return <div className="lp-guard">Admin sign-in required. Open the admin dashboard first.</div>;

  const counts = {
    all: students.length,
    camoff: students.filter((s) => !s.cameraOn).length,
    violations: students.filter((s) => (s.violations || 0) > 0).length,
  };

  return (
    <div className="lp-page">
      <header className="lp-head">
        <div>
          <h1>🎥 Live Proctoring</h1>
          <span className={`lp-status lp-status--${status}`}>
            {status === "online" ? "● Connected" : status === "error" ? "● Signaling unavailable" : "● Connecting…"}
            {" · "}{students.length} live
          </span>
        </div>
        <input className="lp-search" placeholder="Search student, college, test…" value={q} onChange={(e) => setQ(e.target.value)} />
      </header>

      <div className="lp-filters">
        {[["all", "Running"], ["camoff", "Camera Off"], ["violations", "Violations"]].map(([k, label]) => (
          <button key={k} className={`lp-filter ${filter === k ? "lp-filter--on" : ""}`} onClick={() => setFilter(k)}>
            {label} <span>({counts[k]})</span>
          </button>
        ))}
      </div>

      {filtered.length === 0 ? (
        <div className="lp-empty">
          {status === "error" ? "Cannot reach the signaling server. Check VITE_SIGNALING_URL and that the instance is awake."
            : students.length === 0 ? "No students are currently taking a test."
            : "No students match this filter."}
        </div>
      ) : (
        <div className="lp-grid">
          {filtered.map((s) => (
            <StudentCard key={s.candidateId} student={s} stream={streams.get(s.candidateId)}
              onExpand={() => setExpanded(s.candidateId)} watch={watch} unwatch={unwatch} />
          ))}
        </div>
      )}

      {expandedStudent && (
        <StudentModal student={expandedStudent} stream={streams.get(expandedStudent.candidateId)}
          onClose={() => setExpanded(null)} watch={watch} unwatch={unwatch} onTerminate={onTerminate} />
      )}
    </div>
  );
}
