import React, { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { useParams } from "react-router-dom";
import { getCandidate, startCandidate, saveCandidate, submitCandidate } from "../utils/api";
import { loadFaceDetector, detectFaceCount, FACE_MESSAGES } from "../utils/faceDetection";
import "./QuizPage.css";
import "./AssessmentPage.css";

const fmtTime = (s) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
const OPTS = ["A", "B", "C", "D"];
const MAX_VIOLATIONS = 3; // violations 1 & 2 warn; the 3rd disqualifies immediately

/* ── Fullscreen helpers ──────────────────────────────────────────────────────── */
function requestFullscreen() {
  const el = document.documentElement;
  const fn = el.requestFullscreen || el.webkitRequestFullscreen || el.mozRequestFullScreen || el.msRequestFullscreen;
  if (!fn) return Promise.reject(new Error("unsupported"));
  try { const r = fn.call(el); return r && r.then ? r : Promise.resolve(); }
  catch (e) { return Promise.reject(e); }
}
function exitFullscreen() {
  const fn = document.exitFullscreen || document.webkitExitFullscreen || document.mozCancelFullScreen || document.msExitFullscreen;
  if (fn && (document.fullscreenElement || document.webkitFullscreenElement)) { try { fn.call(document); } catch { /* ignore */ } }
}
function isFullscreen() {
  return !!(document.fullscreenElement || document.webkitFullscreenElement || document.mozFullScreenElement || document.msFullscreenElement);
}

/* ── Pre-assessment rules ────────────────────────────────────────────────────── */
const RULES = [
  ["📷", "Keep your face visible throughout the assessment."],
  ["🗂️", "Do not switch tabs or applications."],
  ["🖥️", "Do not exit fullscreen mode."],
  ["📵", "No mobile phones, calculators, books, notes, or external assistance."],
  ["🤐", "Do not communicate with anyone during the assessment."],
  ["🌐", "Ensure stable internet connectivity."],
  ["🔋", "Ensure your device battery is sufficiently charged."],
  ["⏱️", "The assessment timer continues even if the page is refreshed."],
  ["⚠️", "Excessive violations may result in disqualification."],
  ["🎥", "Camera preview will remain active during the assessment."],
  ["✅", "The assessment can only be submitted once."],
  ["🛡️", "Any suspicious activity may lead to rejection."],
];

/* ── Status screens ──────────────────────────────────────────────────────────── */
function BrandLogo({ className }) {
  return <img src="/logo.png" alt="M H Foundation" className={className}
    onError={(e) => { e.currentTarget.style.display = "none"; }} />;
}

function CenterCard({ icon, title, message, children }) {
  return (
    <div className="asmt-center">
      <div className="asmt-center-card">
        <BrandLogo className="asmt-center-logo" />
        {icon && <div className="asmt-center-icon">{icon}</div>}
        <h1 className="asmt-center-title">{title}</h1>
        {message && <p className="asmt-center-msg">{message}</p>}
        {children}
      </div>
    </div>
  );
}

function ViolationModal({ count, max = MAX_VIOLATIONS, reason, onDismiss }) {
  const sub = reason === "multipleFaces"
    ? "More than one person was detected in your camera. Only the candidate may be visible during the assessment."
    : "You exited fullscreen, switched tabs, or left the window. This assessment must be taken in fullscreen.";
  const remaining = Math.max(0, max - count);
  return (
    <div className="qp-viol-overlay">
      <div className="qp-viol-modal">
        <div className="qp-viol-icon-wrap">{reason === "multipleFaces" ? "👥" : "⚠️"}</div>
        <h2 className="qp-viol-title">Warning {count} of {max}</h2>
        <p className="qp-viol-sub">{sub}</p>
        <div className="qp-viol-count"><span className="qp-viol-num">{count}</span><span className="qp-viol-of">/ {max}</span></div>
        <div className="qp-viol-dots">
          {Array.from({ length: max }).map((_, i) => (
            <div key={i} className={`qp-viol-dot ${i < count ? "qp-viol-dot--filled" : ""}`} />
          ))}
        </div>
        <p className="qp-viol-warn">
          {remaining === 1
            ? "⚠ One more violation will DISQUALIFY you and terminate your assessment."
            : `${remaining} more violations will disqualify you.`}
        </p>
        <button className="qp-viol-btn" onClick={onDismiss}>Return to Fullscreen</button>
      </div>
    </div>
  );
}

// Rules modal (shown during the assessment via "View Rules")
function RulesModal({ onClose }) {
  return (
    <div className="qp-overlay" onClick={onClose}>
      <div className="asmt-rules-card" style={{ maxWidth: 640, maxHeight: "85vh", overflowY: "auto" }} onClick={e => e.stopPropagation()}>
        <div className="asmt-rules-head">
          <span className="asmt-rules-icon">⚠️</span>
          <div><h1 className="asmt-rules-title">Assessment Rules</h1></div>
        </div>
        <ul className="asmt-rules-list">
          {RULES.map(([icon, text]) => (
            <li key={text} className="asmt-rule"><span className="asmt-rule-icon">{icon}</span><span>{text}</span></li>
          ))}
        </ul>
        <button className="asmt-start-btn" onClick={onClose}>Close</button>
      </div>
    </div>
  );
}

// Block phones/tablets — proctored assessment requires a desktop/laptop browser.
function isMobileDevice() {
  const ua = navigator.userAgent || "";
  // Block only genuine phones/tablets by user-agent. Do NOT use screen size or
  // touch — many laptops have small resolutions and/or touchscreens, and were
  // wrongly blocked. A laptop/desktop always reports a desktop UA.
  const mobileUA = /Android|webOS|iPhone|iPod|BlackBerry|IEMobile|Opera Mini|Mobile|Silk|Kindle|PlayBook/i.test(ua)
    || /\biPad\b/.test(ua);
  // iPadOS 13+ masquerades as a Mac — a real Mac laptop has no touch, so touch+Mac = iPad.
  const iPadOS = navigator.platform === "MacIntel" && (navigator.maxTouchPoints || 0) > 1;
  return mobileUA || iPadOS;
}

/* ── V3.1 security helpers (config-driven; only used when the matching toggle is on) ── */
const VKEYS = ["fullscreenExits","tabSwitches","focusLoss","multipleFaces","refresh","devtools",
  "clipboard","idle","windowResize","location","cameraDisconnect","faceHidden"];
const ALLOWED_BROWSERS = ["chrome", "edge", "firefox"];
function detectBrowser() {
  const ua = navigator.userAgent || "";
  if (/Edg\//.test(ua)) return "edge";
  if (/OPR\//.test(ua) || /Opera/.test(ua)) return "opera";
  if (/Firefox\//.test(ua)) return "firefox";
  if (/Chrome\//.test(ua)) return "chrome";
  if (/Safari\//.test(ua)) return "safari";
  return "other";
}
function screenMeets(minW, minH) {
  return (window.screen?.width || 0) >= (minW || 0) && (window.screen?.height || 0) >= (minH || 0);
}
async function detectIncognito() {
  try {
    if (navigator.storage?.estimate) {
      const { quota } = await navigator.storage.estimate();
      if (quota && quota < 120 * 1024 * 1024) return true; // private windows get a tiny quota
    }
  } catch { /* ignore */ }
  return false;
}
function haversineM(lat1, lng1, lat2, lng2) {
  const R = 6371000, r = (x) => (x * Math.PI) / 180;
  const dLat = r(lat2 - lat1), dLng = r(lng2 - lng1);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(r(lat1)) * Math.cos(r(lat2)) * Math.sin(dLng / 2) ** 2;
  return Math.round(R * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h)));
}
function getGeoOnce() {
  return new Promise((resolve) => {
    if (!navigator.geolocation) return resolve(null);
    navigator.geolocation.getCurrentPosition(
      (p) => resolve({ lat: p.coords.latitude, lng: p.coords.longitude, accuracy: p.coords.accuracy }),
      () => resolve(null),
      { enableHighAccuracy: true, timeout: 10000 }
    );
  });
}

/* Palette state for a question id */
const PSTATE = {
  NOT_VISITED: "not-visited", NOT_ANSWERED: "not-answered", ANSWERED: "answered",
  REVIEW: "review", ANSWERED_REVIEW: "answered-review",
};
const PALETTE_LEGEND = [
  [PSTATE.ANSWERED, "Answered"],
  [PSTATE.NOT_ANSWERED, "Not Answered"],
  [PSTATE.NOT_VISITED, "Not Visited"],
  [PSTATE.REVIEW, "Marked for Review"],
  [PSTATE.ANSWERED_REVIEW, "Answered & Review"],
];

export default function AssessmentPage() {
  const { token } = useParams();

  const [phase, setPhase] = useState("loading"); // loading|ready|resume|rules|gate|quiz|submitting|result|error|expired|completed
  const [info, setInfo] = useState(null);
  const [errMsg, setErrMsg] = useState("");
  const [gateMsg, setGateMsg] = useState("");
  const [resumeMode, setResumeMode] = useState(false);
  const [agreed, setAgreed] = useState(false);
  const [finished, setFinished] = useState(false);
  // Camera + face verification
  const [camReady, setCamReady] = useState(false);
  const [camDenied, setCamDenied] = useState(false);
  const [verifyStatus, setVerifyStatus] = useState("idle"); // idle|loading|scanning|verified|nocam|detectorfail
  const [faceCount, setFaceCount] = useState(null);
  const [verifyMsg, setVerifyMsg] = useState("");
  const [faceWarn, setFaceWarn] = useState("");             // live in-quiz face warning banner

  // quiz state
  const [questions, setQuestions] = useState([]);
  const [answers, setAnswers] = useState({});      // qid -> displayIndex
  const [review, setReview] = useState(() => new Set());
  const [visited, setVisited] = useState(() => new Set());
  const [curQ, setCurQ] = useState(0);
  const [timeLeft, setTimeLeft] = useState(0);
  const [showViol, setShowViol] = useState(false);
  const [showConf, setShowConf] = useState(false);
  const [showRules, setShowRules] = useState(false);
  const [camOn, setCamOn] = useState(false);
  const [saveState, setSaveState] = useState("idle"); // idle|saving|saved
  const [lastSaved, setLastSaved] = useState(null);    // Date
  const [online, setOnline] = useState(typeof navigator !== "undefined" ? navigator.onLine : true);
  const [isMobile] = useState(() => isMobileDevice());

  const violRef = useRef({ fullscreenExits: 0, tabSwitches: 0, focusLoss: 0, multipleFaces: 0 });
  const [violCount, setViolCount] = useState(0);
  const [violReason, setViolReason] = useState("");
  const submitted = useRef(false);
  const streamRef = useRef(null);
  const videoRef = useRef(null);
  const answersRef = useRef({});
  const reviewRef = useRef(new Set());
  const visitedRef = useRef(new Set());
  const curRef = useRef(0);
  const timerRef = useRef(null);
  // Face-detection refs
  const detectorRef = useRef(null);
  const detectTimerRef = useRef(null);   // verification loop
  const monitorTimerRef = useRef(null);  // in-quiz monitoring loop
  const okFramesRef = useRef(0);
  const multiStreakRef = useRef(0);
  const noFaceStreakRef = useRef(0);
  const multiCooldownRef = useRef(0);
  const secRef = useRef({});   // live per-drive security toggles
  const cfgRef = useRef({});   // live per-drive security config (numbers + location)
  const refreshCountRef = useRef(0);
  const lastActivityRef = useRef(Date.now());
  const camGoneSinceRef = useRef(0);
  const faceGoneSinceRef = useRef(0);
  const [incognito, setIncognito] = useState(null); // null=unknown, true/false
  const [showId, setShowId] = useState(false);       // candidate identity popover (top-right)
  const [geoBlock, setGeoBlock] = useState(null);    // {distance,radius,msg} location block

  const [nowTick, setNowTick] = useState(Date.now());

  useEffect(() => {
    if (info?.security) secRef.current = info.security;
    if (info?.securityConfig) cfgRef.current = info.securityConfig;
  }, [info]);
  useEffect(() => { answersRef.current = answers; }, [answers]);
  useEffect(() => { reviewRef.current = review; }, [review]);
  useEffect(() => { visitedRef.current = visited; }, [visited]);
  useEffect(() => { curRef.current = curQ; }, [curQ]);

  // Countdown ticker for the "not started yet" screen; flips to ready at start time.
  useEffect(() => {
    if (phase !== "notstarted") return;
    const iv = setInterval(() => {
      const t = Date.now();
      setNowTick(t);
      if (info?.startAt && t >= new Date(info.startAt).getTime()) setPhase("ready");
    }, 1000);
    return () => clearInterval(iv);
  }, [phase, info]);

  // Mark current question visited
  useEffect(() => {
    if (phase !== "quiz" || !questions.length) return;
    const qid = questions[curQ]?.id;
    if (qid) setVisited(v => (v.has(qid) ? v : new Set(v).add(qid)));
  }, [curQ, phase, questions]);

  /* ── Initial load ─────────────────────────────────────────────────────────── */
  useEffect(() => {
    (async () => {
      try {
        const res = await getCandidate(token);
        const data = res.data.data;
        setInfo(data);
        const state = res.data.state;
        // Browser Refresh Protection: count reloads of an in-progress attempt. This must
        // NOT punish legitimate resuming (network drop, closed tab, continuing next day),
        // so the limit is generous + configurable (securityConfig.maxRefreshes, default 5).
        // Only truly excessive refreshing terminates. Set the toggle off to disable entirely.
        if (state === "in-progress" && data?.security?.refreshProtection !== false) {
          const maxR = Number(data?.securityConfig?.maxRefreshes) || 5;
          const key = `asmt_refresh_${token}`;
          const n = (parseInt(localStorage.getItem(key) || "0", 10) || 0) + 1;
          try { localStorage.setItem(key, String(n)); } catch { /* ignore */ }
          refreshCountRef.current = n;
          if (n > maxR) {
            try { await submitCandidate(token, { answers: {}, reason: "auto-malpractice", terminationReason: "Browser Refresh Limit Exceeded", refreshCount: n }); } catch { /* idempotent */ }
            setPhase("terminated"); return;
          }
        }
        if (state === "expired") setPhase("expired");
        else if (state === "completed") setPhase("completed");
        else if (state === "disqualified") setPhase("terminated");
        else if (state === "not-started") setPhase("notstarted");
        else if (state === "in-progress") setPhase("resume");
        else setPhase("ready");
      } catch (err) {
        setErrMsg(err.message || "Could not load this assessment link.");
        setPhase("error");
      }
    })();
    return () => fullCleanup();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  /* ── Camera (preview + face detection only — never uploaded or stored) ────── */
  const startCamera = useCallback(async () => {
    if (streamRef.current) { setCamOn(true); setCamReady(true); return true; }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { width: 480, height: 360 }, audio: false });
      streamRef.current = stream;
      setCamOn(true); setCamReady(true); setCamDenied(false);
      return true;
    } catch {
      setCamOn(false); setCamReady(false); setCamDenied(true);
      return false;
    }
  }, []);

  function stopFaceTimers() {
    if (detectTimerRef.current) { clearInterval(detectTimerRef.current); detectTimerRef.current = null; }
    if (monitorTimerRef.current) { clearInterval(monitorTimerRef.current); monitorTimerRef.current = null; }
  }

  function stopCamera() {
    stopFaceTimers();
    try {
      streamRef.current?.getTracks().forEach(t => { try { t.stop(); } catch { /* ignore */ } });
    } catch { /* ignore */ }
    streamRef.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;
    setCamOn(false); setCamReady(false);
  }

  // Full teardown — camera, fullscreen, timers (used on unmount + Finish)
  function fullCleanup() {
    stopCamera();
    clearInterval(timerRef.current);
    stopFaceTimers();
    if (isFullscreen()) exitFullscreen();
  }

  useEffect(() => {
    if (camOn && videoRef.current && streamRef.current) {
      videoRef.current.srcObject = streamRef.current;
      videoRef.current.play?.().catch(() => {});
    }
  }, [camOn, phase]);

  // Pre-grant camera on the Rules page — ONLY if this drive uses the camera.
  // When Camera Monitoring is OFF we never touch getUserMedia, so desktops with
  // no webcam can take the assessment without any permission prompt.
  useEffect(() => {
    if (phase === "rules" && !streamRef.current && (secRef.current || {}).cameraMonitoring !== false) {
      startCamera();
    }
  }, [phase, startCamera]);

  /* ── Verification: exactly one face required ──────────────────────────────── */
  const finishVerification = useCallback(async () => {
    stopFaceTimers();
    setVerifyStatus("verified"); setVerifyMsg("");
    await new Promise(r => setTimeout(r, 700));
    await loadPaper();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const verifyTick = useCallback(() => {
    const count = detectFaceCount(detectorRef.current, videoRef.current, performance.now());
    if (count == null) return;            // video not ready yet
    setFaceCount(count);
    if (count === 1) {
      okFramesRef.current += 1;
      setVerifyMsg("");
      if (okFramesRef.current >= 3) finishVerification();   // ~1s of a single stable face
    } else {
      okFramesRef.current = 0;
      setVerifyMsg(count === 0 ? FACE_MESSAGES.none : FACE_MESSAGES.multi);
    }
  }, [finishVerification]);

  const beginScanning = useCallback(async () => {
    const sec = secRef.current || {};
    // Camera Monitoring is the MASTER switch. Off → no camera, and (since face checks
    // need a camera) no face verification either. Some venues have webcam-less desktops.
    const wantCamera = sec.cameraMonitoring !== false;
    setVerifyStatus("loading"); setVerifyMsg(""); setFaceCount(null); okFramesRef.current = 0;

    // Camera disabled for this drive → skip straight to the paper (no permission prompt).
    if (!wantCamera) {
      setVerifyStatus("verified");
      await new Promise(r => setTimeout(r, 500));
      await loadPaper();
      return;
    }
    let ok = !!streamRef.current;
    if (!ok) ok = await startCamera();
    if (!ok) { setVerifyStatus("nocam"); return; }

    // Face verification disabled → camera on (monitoring) but no face gate.
    if (sec.faceVerification === false) {
      setVerifyStatus("verified");
      await new Promise(r => setTimeout(r, 700));
      await loadPaper();
      return;
    }
    // Face verification ON & MANDATORY — if the detector can't init, stay locked.
    let detector = null;
    try { detector = await loadFaceDetector(); } catch { detector = null; }
    detectorRef.current = detector;
    if (!detector) { setVerifyStatus("detectorfail"); return; }
    setVerifyStatus("scanning");
    stopFaceTimers();
    detectTimerRef.current = setInterval(verifyTick, 300);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [startCamera, verifyTick]);

  /* ── Gate runs AFTER fullscreen is confirmed ──────────────────────────────── */
  const runGateAfterFullscreen = useCallback(() => {
    setPhase("gate");
    beginScanning();
  }, [beginScanning]);

  /*
   * CRITICAL: fullscreen must be requested synchronously inside the click event,
   * before ANY await / API call. requestFullscreen() is the very first statement
   * so the gesture is preserved. Camera permission was already granted on the
   * Rules page, so no prompt interrupts/drops fullscreen here.
   */
  const enterAndStart = useCallback(() => {
    // Fullscreen disabled for this drive → go straight to the gate (no FS gesture needed).
    if ((secRef.current || {}).fullscreenEnforcement === false) { setGateMsg(""); runGateAfterFullscreen(); return; }
    const fsPromise = requestFullscreen();   // FIRST — inside the click gesture
    const failMsg = resumeMode
      ? "Fullscreen mode is required to continue this assessment."
      : "Fullscreen mode is mandatory for this assessment.";
    fsPromise
      .then(() => {
        if (!isFullscreen()) { setGateMsg(failMsg); setPhase("rules"); return; }
        setGateMsg("");
        runGateAfterFullscreen();
      })
      .catch(() => { setGateMsg(failMsg); setPhase("rules"); });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [runGateAfterFullscreen, resumeMode]);

  const retryVerification = useCallback(() => { setGateMsg(""); beginScanning(); }, [beginScanning]);

  const exitAssessment = useCallback(() => {
    fullCleanup();
    setPhase(resumeMode ? "resume" : "ready");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resumeMode]);

  const backupKey = `asmt_backup_${token}`;
  const writeBackup = useCallback(() => {
    try {
      localStorage.setItem(backupKey, JSON.stringify({
        answers: answersRef.current,
        review: [...reviewRef.current],
        visited: [...visitedRef.current],
        currentQuestion: curRef.current,
        ts: Date.now(),
      }));
    } catch { /* storage full / disabled — ignore */ }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [backupKey]);

  const loadPaper = useCallback(async () => {
    const fsRequired = (secRef.current || {}).fullscreenEnforcement !== false;
    // HARD GATE: the quiz is entered ONLY from here, and ONLY while in fullscreen
    // (unless this drive has fullscreen enforcement disabled).
    if (fsRequired && !isFullscreen()) {
      stopFaceTimers();
      setGateMsg(resumeMode
        ? "Fullscreen mode is required to continue this assessment."
        : "Fullscreen mode is mandatory for this assessment.");
      setPhase("rules");
      return;
    }
    try {
      // Batch B: capture location before starting when the drive enforces a radius.
      let geo;
      if ((secRef.current || {}).locationRestriction === true) {
        geo = await getGeoOnce();
        if (!geo) {
          setGeoBlock({ msg: "Location access is required to start this assessment. Please allow location access in your browser and retry." });
          setPhase("locationblocked");
          return;
        }
      }
      const res = await startCandidate(token, geo ? { geo } : undefined);
      const d = res.data.data;
      // Merge any local backup (answers made while offline before a refresh/crash).
      let bAns = {}, bRev = [], bVis = [];
      try {
        const raw = localStorage.getItem(backupKey);
        if (raw) { const b = JSON.parse(raw); bAns = b.answers || {}; bRev = b.review || []; bVis = b.visited || []; }
      } catch { /* ignore */ }
      setQuestions(d.questions || []);
      setAnswers({ ...(d.answers || {}), ...bAns });            // local backup wins (it's the candidate's latest)
      setReview(new Set([...(d.review || []), ...bRev]));
      setVisited(new Set([...(d.visited || []), ...bVis]));
      setCurQ(d.currentQuestion || 0);
      setTimeLeft(d.remainingSeconds ?? (d.durationMinutes || 40) * 60);
      const v = d.violations || {};
      violRef.current = { fullscreenExits: v.fullscreenExits || 0, tabSwitches: v.tabSwitches || 0, focusLoss: v.focusLoss || 0, multipleFaces: v.multipleFaces || 0 };
      setViolCount((v.fullscreenExits || 0) + (v.tabSwitches || 0) + (v.focusLoss || 0) + (v.multipleFaces || 0));
      // Re-verify fullscreen after the network round-trip (it could have been dropped meanwhile).
      if (fsRequired && !isFullscreen()) {
        stopFaceTimers();
        setGateMsg(resumeMode
          ? "Fullscreen mode is required to continue this assessment."
          : "Fullscreen mode is mandatory for this assessment.");
        setPhase("rules");
        return;
      }
      setPhase("quiz");
      if (d.remainingSeconds === 0) setTimeout(() => doSubmit({ timedOut: true }), 50);
    } catch (err) {
      // Window/terminal states can come back from /start — clean up and show them.
      fullCleanup();
      if (err.state === "completed")    { setPhase("completed"); return; }
      if (err.state === "disqualified") { setPhase("terminated"); return; }
      if (err.state === "expired")      { setPhase("expired"); return; }
      if (err.state === "not-started")  { setPhase("notstarted"); return; }
      if (err.state === "location-blocked") { setGeoBlock({ distance: err.distance, radius: err.radius, msg: "You are outside the permitted assessment location." }); setPhase("locationblocked"); return; }
      if (err.state === "location-required") { setGeoBlock({ msg: err.message || "Location access is required to start this assessment." }); setPhase("locationblocked"); return; }
      setErrMsg(err.message || "Failed to start assessment."); setPhase("error");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, resumeMode]);

  /* ── Timer ────────────────────────────────────────────────────────────────── */
  useEffect(() => {
    if (phase !== "quiz") return;
    timerRef.current = setInterval(() => {
      setTimeLeft(t => {
        if (t <= 1) { clearInterval(timerRef.current); doSubmit({ timedOut: true }); return 0; }
        return t - 1;
      });
    }, 1000);
    return () => clearInterval(timerRef.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase]);

  /* ── Autosave (throttled) + local backup + save indicator ─────────────────── */
  const persist = useCallback(async () => {
    writeBackup(); // always keep a local copy first (survives offline / crash)
    if (submitted.current) return;
    setSaveState("saving");
    try {
      await saveCandidate(token, {
        answers: answersRef.current,
        review: [...reviewRef.current],
        visited: [...visitedRef.current],
        currentQuestion: curRef.current,
        violations: violRef.current,
      });
      setSaveState("saved");
      setLastSaved(new Date());
    } catch {
      setSaveState("idle"); // failed (likely offline) — backup retained, will resync
    }
  }, [token, writeBackup]);

  useEffect(() => {
    if (phase !== "quiz") return;
    const iv = setInterval(persist, 8000);
    return () => clearInterval(iv);
  }, [phase, persist]);

  /* ── Network protection: offline banner + auto-resync ─────────────────────── */
  useEffect(() => {
    if (phase !== "quiz") return;
    const goOnline  = () => { setOnline(true); persist(); };   // resync the moment we're back
    const goOffline = () => { setOnline(false); writeBackup(); };
    window.addEventListener("online", goOnline);
    window.addEventListener("offline", goOffline);
    return () => { window.removeEventListener("online", goOnline); window.removeEventListener("offline", goOffline); };
  }, [phase, persist, writeBackup]);

  /* ── Immediate termination (for hard rules: refresh limit, camera/face/location) ── */
  const terminateNow = useCallback((label) => {
    if (submitted.current) return;
    doSubmit({ reason: "auto-malpractice", terminationReason: label });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* ── Violation recording (shared by fullscreen/tab/blur + face/security monitors) ── */
  const recordViolation = useCallback((kind, reason, label) => {
    if (submitted.current) return;
    violRef.current = { ...violRef.current, [kind]: (violRef.current[kind] || 0) + 1 };
    const v = violRef.current;
    const total = VKEYS.reduce((s, k) => s + (v[k] || 0), 0);
    setViolCount(total);
    setViolReason(reason || "");
    persist();
    const max = cfgRef.current?.maxViolations || MAX_VIOLATIONS;
    if (total >= max) { doSubmit({ reason: "auto-malpractice", terminationReason: label || "Violation limit exceeded" }); return; }
    setShowViol(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [persist]);

  useEffect(() => {
    if (phase !== "quiz") return;
    const sec = secRef.current || {};
    const tabOn = sec.tabSwitchDetection !== false;
    const fsOn  = sec.fullscreenEnforcement !== false;
    const onVis = () => { if (document.hidden) recordViolation("tabSwitches", "tab"); };
    const onBlur = () => recordViolation("focusLoss", "tab");
    const onFs = () => { if (!isFullscreen() && !submitted.current) recordViolation("fullscreenExits", "fullscreen"); };
    if (tabOn) { document.addEventListener("visibilitychange", onVis); window.addEventListener("blur", onBlur); }
    if (fsOn)  { document.addEventListener("fullscreenchange", onFs); document.addEventListener("webkitfullscreenchange", onFs); }
    return () => {
      document.removeEventListener("visibilitychange", onVis);
      window.removeEventListener("blur", onBlur);
      document.removeEventListener("fullscreenchange", onFs);
      document.removeEventListener("webkitfullscreenchange", onFs);
    };
  }, [phase, recordViolation]);

  /* ── Continuous face monitoring during the assessment ─────────────────────── */
  useEffect(() => {
    if (phase !== "quiz" || !detectorRef.current) return;  // no detector → nothing to monitor
    const sec = secRef.current || {};
    const multiOn   = sec.multipleFaceDetection !== false;
    const faceVisOn = sec.faceVisibilityDetection !== false;
    if (!multiOn && !faceVisOn) return; // both disabled for this drive
    const grace = cfgRef.current?.cameraGraceSeconds || 10;
    multiStreakRef.current = 0; noFaceStreakRef.current = 0; multiCooldownRef.current = 0;
    monitorTimerRef.current = setInterval(() => {
      if (submitted.current) return;
      const count = detectFaceCount(detectorRef.current, videoRef.current, performance.now());
      if (count == null) return;
      if (count >= 2) {
        noFaceStreakRef.current = 0; setFaceWarn("");
        multiStreakRef.current += 1;
        // Require 2 consecutive detections (~2s) + a cooldown → one violation per incident.
        if (multiOn && multiStreakRef.current >= 2 && Date.now() > multiCooldownRef.current) {
          multiCooldownRef.current = Date.now() + 6000;
          recordViolation("multipleFaces", "multipleFaces", "Multiple faces detected");
        }
      } else if (count === 0) {
        multiStreakRef.current = 0;
        noFaceStreakRef.current += 1;
        // Face-visibility: warn, then terminate after the configured grace period (~1 tick/sec).
        if (faceVisOn) {
          const left = grace - noFaceStreakRef.current;
          if (left <= 0) { setFaceWarn(""); terminateNow("Face Not Visible"); return; }
          if (noFaceStreakRef.current >= 3) setFaceWarn(`Face not detected — please stay visible. Terminating in ${left}s.`);
        } else if (noFaceStreakRef.current >= 3) {
          setFaceWarn("Face not detected — please stay visible to the camera.");
        }
      } else {
        multiStreakRef.current = 0; noFaceStreakRef.current = 0; setFaceWarn("");
      }
    }, 1000);
    return () => { if (monitorTimerRef.current) { clearInterval(monitorTimerRef.current); monitorTimerRef.current = null; } };
  }, [phase, recordViolation, terminateNow]);

  /* ── Camera-disconnect detection (config: cameraDisconnectDetection + grace) ── */
  useEffect(() => {
    if (phase !== "quiz") return;
    const sec = secRef.current || {};
    if (sec.cameraMonitoring === false || sec.cameraDisconnectDetection === false) return;
    const grace = (cfgRef.current?.cameraGraceSeconds || 10) * 1000;
    camGoneSinceRef.current = 0;
    const iv = setInterval(() => {
      if (submitted.current) return;
      const track = streamRef.current?.getVideoTracks?.()[0];
      const live = track && track.readyState === "live" && track.enabled !== false;
      if (!live) {
        if (!camGoneSinceRef.current) { camGoneSinceRef.current = Date.now(); setFaceWarn("Camera disconnected — reconnect within the grace period."); }
        else if (Date.now() - camGoneSinceRef.current >= grace) { recordViolation("cameraDisconnect", "tab", "Camera Disconnected"); terminateNow("Camera Disconnected"); }
      } else if (camGoneSinceRef.current) {
        camGoneSinceRef.current = 0; setFaceWarn("");
      }
    }, 1000);
    return () => clearInterval(iv);
  }, [phase, recordViolation, terminateNow]);

  /* ── Batch A: DOM-level protections (right-click, keyboard, clipboard, resize, idle, devtools) ── */
  useEffect(() => {
    if (phase !== "quiz") return;
    const sec = secRef.current || {};
    const cfg = cfgRef.current || {};
    const cleanups = [];
    const on = (t, ev, fn, opts) => { t.addEventListener(ev, fn, opts); cleanups.push(() => t.removeEventListener(ev, fn, opts)); };

    // Right-click / copy / paste / cut / drag / print blocking
    if (sec.rightClickProtection !== false) {
      const block = (e) => { e.preventDefault(); return false; };
      ["contextmenu", "dragstart"].forEach((ev) => on(document, ev, block));
    }
    // Clipboard monitoring (count attempts → terminate past the limit)
    if (sec.clipboardMonitoring !== false) {
      const limit = cfg.clipboardLimit || 3;
      const onClip = (e) => {
        if (sec.rightClickProtection !== false) e.preventDefault();
        const v = (violRef.current.clipboard || 0) + 1;
        if (v >= limit) { recordViolation("clipboard", "tab", "Clipboard limit exceeded"); }
        else { violRef.current = { ...violRef.current, clipboard: v }; setFaceWarn(`Copy/paste is disabled (${v}/${limit}).`); setTimeout(() => setFaceWarn(""), 2500); }
      };
      ["copy", "paste", "cut"].forEach((ev) => on(document, ev, onClip));
    } else if (sec.rightClickProtection !== false) {
      const block = (e) => e.preventDefault();
      ["copy", "paste", "cut"].forEach((ev) => on(document, ev, block));
    }
    // Keyboard shortcut blocking
    if (sec.keyboardBlocking !== false) {
      const onKey = (e) => {
        const k = (e.key || "").toLowerCase();
        const combo = (e.ctrlKey || e.metaKey);
        const blocked =
          k === "f12" ||
          (combo && e.shiftKey && ["i", "j", "c"].includes(k)) ||
          (combo && ["c", "v", "x", "a", "s", "p", "u"].includes(k));
        if (blocked) { e.preventDefault(); e.stopPropagation(); return false; }
      };
      on(document, "keydown", onKey, true);
    }
    // Window-resize detection (debounced; compares to the entry size)
    if (sec.windowResizeDetection !== false) {
      let base = { w: window.innerWidth, h: window.innerHeight };
      let t = null, cooldown = 0;
      const onResize = () => {
        clearTimeout(t);
        t = setTimeout(() => {
          const dw = Math.abs(window.innerWidth - base.w), dh = Math.abs(window.innerHeight - base.h);
          if ((dw > 120 || dh > 120) && Date.now() > cooldown) {
            cooldown = Date.now() + 4000; base = { w: window.innerWidth, h: window.innerHeight };
            recordViolation("windowResize", "tab", "Abnormal window resize");
          }
        }, 400);
      };
      on(window, "resize", onResize);
    }
    // Idle detection (warn near the end, then terminate)
    let idleIv = null;
    if (sec.idleDetection !== false) {
      const limit = (cfg.idleSeconds || 120) * 1000;
      lastActivityRef.current = Date.now();
      const bump = () => { lastActivityRef.current = Date.now(); };
      ["mousemove", "keydown", "click", "scroll", "touchstart"].forEach((ev) => on(window, ev, bump, { passive: true }));
      idleIv = setInterval(() => {
        if (submitted.current) return;
        const idle = Date.now() - lastActivityRef.current;
        if (idle >= limit) { recordViolation("idle", "tab", "Idle timeout"); terminateNow("Idle Timeout"); }
        else if (idle >= limit * 0.75) setFaceWarn("You appear inactive — interact to avoid termination.");
      }, 3000);
    }
    // DevTools detection (window/viewport delta heuristic)
    let devIv = null;
    if (sec.devToolsDetection !== false) {
      let cooldown = 0;
      devIv = setInterval(() => {
        if (submitted.current) return;
        const wDiff = window.outerWidth - window.innerWidth;
        const hDiff = window.outerHeight - window.innerHeight;
        const open = wDiff > 200 || hDiff > 200;
        if (open && Date.now() > cooldown) { cooldown = Date.now() + 5000; recordViolation("devtools", "tab", "Developer tools opened"); }
      }, 1500);
    }

    return () => { cleanups.forEach((fn) => fn()); if (idleIv) clearInterval(idleIv); if (devIv) clearInterval(devIv); };
  }, [phase, recordViolation, terminateNow]);

  /* ── Batch B: location lock — re-check every 60s; 2nd breach terminates ──────── */
  useEffect(() => {
    if (phase !== "quiz") return;
    const sec = secRef.current || {};
    const loc = cfgRef.current?.location || {};
    if (sec.locationRestriction !== true || loc.lat == null || loc.lng == null) return;
    const radius = loc.radiusMeters || 200;
    const iv = setInterval(async () => {
      if (submitted.current) return;
      const g = await getGeoOnce();
      if (!g) return; // can't read now — don't penalise transient failures
      const dist = haversineM(loc.lat, loc.lng, g.lat, g.lng);
      const slack = Math.min(g.accuracy || 0, 500); // tolerate GPS inaccuracy (same as server)
      if (dist > radius + slack) {
        const v = (violRef.current.location || 0) + 1;
        if (v >= 2) { recordViolation("location", "tab", "Location Violation"); terminateNow("Location Violation"); }
        else { violRef.current = { ...violRef.current, location: v }; setFaceWarn(`You appear to have left the permitted location (${dist}m). One more breach will terminate the assessment.`); }
      }
    }, 60000);
    return () => clearInterval(iv);
  }, [phase, recordViolation, terminateNow]);

  /* ── Incognito detection (async; result used by the render gate) ───────────── */
  useEffect(() => {
    let alive = true;
    detectIncognito().then((r) => { if (alive) setIncognito(r); });
    return () => { alive = false; };
  }, []);

  // If fullscreen is dropped DURING the camera/face gate (e.g. Esc while the model
  // loads), abort verification and return to the Rules page — never enter the quiz.
  useEffect(() => {
    if (phase !== "gate") return;
    const onFs = () => {
      if (!isFullscreen()) {
        stopFaceTimers();
        setGateMsg(resumeMode
          ? "Fullscreen mode is required to continue this assessment."
          : "Fullscreen mode is mandatory for this assessment.");
        setPhase("rules");
      }
    };
    document.addEventListener("fullscreenchange", onFs);
    document.addEventListener("webkitfullscreenchange", onFs);
    return () => {
      document.removeEventListener("fullscreenchange", onFs);
      document.removeEventListener("webkitfullscreenchange", onFs);
    };
  }, [phase, resumeMode]);

  const dismissViolation = useCallback(() => { setShowViol(false); requestFullscreen().catch(() => {}); }, []);

  /* ── Submit ───────────────────────────────────────────────────────────────── */
  const doSubmit = useCallback(async ({ timedOut = false, reason, terminationReason } = {}) => {
    if (submitted.current) return;
    submitted.current = true;
    clearInterval(timerRef.current);
    const disqualified = reason === "auto-malpractice";
    setPhase("submitting");
    try {
      await submitCandidate(token, { answers: answersRef.current, timedOut, reason, violations: violRef.current,
        refreshCount: refreshCountRef.current, terminationReason });
    } catch { /* idempotent on server */ }
    try { localStorage.removeItem(`asmt_backup_${token}`); localStorage.removeItem(`asmt_refresh_${token}`); } catch { /* ignore */ }
    stopCamera();
    if (isFullscreen()) exitFullscreen();
    setPhase(disqualified ? "terminated" : "result");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  /* ── Derived: sections (contiguous blocks, fixed order) ──────────────────── */
  const sections = useMemo(() => {
    const out = []; let cur = null;
    questions.forEach((q, i) => {
      if (!cur || cur.name !== q.section) { cur = { name: q.section, label: q.sectionLabel || q.section, idxs: [] }; out.push(cur); }
      cur.idxs.push(i);
    });
    return out;
  }, [questions]);

  const qState = useCallback((qid) => {
    const ans = answers[qid] != null;
    const rev = review.has(qid);
    if (ans && rev) return PSTATE.ANSWERED_REVIEW;
    if (rev) return PSTATE.REVIEW;
    if (ans) return PSTATE.ANSWERED;
    if (visited.has(qid)) return PSTATE.NOT_ANSWERED;
    return PSTATE.NOT_VISITED;
  }, [answers, review, visited]);

  const sectionStats = useCallback((sec) => {
    let answered = 0, rev = 0;
    sec.idxs.forEach(i => {
      const qid = questions[i].id;
      if (answers[qid] != null) answered++;
      if (review.has(qid)) rev++;
    });
    return { total: sec.idxs.length, answered, unanswered: sec.idxs.length - answered, review: rev };
  }, [questions, answers, review]);

  /* ── Renders ──────────────────────────────────────────────────────────────── */
  // Pre-start hard gates — each enforced ONLY when its drive toggle is on.
  const sx = info?.security || {};
  const cx = info?.securityConfig || {};
  // Mobile / tablet blocked — unless this drive disables the desktop-only rule.
  if (isMobile && (sx.desktopOnly !== false)) return (
    <CenterCard icon="💻" title="Desktop or Laptop Required"
      message="This assessment must be taken on a laptop or desktop computer. Please switch to a desktop browser and reopen your assessment link." />
  );
  // Screen resolution too small
  if (info && sx.screenResolutionCheck !== false && !screenMeets(cx.minScreenWidth || 1024, cx.minScreenHeight || 600)) return (
    <CenterCard icon="🖥️" title="Unsupported Screen Resolution"
      message={`This assessment requires a minimum screen resolution of ${cx.minScreenWidth || 1024}×${cx.minScreenHeight || 600}. Please use a larger display.`} />
  );
  // Unsupported browser
  if (info && sx.browserCompatibility !== false && !ALLOWED_BROWSERS.includes(detectBrowser())) return (
    <CenterCard icon="🌐" title="Unsupported Browser"
      message="Please use the latest Google Chrome, Microsoft Edge, or Mozilla Firefox to take this assessment." />
  );
  // Incognito / private window
  if (info && sx.incognitoDetection !== false && incognito === true) return (
    <CenterCard icon="🕵️" title="Private Browsing Not Allowed"
      message="This assessment cannot be taken in an Incognito / Private window. Please reopen the link in a normal browser window." />
  );
  // Location blocked / required (Batch B)
  if (phase === "locationblocked") return (
    <CenterCard icon="📍" title="Outside Permitted Location"
      message={geoBlock?.distance != null
        ? `You are outside the permitted assessment location (${geoBlock.distance} m away; allowed radius ${geoBlock.radius} m). ${geoBlock.msg || ""}`
        : (geoBlock?.msg || "You are outside the permitted assessment location.")} />
  );

  if (phase === "loading") return <CenterCard icon={<div className="qp-spinner-lg" />} title="Loading…" />;
  if (phase === "error") return <CenterCard icon="⚠️" title="Something went wrong" message={errMsg} />;
  if (phase === "expired") return <CenterCard icon="⏳" title="This assessment window has expired." message="You can no longer access this assessment. Please contact the organizer if you believe this is an error." />;
  if (phase === "completed") return <CenterCard icon="✅" title="This assessment has already been completed." message="Your responses were recorded. You may close this page." />;
  if (phase === "submitting") return <CenterCard icon={<div className="qp-spinner-lg" />} title="Submitting…" message="Please wait, do not close this window." />;

  // Disqualified / session terminated
  if (phase === "terminated") return (
    <CenterCard icon="🚫" title="Assessment Session Terminated">
      <div className="asmt-result-note" style={{ background: "#fef2f2", border: "1px solid #fecaca", color: "#991b1b" }}>
        We detected multiple violations of the assessment guidelines during your session.
        <br /><br />
        Your assessment has been terminated.
        <br /><br />
        Please try again during future recruitment opportunities. Thank you.
      </div>
    </CenterCard>
  );

  // Window not open yet — live countdown
  if (phase === "notstarted") {
    const startMs = info?.startAt ? new Date(info.startAt).getTime() : 0;
    const remain = Math.max(0, Math.floor((startMs - nowTick) / 1000));
    const hh = String(Math.floor(remain / 3600)).padStart(2, "0");
    const mm = String(Math.floor((remain % 3600) / 60)).padStart(2, "0");
    const ss = String(remain % 60).padStart(2, "0");
    return (
      <CenterCard icon="⏰" title="Assessment Has Not Started Yet"
        message={`${info?.assessmentName || "Your assessment"} opens on ${info?.startAt ? new Date(info.startAt).toLocaleString() : "the scheduled time"}.`}>
        <div className="asmt-countdown">Starts in<br /><span>{hh}:{mm}:{ss}</span></div>
        <p className="asmt-center-msg" style={{ marginTop: 14 }}>This page will unlock automatically when the assessment begins.</p>
      </CenterCard>
    );
  }

  // Fullscreen failed — Retry / Exit
  if (phase === "fsfail") return (
    <CenterCard icon="🖥️" title="Fullscreen Required"
      message="Fullscreen access is required to start this assessment.">
      <div style={{ display: "flex", gap: 12, marginTop: 20, justifyContent: "center" }}>
        <button className="asmt-start-btn" style={{ flex: 1 }} onClick={enterAndStart}>Retry Fullscreen</button>
        <button className="asmt-btn-ghost" onClick={exitAssessment}>Exit Assessment</button>
      </div>
    </CenterCard>
  );

  if (phase === "result") {
    if (finished) return <CenterCard icon="✅" title="Assessment completed successfully." message="You may now close this page." />;
    return (
      <CenterCard icon="🎉" title="Thank you for taking the assessment.">
        <div className="asmt-result-note" style={{ background: "#f8fafc", border: "1px solid #e2e8f0", color: "#334155" }}>
          We appreciate the time, effort, and dedication you invested in completing this assessment.
          <br /><br />
          Your responses have been recorded successfully.
          <br /><br />
          You may now close this page.
        </div>
        <button className="asmt-start-btn" style={{ marginTop: 22 }} onClick={() => { fullCleanup(); setFinished(true); }}>
          Finish Assessment
        </button>
      </CenterCard>
    );
  }

  // Landing (ready / resume)
  if (phase === "ready" || phase === "resume") {
    const isResume = phase === "resume";
    return (
      <div className="asmt-landing">
        <header className="asmt-top">
          <div className="asmt-brand"><BrandLogo className="asmt-logo-img" />M H FOUNDATION</div>
        </header>
        <div className="asmt-landing-body">
          <div className="asmt-card">
            {isResume && <div className="asmt-resume-badge">Assessment In Progress</div>}
            <div className="asmt-hello">{isResume ? "Welcome back," : "Welcome,"}</div>
            <h1 className="asmt-name">{info?.name}</h1>
            <div className="asmt-college">{info?.college}</div>
            <div className="asmt-meta">
              <div className="asmt-meta-item">
                <div className="asmt-meta-label">Assessment</div>
                <div className="asmt-meta-value">{info?.assessmentName}</div>
              </div>
              <div className="asmt-meta-item">
                <div className="asmt-meta-label">Duration</div>
                <div className="asmt-meta-value">{info?.durationMinutes} minutes</div>
              </div>
            </div>
            <button className="asmt-start-btn" onClick={() => { setResumeMode(isResume); setAgreed(false); setPhase("rules"); }}>
              {isResume ? "Resume Assessment" : "Start Assessment"}
            </button>
            <p className="asmt-fs-note">You'll review the rules, then enter fullscreen{info?.security?.cameraMonitoring !== false ? " with your camera on" : ""}.</p>
          </div>
        </div>
      </div>
    );
  }

  // Rules page (must accept before proceeding)
  if (phase === "rules") {
    return (
      <div className="asmt-landing">
        <header className="asmt-top">
          <div className="asmt-brand"><BrandLogo className="asmt-logo-img" />M H FOUNDATION</div>
        </header>
        <div className="asmt-rules-body">
          <div className="asmt-rules-card">
            <div className="asmt-rules-head">
              <span className="asmt-rules-icon">⚠️</span>
              <div>
                <h1 className="asmt-rules-title">Assessment Instructions &amp; Rules</h1>
                <p className="asmt-rules-sub">M H FOUNDATION · {info?.durationMinutes} minutes</p>
              </div>
            </div>
            <ul className="asmt-rules-list">
              {RULES
                .filter(([icon]) => info?.security?.cameraMonitoring !== false || (icon !== "📷" && icon !== "🎥"))
                .map(([icon, text]) => (
                <li key={text} className="asmt-rule"><span className="asmt-rule-icon">{icon}</span><span>{text}</span></li>
              ))}
            </ul>
            {info?.security?.cameraMonitoring !== false && (
              <div className={`asmt-cam-status ${camReady ? "asmt-cam-status--ok" : camDenied ? "asmt-cam-status--err" : ""}`}>
                {camReady ? "🎥 Camera ready" : camDenied ? "⚠ Camera blocked — please allow camera access (required for this assessment)." : "🎥 Requesting camera access…"}
                {camDenied && <button className="asmt-cam-retry" onClick={() => startCamera()}>Retry camera</button>}
              </div>
            )}
            <label className="asmt-agree">
              <input type="checkbox" checked={agreed} onChange={e => setAgreed(e.target.checked)} />
              <span>I have read and understood all assessment instructions.</span>
            </label>
            {gateMsg && <div className="asmt-gate-err">{gateMsg}</div>}
            <div className="asmt-rules-actions">
              <button className="asmt-btn-ghost" onClick={() => { stopCamera(); setPhase(resumeMode ? "resume" : "ready"); }}>Back</button>
              <button className="asmt-start-btn" style={{ flex: 1 }} disabled={!agreed} onClick={enterAndStart}>
                Proceed to Assessment
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // Gate — fullscreen confirmed → camera + MANDATORY face verification
  if (phase === "gate") {
    const failMsg = verifyMsg && verifyStatus === "scanning" ? verifyMsg : "";
    const title =
      verifyStatus === "verified"     ? "Identity Verified" :
      verifyStatus === "nocam"        ? "Camera Required" :
      verifyStatus === "detectorfail" ? "Verification Unavailable" :
      verifyStatus === "loading"      ? "Starting verification…" :
      faceCount === 1                 ? "Hold still…" :
                                        "Verifying identity…";
    const sub =
      verifyStatus === "verified"     ? "Loading your assessment…" :
      verifyStatus === "nocam"        ? "Camera access is required to start this assessment." :
      verifyStatus === "detectorfail" ? "" :
      "Position your face clearly in the frame. Only you should be visible.";
    return (
      <div className="asmt-gate">
        <div className="asmt-gate-card">
          <BrandLogo className="asmt-gate-logo" />
          {verifyStatus !== "detectorfail" && (
            <div className="asmt-gate-video-wrap">
              {camOn ? <video ref={videoRef} className="asmt-gate-video" autoPlay playsInline muted />
                     : <div className="asmt-gate-nocam">📷</div>}
              {verifyStatus === "verified" && <div className="asmt-verified-overlay">✓</div>}
              {verifyStatus === "scanning" && faceCount != null && (
                <div className={`asmt-face-badge ${faceCount === 1 ? "ok" : "bad"}`}>
                  {faceCount === 1 ? "1 face" : faceCount === 0 ? "no face" : `${faceCount} faces`}
                </div>
              )}
            </div>
          )}
          {verifyStatus === "detectorfail" && <div className="asmt-center-icon" style={{ fontSize: 46 }}>🔒</div>}
          <h2 className="asmt-gate-title">{title}</h2>
          {sub && <p className="asmt-gate-sub">{sub}</p>}
          {failMsg && <div className="asmt-gate-err" style={{ marginTop: 14 }}>{failMsg}</div>}

          {verifyStatus === "detectorfail" && (
            <>
              <div className="asmt-gate-err" style={{ marginTop: 14, textAlign: "center" }}>
                Identity verification service unavailable.<br />
                Please refresh the page and try again.<br />
                If the issue persists, contact the assessment administrator.
              </div>
              <div style={{ display: "flex", gap: 12, marginTop: 16, justifyContent: "center" }}>
                <button className="asmt-start-btn" style={{ flex: 1 }} onClick={retryVerification}>Retry</button>
                <button className="asmt-btn-ghost" onClick={exitAssessment}>Exit</button>
              </div>
            </>
          )}
          {verifyStatus === "nocam" && (
            <div style={{ display: "flex", gap: 12, marginTop: 16, justifyContent: "center" }}>
              <button className="asmt-start-btn" style={{ flex: 1 }} onClick={retryVerification}>Allow Camera &amp; Retry</button>
              <button className="asmt-btn-ghost" onClick={exitAssessment}>Exit</button>
            </div>
          )}
        </div>
      </div>
    );
  }

  // ── Quiz ──
  if (phase !== "quiz" || !questions.length) return null;
  const q = questions[curQ];
  const curSection = sections.find(s => s.idxs.includes(curQ)) || sections[0];
  const danger = timeLeft <= 60;
  const isLast = curQ === questions.length - 1;

  const go = (idx) => { if (idx >= 0 && idx < questions.length) setCurQ(idx); };
  const setAns = (i) => setAnswers(a => ({ ...a, [q.id]: i }));
  const clearAns = () => setAnswers(a => { const n = { ...a }; delete n[q.id]; return n; });
  const toggleReviewNext = () => {
    setReview(r => { const n = new Set(r); n.add(q.id); return n; });
    setTimeout(() => go(curQ + 1), 0);
  };
  const saveNext = () => go(curQ + 1);

  // Submission summary
  const answeredCount  = Object.keys(answers).length;
  const reviewIdsArr   = [...review];
  const answeredReview = reviewIdsArr.filter(id => answers[id] != null).length;
  const reviewOnly     = reviewIdsArr.length - answeredReview;
  const unanswered     = questions.length - answeredCount;
  const maxViol        = info?.securityConfig?.maxViolations || MAX_VIOLATIONS; // per-drive config
  const remainingViol  = Math.max(0, maxViol - violCount);
  const lastChance     = remainingViol === 1;

  return (
    <div className="qp-root">
      {showViol && <ViolationModal count={violCount} max={maxViol} reason={violReason} onDismiss={dismissViolation} />}
      {showRules && <RulesModal onClose={() => setShowRules(false)} />}

      {showConf && (
        <div className="qp-overlay" onClick={() => setShowConf(false)}>
          <div className="qp-modal asmt-submit-modal" onClick={e => e.stopPropagation()}>
            <h3>Submit Assessment?</h3>
            <div className="asmt-summary-grid">
              <div className="asmt-sum-item"><span>Total Questions</span><strong>{questions.length}</strong></div>
              <div className="asmt-sum-item asmt-sum--ok"><span>Answered</span><strong>{answeredCount}</strong></div>
              <div className="asmt-sum-item asmt-sum--warn"><span>Unanswered</span><strong>{unanswered}</strong></div>
              <div className="asmt-sum-item asmt-sum--rev"><span>Marked for Review</span><strong>{reviewOnly}</strong></div>
              <div className="asmt-sum-item asmt-sum--rev"><span>Answered &amp; Review</span><strong>{answeredReview}</strong></div>
            </div>
            <p className="asmt-sum-ask">Are you sure you want to submit? This cannot be undone.</p>
            <div className="qp-modal-btns">
              <button className="qp-modal-cancel" onClick={() => setShowConf(false)}>Review Assessment</button>
              <button className="qp-modal-confirm" onClick={() => { setShowConf(false); doSubmit({}); }}>Submit Final</button>
            </div>
          </div>
        </div>
      )}

      {/* Connection-lost banner — timer keeps running locally; answers auto-resync */}
      {!online && (
        <div className="asmt-net-banner">⚠ Connection Lost — your timer keeps running and answers are saved locally. They will sync automatically when you reconnect.</div>
      )}
      {/* Live face-presence warning (non-counting) */}
      {online && faceWarn && (
        <div className="asmt-net-banner" style={{ background: "#b45309" }}>👤 {faceWarn}</div>
      )}

      {/* Floating proctoring panel: webcam (never stored). Identity moved to the
          header avatar button (top-right) — see .asmt-id-wrap. */}
      {camOn && (
        <div className="asmt-cam-float">
          <video ref={videoRef} autoPlay playsInline muted />
          <span className="asmt-cam-dot" /> LIVE
        </div>
      )}

      {/* Corporate header */}
      <header className="qp-header asmt-corp-header">
        <div className="qp-header-inner">
          <div className="qp-brand">
            <BrandLogo className="asmt-header-logo" />
            <div>
              <div className="qp-brand-title">M H FOUNDATION</div>
              <div className="qp-brand-welcome">{info?.assessmentName}</div>
            </div>
          </div>
          <div className="qp-header-right">
            <button className="asmt-rules-btn" onClick={() => setShowRules(true)}>📋 View Rules</button>
            <div className="asmt-save-ind" title={lastSaved ? `Last saved at ${lastSaved.toLocaleTimeString()}` : ""}>
              {saveState === "saving" ? <span className="asmt-save-dot asmt-save-dot--saving" /> : <span className="asmt-save-dot asmt-save-dot--saved" />}
              {saveState === "saving" ? "Saving…" : lastSaved ? `Saved ${lastSaved.toLocaleTimeString()}` : "Saved"}
            </div>
            <div className={`asmt-viol-counter ${lastChance ? "asmt-viol-counter--danger" : ""}`}>
              Violations {violCount}/{maxViol} · {remainingViol} left
            </div>
            <div className={`qp-timer ${danger ? "qp-timer--danger" : ""}`}>⏱ {fmtTime(timeLeft)}</div>
            <div className="asmt-id-wrap">
              <button className="asmt-id-btn" onClick={() => setShowId(v => !v)} title="Your details" aria-label="Your details">
                {(info?.name || "?").charAt(0).toUpperCase()}
              </button>
              {showId && (
                <>
                  <div className="asmt-id-backdrop" onClick={() => setShowId(false)} />
                  <div className="asmt-id-pop">
                    <div className="asmt-id-pop-name">{info?.name}</div>
                    <div className="asmt-id-pop-row"><span>College</span>{info?.college || "—"}</div>
                    <div className="asmt-id-pop-row"><span>Email</span>{info?.email || "—"}</div>
                  </div>
                </>
              )}
            </div>
          </div>
        </div>
      </header>

      {/* Section tabs */}
      <div className="qp-sec-tabs">
        {sections.map(s => {
          const active = s.name === curSection?.name;
          const st = sectionStats(s);
          return (
            <button key={s.name} className={`qp-sec-tab ${active ? "qp-sec-tab--active" : ""}`}
              onClick={() => go(s.idxs[0])}>
              {s.label} <span className="qp-sec-tab-count">{st.answered}/{st.total}</span>
            </button>
          );
        })}
      </div>

      <div className="qp-body">
        <div className="qp-main">
          <div className="qp-q-panel">
            <div className="qp-q-panel-head">
              <div className="qp-q-sec-badge">{curSection?.label} · Q{curSection ? curSection.idxs.indexOf(curQ) + 1 : curQ + 1}</div>
            </div>
            <div className="qp-q-text">{q?.text}</div>
            <div className="qp-opts">
              {(q?.options || []).map((opt, i) => {
                const sel = answers[q.id] === i;
                return (
                  <div key={i} className={`qp-opt ${sel ? "qp-opt--sel" : ""}`} onClick={() => setAns(i)}>
                    <div className={`qp-opt-letter ${sel ? "qp-opt-letter--sel" : ""}`}>{OPTS[i]}</div>
                    <span className="qp-opt-text">{opt}</span>
                    {sel && <div className="qp-opt-check">✓</div>}
                  </div>
                );
              })}
            </div>

            {/* Action buttons */}
            <div className="asmt-actions">
              <button className="asmt-act asmt-act--ghost" onClick={clearAns} disabled={answers[q.id] == null}>Clear Response</button>
              <button className="asmt-act asmt-act--review" onClick={toggleReviewNext}>Mark for Review &amp; Next</button>
              <div className="asmt-actions-spacer" />
              <button className="asmt-act asmt-act--ghost" onClick={() => go(curQ - 1)} disabled={curQ === 0}>Previous</button>
              {isLast
                ? <button className="asmt-act asmt-act--primary" onClick={() => setShowConf(true)}>Submit</button>
                : <button className="asmt-act asmt-act--primary" onClick={saveNext}>Save &amp; Next</button>}
            </div>
          </div>

          {/* Right rail: section overview + palette */}
          <div className="qp-sidebar">
            <div className="asmt-overview">
              <div className="qp-sidebar-title">Section Overview</div>
              {sections.map(s => {
                const st = sectionStats(s);
                const active = s.name === curSection?.name;
                return (
                  <div key={s.name} className={`asmt-ov-row ${active ? "asmt-ov-row--active" : ""}`} onClick={() => go(s.idxs[0])}>
                    <div className="asmt-ov-name">{s.label}</div>
                    <div className="asmt-ov-stats">
                      <span title="Total">{st.total}</span>
                      <span className="asmt-ov-ans" title="Answered">●{st.answered}</span>
                      <span className="asmt-ov-un" title="Unanswered">●{st.unanswered}</span>
                      <span className="asmt-ov-rev" title="Review">●{st.review}</span>
                    </div>
                  </div>
                );
              })}
            </div>

            <div className="qp-sidebar-title" style={{ marginTop: 14 }}>{curSection?.label} — Palette</div>
            <div className="qp-dot-grid">
              {(curSection?.idxs || []).map(i => {
                const qid = questions[i].id;
                const st = qState(qid);
                return (
                  <button key={qid} className={`qp-dot qp-dot--${st} ${i === curQ ? "qp-dot--cur" : ""}`} onClick={() => go(i)}>
                    {curSection.idxs.indexOf(i) + 1}
                  </button>
                );
              })}
            </div>

            <div className="qp-legend">
              {PALETTE_LEGEND.map(([st, label]) => {
                const count = (curSection?.idxs || []).filter(i => qState(questions[i].id) === st).length;
                return (
                  <div key={st} className="qp-legend-item">
                    <span className={`qp-leg-dot qp-leg-dot--${st}`} />
                    <span>{label} <strong>({count})</strong></span>
                  </div>
                );
              })}
            </div>

            <button className="qp-submit-side-btn" onClick={() => setShowConf(true)}>Submit Assessment ✓</button>
          </div>
        </div>
      </div>
    </div>
  );
}
