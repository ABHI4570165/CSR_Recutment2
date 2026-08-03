import { useEffect, useRef } from "react";

// A single student tile. Establishes a live stream ONLY while visible on screen
// (IntersectionObserver) so 100+ students don't open 100 videos at once.
export default function StudentCard({ student, stream, onExpand, watch, unwatch }) {
  const videoRef = useRef(null);
  const cardRef = useRef(null);

  useEffect(() => {
    if (videoRef.current) videoRef.current.srcObject = stream || null;
    if (stream && videoRef.current) videoRef.current.play?.().catch(() => {});
  }, [stream]);

  useEffect(() => {
    const el = cardRef.current;
    if (!el) return;
    const obs = new IntersectionObserver(
      (entries) => entries.forEach((e) => (e.isIntersecting ? watch(student.candidateId, "low") : unwatch(student.candidateId))),
      { threshold: 0.2 }
    );
    obs.observe(el);
    return () => { obs.disconnect(); unwatch(student.candidateId); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [student.candidateId]);

  const elapsed = student.startedAt ? Math.floor((Date.now() - student.startedAt) / 60000) : 0;
  const violated = (student.violations || 0) > 0;

  return (
    <div ref={cardRef} className="lp-card">
      <div className="lp-card-video">
        {stream ? <video ref={videoRef} autoPlay playsInline muted /> : (
          <div className="lp-card-novideo">{student.cameraOn ? "Connecting…" : "📷 Camera off"}</div>
        )}
        <span className={`lp-live ${stream ? "lp-live--on" : ""}`}>● LIVE</span>
        {violated && <span className="lp-viol">⚠ {student.violations}</span>}
      </div>
      <div className="lp-card-body">
        <div className="lp-card-name" title={student.name}>{student.name}</div>
        <div className="lp-card-sub">{student.college}</div>
        <div className="lp-card-meta">
          <span className="lp-chip">{student.testName}</span>
          <span className={`lp-dot ${stream ? "lp-dot--ok" : "lp-dot--wait"}`} title="Connection">{stream ? "Connected" : "Waiting"}</span>
        </div>
        <div className="lp-card-row">
          <span title="Camera">{student.cameraOn ? "🟢 Cam" : "🔴 Cam"}</span>
          <span title="Elapsed">⏱ {elapsed}m</span>
          <span title="Question">Q{(student.currentQuestion || 0) + 1}</span>
          <button className="lp-expand" onClick={() => onExpand(student)}>Expand ⤢</button>
        </div>
      </div>
    </div>
  );
}
