import { useEffect, useRef, useState } from "react";

// Expanded student view. Requests HIGH quality while open, shows live details,
// and can terminate the assessment (reuses the existing REST terminate flow).
export default function StudentModal({ student, stream, onClose, watch, unwatch, onTerminate }) {
  const videoRef = useRef(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    watch(student.candidateId, "high");                 // bump quality while expanded
    return () => watch(student.candidateId, "low");      // back to low on close (still visible in grid)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [student.candidateId]);

  useEffect(() => {
    if (videoRef.current) videoRef.current.srcObject = stream || null;
    if (stream && videoRef.current) videoRef.current.play?.().catch(() => {});
  }, [stream]);

  const elapsed = student.startedAt ? Math.floor((Date.now() - student.startedAt) / 60000) : 0;

  const terminate = async () => {
    if (!window.confirm(`Terminate ${student.name}'s test? Their answers are saved; the assessment cannot be resumed.`)) return;
    setBusy(true);
    try { await onTerminate(student.candidateId); onClose(); }
    finally { setBusy(false); }
  };

  return (
    <div className="lp-modal-overlay" onClick={onClose}>
      <div className="lp-modal" onClick={(e) => e.stopPropagation()}>
        <button className="lp-modal-x" onClick={onClose}>✕</button>
        <div className="lp-modal-grid">
          <div className="lp-modal-video">
            {stream ? <video ref={videoRef} autoPlay playsInline muted /> : <div className="lp-card-novideo">Connecting…</div>}
            <span className={`lp-live ${stream ? "lp-live--on" : ""}`}>● LIVE</span>
          </div>
          <div className="lp-modal-info">
            <h3>{student.name}</h3>
            <p className="lp-modal-college">{student.college}</p>
            <div className="lp-modal-facts">
              <div><span>Test</span><strong>{student.testName}</strong></div>
              <div><span>Connection</span><strong>{stream ? "Connected" : "Waiting"}</strong></div>
              <div><span>Camera</span><strong>{student.cameraOn ? "On" : "Off"}</strong></div>
              <div><span>Current question</span><strong>Q{(student.currentQuestion || 0) + 1}</strong></div>
              <div><span>Elapsed</span><strong>{elapsed} min</strong></div>
              <div><span>Violations</span><strong className={student.violations ? "lp-warn" : ""}>{student.violations || 0}</strong></div>
            </div>
            <button className="lp-terminate" disabled={busy} onClick={terminate}>
              {busy ? "Terminating…" : "⛔ Terminate Test"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
