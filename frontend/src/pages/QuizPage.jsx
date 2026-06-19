import React, { useState, useEffect, useRef, useCallback } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { getQuizConfig, startQuiz, autoSave, submitQuiz } from "../utils/api";
import "./QuizPage.css";

const fmtTime = (s) => `${Math.floor(s/60)}:${String(s%60).padStart(2,"0")}`;
const shuffle = (a) => { const b=[...a]; for(let i=b.length-1;i>0;i--){const j=Math.floor(Math.random()*(i+1));[b[i],b[j]]=[b[j],b[i]];} return b; };
const OPTS = ["A","B","C","D"];
const DEFAULT_SECTIONS_META = {
  aptitude:{label:"Aptitude",color:"#4F46E5",bg:"#EEF2FF"},
  logical: {label:"Logical Reasoning",color:"#7C3AED",bg:"#F5F3FF"},
  english: {label:"English",color:"#0891B2",bg:"#ECFEFF"}
};

const STATUS = {
  NOT_VISITED:"not-visited", NOT_ANSWERED:"not-answered",
  ANSWERED:"answered", REVIEW:"review", ANSWERED_REVIEW:"answered-review"
};

function getStatus(idx, visited, answers, review) {
  if (!visited.has(idx))           return STATUS.NOT_VISITED;
  const hasAns = answers[idx] != null;
  const hasRev = review.has(idx);
  if (hasAns && hasRev)            return STATUS.ANSWERED_REVIEW;
  if (hasAns)                      return STATUS.ANSWERED;
  if (hasRev)                      return STATUS.REVIEW;
  return STATUS.NOT_ANSWERED;
}

// Fullscreen helpers - graceful on mobile/unsupported browsers
function enterFullscreen() {
  const el = document.documentElement;
  const req = el.requestFullscreen || el.webkitRequestFullscreen || el.mozRequestFullScreen || el.msRequestFullscreen;
  if (req) req.call(el).catch(() => {});
}
function exitFullscreen() {
  const ex = document.exitFullscreen || document.webkitExitFullscreen || document.mozCancelFullScreen || document.msExitFullscreen;
  if (ex) ex.call(document).catch(() => {});
}
function isFullscreen() {
  return !!(document.fullscreenElement || document.webkitFullscreenElement || document.mozFullScreenElement || document.msFullscreenElement);
}

// Violation Modal - blocking, must be dismissed by user
function ViolationModal({ count, onDismiss }) {
  const MAX = 4;
  return (
    <div className="qp-viol-overlay">
      <div className="qp-viol-modal">
        <div className="qp-viol-icon-wrap">
          <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="#DC2626" strokeWidth="2">
            <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/>
          </svg>
        </div>
        <h2 className="qp-viol-title">Malpractice Detected</h2>
        <p className="qp-viol-sub">You exited fullscreen, switched tabs, or minimized the window. This is recorded as a violation.</p>
        <div className="qp-viol-count">
          <span className="qp-viol-num">{count}</span>
          <span className="qp-viol-of">/ {MAX}</span>
        </div>
        <div className="qp-viol-dots">
          {Array.from({length:MAX}).map((_,i)=>(
            <div key={i} className={`qp-viol-dot ${i < count ? "qp-viol-dot--filled":""}`}/>
          ))}
        </div>
        {count < MAX && (
          <p className="qp-viol-warn">{MAX - count} more violation{MAX - count !== 1 ? "s" : ""} will auto-submit your quiz.</p>
        )}
        <button className="qp-viol-btn" onClick={onDismiss}>
          I Understand - Continue Quiz
        </button>
      </div>
    </div>
  );
}

export default function QuizPage() {
  const location = useLocation();
  const navigate = useNavigate();
  const { user } = location.state || {};
  // fsTriggered = fullscreen already started from Ready page Start button
  // No fs-gate screen needed — fullscreen is already in progress

  const [phase,      setPhase]      = useState("loading");
  const [sectMeta,   setSectMeta]   = useState(DEFAULT_SECTIONS_META);
  const [questions,  setQuestions]  = useState([]);
  const [answers,    setAnswers]    = useState({});
  const [review,     setReview]     = useState(new Set());
  const [visited,    setVisited]    = useState(new Set());
  const [curQ,       setCurQ]       = useState(0);
  const [timeLeft,   setTimeLeft]   = useState(0);
  const [malCount,   setMalCount]   = useState(0);
  const [showViol,   setShowViol]   = useState(false);
  const [showConf,   setShowConf]   = useState(false);
  const [result,     setResult]     = useState(null);
  const [errMsg,     setErrMsg]     = useState("");
  const [section,    setSection]    = useState("all");

  const timerRef   = useRef(null);
  const submitted  = useRef(false);
  const answersRef = useRef({});
  const malRef     = useRef(0);
  const attemptRef = useRef(null);
  const configRef  = useRef(null);
  const timeRef    = useRef(0);

  useEffect(() => { answersRef.current = answers; }, [answers]);
  useEffect(() => { malRef.current = malCount; }, [malCount]);
  useEffect(() => { timeRef.current = timeLeft; }, [timeLeft]);

  // Mark current question as visited whenever it changes (during quiz)
  useEffect(() => {
    if (phase !== "quiz") return;
    setVisited(v => { const n = new Set(v); n.add(curQ); return n; });
  }, [curQ, phase]);

  // ── Load quiz ────────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!localStorage.getItem("quizToken")) { navigate("/", { replace:true }); return; }
    (async () => {
      try {
        const [cfgRes, startRes] = await Promise.all([getQuizConfig(), startQuiz()]);

        // Defensive: startQuiz might return alreadyCompleted at top level or in data
        const startPayload = startRes?.data || {};
        if (startPayload.alreadyCompleted) {
          setResult(startPayload);
          setPhase("result");
          return;
        }

        // Defensive: config data might be at res.data.data or res.data
        const raw = cfgRes?.data?.data || cfgRes?.data || {};
        configRef.current = raw;

        // Build dynamic section meta from config (supports custom sections)
        const dynMeta = {};
        const PALETTE = ["#4F46E5","#7C3AED","#0891B2","#059669","#D97706","#DC2626","#0EA5E9","#8B5CF6"];
        const BG_PALETTE = ["#EEF2FF","#F5F3FF","#ECFEFF","#ECFDF5","#FEF3C7","#FEF2F2","#F0F9FF","#F5F3FF"];
        (raw.sections||[]).forEach((sec, i) => {
          dynMeta[sec.name] = {
            label: sec.displayName || sec.name,
            color: sec.color || PALETTE[i % PALETTE.length],
            bg:    BG_PALETTE[i % BG_PALETTE.length],
          };
        });
        if (Object.keys(dynMeta).length) setSectMeta(prev => ({...prev, ...dynMeta}));

        // Build questions from sections
        const bySection = {};
        (raw.questions||[]).forEach(q => {
          if (!bySection[q.section]) bySection[q.section] = [];
          bySection[q.section].push(q);
        });
        const shuffled = [];
        (raw.sections||[]).forEach(sec => {
          const pool  = bySection[sec.name] || [];
          const picked = shuffle(pool).slice(0, sec.questionCount || pool.length);
          picked.forEach(q => {
            const optsWI = q.options.map((t,oi) => ({t,oi}));
            const sOpts  = shuffle(optsWI);
            shuffled.push({
              ...q,
              displayOptions: sOpts.map(o=>o.t),
              shuffledCorrect: sOpts.findIndex(o=>o.oi===q.correctIndex),
            });
          });
        });

        setQuestions(shuffled);
        setTimeLeft((raw.timeLimitMinutes || 40) * 60);
        // Defensive: attemptId might be at data.attemptId or data.data.attemptId
        attemptRef.current = startPayload.attemptId || startPayload.data?.attemptId || null;
        setVisited(new Set([0]));
        // Go straight to quiz — fullscreen already triggered by Start button on Ready page
        setPhase("quiz");
      } catch (err) {
        if (err.alreadyCompleted) { setResult(err); setPhase("result"); return; }
        setErrMsg(err.message || "Failed to load quiz."); setPhase("error");
      }
    })();
  }, []);

  // ── Timer ────────────────────────────────────────────────────────────────────
  useEffect(() => {
    if (phase !== "quiz") return;
    timerRef.current = setInterval(() => {
      setTimeLeft(t => {
        if (t <= 1) { clearInterval(timerRef.current); doSubmit(true); return 0; }
        return t - 1;
      });
    }, 1000);
    return () => clearInterval(timerRef.current);
  }, [phase]);

  // ── Auto-save every 10s ──────────────────────────────────────────────────────
  useEffect(() => {
    if (phase !== "quiz") return;
    const iv = setInterval(() => {
      autoSave({ attemptId: attemptRef.current, malpracticeCount: malRef.current }).catch(()=>{});
    }, 10000);
    return () => clearInterval(iv);
  }, [phase]);

  // ── Malpractice + fullscreen detection (only during quiz) ────────────────────
  useEffect(() => {
    if (phase !== "quiz") return;
    const trigger = () => {
      if (submitted.current) return;
      const nc = malRef.current + 1;
      setMalCount(nc);
      if (nc >= 4) { doSubmit(false, true); return; }
      setShowViol(true);
    };
    const onVis   = () => { if (document.hidden) trigger(); };
    const onBlur  = () => trigger();
    const onFsChg = () => { if (!isFullscreen() && !submitted.current) trigger(); };
    document.addEventListener("visibilitychange", onVis);
    window.addEventListener("blur", onBlur);
    document.addEventListener("fullscreenchange", onFsChg);
    document.addEventListener("webkitfullscreenchange", onFsChg);
    return () => {
      document.removeEventListener("visibilitychange", onVis);
      window.removeEventListener("blur", onBlur);
      document.removeEventListener("fullscreenchange", onFsChg);
      document.removeEventListener("webkitfullscreenchange", onFsChg);
    };
  }, [phase]);

  // Dismiss violation modal + re-enter fullscreen (user gesture = button click)
  const dismissViolation = useCallback(() => {
    setShowViol(false);
    enterFullscreen();
  }, []);

  // ── Submit ────────────────────────────────────────────────────────────────────
  const doSubmit = useCallback(async (timedOut=false) => {
    if (submitted.current) return;
    submitted.current = true;
    clearInterval(timerRef.current);
    if (isFullscreen()) exitFullscreen();
    setPhase("submitting");
    const cfg = configRef.current;
    const timeTaken = cfg ? cfg.timeLimitMinutes*60 - timeRef.current : 0;
    const ans = Object.entries(answersRef.current).map(([idx, selShuffled]) => {
      const q = questions[parseInt(idx)];
      if (!q) return null;
      const selectedOpt = q.displayOptions[selShuffled];
      const origIdx = q.options.indexOf(selectedOpt);
      return { questionId: q._id, selectedIndex: origIdx >= 0 ? origIdx : selShuffled };
    }).filter(Boolean);
    try {
      const res = await submitQuiz({
        attemptId: attemptRef.current, answers: ans,
        timeTakenSeconds: timeTaken, timedOut, malpracticeCount: malRef.current
      });
      setResult(res.data.data || res.data);
      setPhase("result");
    } catch (err) {
      setErrMsg(err.message || "Submission failed."); setPhase("error");
    }
  }, [questions]);

  const goTo = useCallback((idx) => {
    setCurQ(idx);
    setVisited(v => { const n = new Set(v); n.add(idx); return n; });
  }, []);

  const toggleReview = useCallback(() => {
    setReview(r => { const n = new Set(r); if (n.has(curQ)) n.delete(curQ); else n.add(curQ); return n; });
  }, [curQ]);

  // ── Phase renders ────────────────────────────────────────────────────────────
  if (phase === "loading") return (
    <div className="qp-center">
      <div className="qp-spinner-lg"/>
      <h2>Loading Quiz...</h2>
      <p>Preparing your personalised question set</p>
    </div>
  );
  if (phase === "submitting") return (
    <div className="qp-center">
      <div className="qp-spinner-lg"/>
      <h2>Submitting Quiz...</h2>
      <p>Please wait, do not close this window</p>
    </div>
  );
  if (phase === "error") return (
    <div className="qp-center">
      <div className="qp-err-icon">!</div>
      <h2>Something went wrong</h2><p>{errMsg}</p>
      <button onClick={() => navigate("/")}>Go Home</button>
    </div>
  );

  // ── Result ───────────────────────────────────────────────────────────────────
  if (phase === "result") return (
    <div className="qp-result-root">
      <div className="qp-result-card">
        <div className="qp-result-icon-wrap">
          <div className="qp-result-checkmark">&#x2713;</div>
        </div>
        <h1 className="qp-result-title">Quiz Submitted!</h1>
        <p className="qp-result-name">{user?.name || "Student"}</p>
        <div className="qp-result-divider"/>
        <div className="qp-result-msg-box">
          <div className="qp-result-msg-icon">&#x1F3EB;</div>
          <h3 className="qp-result-msg-title">Results Will Be Announced Soon</h3>
          <p className="qp-result-msg-text">
            Your responses have been recorded successfully. Results will be declared
            by <strong>M H Foundation</strong> through official channels.
          </p>
        </div>
        <div className="qp-result-info-grid">
          <div className="qp-result-info-item">
            <div className="qp-result-info-icon">&#x1F4E7;</div>
            <div>
              <div className="qp-result-info-title">Email Notification</div>
              <div className="qp-result-info-sub">Check your registered email for updates</div>
            </div>
          </div>
          <div className="qp-result-info-item">
            <div className="qp-result-info-icon">&#x1F4E2;</div>
            <div>
              <div className="qp-result-info-title">Official Announcement</div>
              <div className="qp-result-info-sub">Follow MHA official channels for results</div>
            </div>
          </div>
        </div>
        <div className="qp-result-thanks">
          <div className="qp-result-thanks-icon">&#x1F389;</div>
          <h2 className="qp-result-thanks-title">Thank You for Attending!</h2>
          <p className="qp-result-thanks-sub">
            Thank you for participating in the assessment conducted by
            <strong> M H Foundation, M H Foundation</strong>.
            We appreciate your time and effort. Best of luck!
          </p>
        </div>
        <button className="qp-home-btn" onClick={() => { localStorage.removeItem("quizToken"); navigate("/"); }}>
          Back to Home
        </button>
      </div>
    </div>
  );

  // ── Quiz UI ───────────────────────────────────────────────────────────────────
  if (phase !== "quiz" || !questions.length) return null;

  const q           = questions[curQ];
  const answeredCnt = Object.keys(answers).length;
  const reviewCnt   = review.size;
  const danger      = timeLeft <= 60;
  const progress    = ((curQ + 1) / questions.length) * 100;
  const secMeta     = sectMeta[q?.section] || { label: q?.section, color:"#4F46E5", bg:"#EEF2FF" };
  const curStatus   = getStatus(curQ, visited, answers, review);
  const sectionTabs = ["all", ...new Set(questions.map(q => q.section))];
  const statusCounts = { answered:0, "not-answered":0, review:0, "answered-review":0, "not-visited":0 };
  questions.forEach((_,i) => { statusCounts[getStatus(i,visited,answers,review)]++; });

  return (
    <div className="qp-root">
      {showViol && <ViolationModal count={malCount} onDismiss={dismissViolation}/>}

      {showConf && (
        <div className="qp-overlay" onClick={() => setShowConf(false)}>
          <div className="qp-modal" onClick={e => e.stopPropagation()}>
            <h3>Submit Quiz?</h3>
            <p>You have answered <strong>{answeredCnt}</strong> of <strong>{questions.length}</strong> questions.</p>
            {answeredCnt < questions.length && <p className="qp-modal-warn">&#x26A0; {questions.length - answeredCnt} question(s) unanswered.</p>}
            {reviewCnt > 0 && <p className="qp-modal-warn">&#x1F7E3; {reviewCnt} marked for review.</p>}
            <div className="qp-modal-btns">
              <button className="qp-modal-cancel" onClick={() => setShowConf(false)}>Review Answers</button>
              <button className="qp-modal-confirm" onClick={() => { setShowConf(false); doSubmit(false); }}>Submit Now</button>
            </div>
          </div>
        </div>
      )}

      <header className="qp-header">
        <div className="qp-header-inner">
          <div className="qp-brand">
            <div className="qp-brand-logo">M</div>
            <div>
              <div className="qp-brand-title">M H Foundation</div>
              <div className="qp-brand-welcome">Welcome, <strong>{user?.name}</strong></div>
            </div>
          </div>
          <div className="qp-header-right">
            {malCount > 0 && <div className="qp-mal-badge">&#x26A0; {malCount}/4 violations</div>}
            <div className="qp-q-count">Q {curQ+1} / {questions.length}</div>
            <button className="qp-fs-btn" onClick={() => enterFullscreen()} title="Enter Fullscreen">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                <polyline points="15 3 21 3 21 9"/><polyline points="9 21 3 21 3 15"/>
                <line x1="21" y1="3" x2="14" y2="10"/><line x1="3" y1="21" x2="10" y2="14"/>
              </svg>
            </button>
            <div className={`qp-timer ${danger ? "qp-timer--danger" : ""}`}>
              <span>&#x23F1;</span>{fmtTime(timeLeft)}
            </div>
          </div>
        </div>
        <div className="qp-progress-bar">
          <div className="qp-progress-fill" style={{ width:`${progress}%` }}/>
        </div>
      </header>

      <div className="qp-sec-tabs">
        {sectionTabs.map(s => {
          const meta = s === "all" ? {label:"All",color:"#4F46E5"} : (sectMeta[s]||{label:s,color:"#4F46E5"});
          const isActive = section === s;
          return (
            <button key={s}
              className={`qp-sec-tab ${isActive?"qp-sec-tab--active":""}`}
              style={isActive ? {background:meta.color,color:"#fff",borderColor:meta.color} : {}}
              onClick={() => { setSection(s); if(s!=="all"){ const fi=questions.findIndex(q=>q.section===s); if(fi>=0) goTo(fi); } }}>
              {meta.label}
            </button>
          );
        })}
      </div>

      <div className="qp-body">
        <div className="qp-main">
          <div className="qp-q-panel">
            <div className="qp-q-panel-head">
              <div className="qp-q-sec-badge" style={{background:secMeta.bg,color:secMeta.color,borderColor:secMeta.color}}>
                {secMeta.label} - Question {curQ+1}
              </div>
              <div className={`qp-status-pill qp-status-pill--${curStatus}`}>
                {{"not-visited":"Not Visited","not-answered":"Not Answered","answered":"Answered","review":"Marked for Review","answered-review":"Answered + Review"}[curStatus]}
              </div>
            </div>

            <div className="qp-q-text">{q?.text}</div>

            <div className="qp-opts">
              {(q?.displayOptions||[]).map((opt, i) => {
                const sel = answers[curQ] === i;
                return (
                  <div key={i} className={`qp-opt ${sel?"qp-opt--sel":""}`}
                    onClick={() => setAnswers(a => ({...a,[curQ]:i}))}>
                    <div className={`qp-opt-letter ${sel?"qp-opt-letter--sel":""}`}>{OPTS[i]}</div>
                    <span className="qp-opt-text">{opt}</span>
                    {sel && <div className="qp-opt-check">&#x2713;</div>}
                  </div>
                );
              })}
            </div>

            <div className="qp-action-row">
              <button className={`qp-review-btn ${review.has(curQ)?"qp-review-btn--active":""}`} onClick={toggleReview}>
                {review.has(curQ) ? "Remove Review Mark" : "Mark for Review"}
              </button>
              {answers[curQ] != null && (
                <button className="qp-clear-btn" onClick={() => setAnswers(a => { const n={...a}; delete n[curQ]; return n; })}>
                  Clear Answer
                </button>
              )}
            </div>

            <div className="qp-q-nav">
              <button className="qp-nav-btn" disabled={curQ===0} onClick={() => goTo(curQ-1)}>&#x2190; Prev</button>
              <div className="qp-nav-center">
                <span className="qp-answered-txt"><strong>{answeredCnt}</strong>/{questions.length} answered</span>
              </div>
              {curQ < questions.length - 1
                ? <button className="qp-nav-btn qp-nav-btn--next" onClick={() => goTo(curQ+1)}>Next &#x2192;</button>
                : <button className="qp-nav-btn qp-nav-btn--submit" onClick={() => setShowConf(true)}>Submit Quiz &#x2713;</button>
              }
            </div>
          </div>

          <div className="qp-sidebar">
            <div className="qp-sidebar-title">Question Palette</div>
            <div className="qp-dot-grid">
              {questions.map((_, i) => {
                const st = getStatus(i, visited, answers, review);
                return (
                  <button key={i}
                    className={`qp-dot qp-dot--${st} ${i===curQ?"qp-dot--cur":""}`}
                    onClick={() => goTo(i)}
                    title={`Q${i+1}`}>
                    {i+1}
                  </button>
                );
              })}
            </div>
            <div className="qp-legend">
              <div className="qp-legend-item"><span className="qp-leg-dot qp-leg-dot--answered"/><span>Answered <strong>({statusCounts.answered})</strong></span></div>
              <div className="qp-legend-item"><span className="qp-leg-dot qp-leg-dot--not-answered"/><span>Not Answered <strong>({statusCounts["not-answered"]})</strong></span></div>
              <div className="qp-legend-item"><span className="qp-leg-dot qp-leg-dot--not-visited"/><span>Not Visited <strong>({statusCounts["not-visited"]})</strong></span></div>
              <div className="qp-legend-item"><span className="qp-leg-dot qp-leg-dot--review"/><span>For Review <strong>({statusCounts.review})</strong></span></div>
              <div className="qp-legend-item"><span className="qp-leg-dot qp-leg-dot--answered-review"/><span>Ans+Review <strong>({statusCounts["answered-review"]})</strong></span></div>
            </div>
            <button className="qp-submit-side-btn" onClick={() => setShowConf(true)}>Submit Quiz &#x2713;</button>
          </div>
        </div>
      </div>
    </div>
  );
}
