import "./QuizReadyPage.css";
import React, { useState } from "react";
import { useNavigate, useLocation } from "react-router-dom";

const SECTIONS_DISPLAY = [
  { name:"Aptitude",          icon:"🧮", count:20, color:"#4F46E5", bg:"#EEF2FF" },
  { name:"Logical Reasoning", icon:"🧩", count:20, color:"#7C3AED", bg:"#F5F3FF" },
  { name:"English",           icon:"📝", count:20, color:"#0891B2", bg:"#ECFEFF" },
];

const TNC_TEXT = `TERMS & CONDITIONS — Mandi Hariyanna Academy Online Assessment

1. ELIGIBILITY
   This quiz is intended for registered candidates only. Each candidate may attempt the quiz only once.

2. CONDUCT
   You must attempt the quiz in a distraction-free environment. Any form of cheating, malpractice, or use of unfair means will result in automatic disqualification.

3. MALPRACTICE MONITORING
   The system monitors tab-switching, window blur, and fullscreen exit events. Four (4) such events will result in automatic quiz submission with your current responses.

4. FULLSCREEN REQUIREMENT
   The quiz must be attempted in fullscreen mode. Exiting fullscreen will be recorded as a violation.

5. TECHNICAL REQUIREMENTS
   You must have a stable internet connection. Use a laptop or desktop for best experience. Mobile devices are not recommended.

6. RESULTS
   Results will be announced by Mandi Hariyanna Academy through official channels. The academy's decision regarding scores and results shall be final and binding.

7. PRIVACY
   Your personal information submitted during registration will be used solely for the purpose of this assessment. It will not be shared with third parties.

8. ONE-TIME ATTEMPT
   This quiz can be attempted only once. Once submitted (manually or automatically), no re-attempt will be granted.

9. VALIDITY
   Your quiz link is unique to you and is non-transferable. Sharing the link with others is strictly prohibited.

10. ACCEPTANCE
    By clicking "I Agree", you confirm that you have read, understood, and agree to abide by all the above terms and conditions.

— Mandi Harish Foundation®`;

function TNCModal({ onClose }) {
  return (
    <div className="tnc-overlay" onClick={onClose}>
      <div className="tnc-modal" onClick={e=>e.stopPropagation()}>
        <div className="tnc-modal-head">
          <h3>Terms &amp; Conditions</h3>
          <button className="tnc-close-btn" onClick={onClose}>✕</button>
        </div>
        <div className="tnc-modal-body">
          <pre className="tnc-text">{TNC_TEXT}</pre>
        </div>
        <button className="tnc-close-main-btn" onClick={onClose}>Close</button>
      </div>
    </div>
  );
}

export default function QuizReadyPage() {
  const navigate  = useNavigate();
  const location  = useLocation();
  const { user }  = location.state || {};
  const [agreed,  setAgreed]   = useState(false);
  const [triedStart, setTriedStart] = useState(false);
  const [showTNC, setShowTNC]  = useState(false);

  // Fullscreen helpers
  const enterFullscreen = () => {
    const el = document.documentElement;
    const req = el.requestFullscreen || el.webkitRequestFullscreen || el.mozRequestFullScreen || el.msRequestFullscreen;
    if (req) req.call(el).catch(() => {});
  };

  const handleStart = () => {
    if (!agreed) { setTriedStart(true); return; }
    // This button click IS the user gesture — fullscreen works here on all browsers
    enterFullscreen();
    navigate("/quiz", { state: { user, fsTriggered: true } });
  };

  // Guard: if user state is missing (e.g. page refresh), redirect to register
  // with token still in localStorage the register page will auto-redirect back
  if (!user || !user.name) {
    const token = localStorage.getItem("quizToken");
    if (!token) { navigate("/", { replace: true }); return null; }
    // Token exists but state lost — go to register which will re-verify and redirect
    navigate("/", { replace: true });
    return null;
  }

  return (
    <div className="ready-root">
      {showTNC && <TNCModal onClose={()=>setShowTNC(false)}/>}

      <header className="ready-header">
        <div className="ready-brand">
          <div className="ready-logo">M</div>
          <div>
            <div className="ready-brand-name">Mandi Hariyanna Academy</div>
            <div className="ready-brand-sub">Mandi Harish Foundation®</div>
          </div>
        </div>
      </header>

      <div className="ready-body">
        {/* Welcome */}
        <div className="ready-welcome">
          <div className="ready-avatar">{user.name?.charAt(0)?.toUpperCase()}</div>
          <div>
            <h1 className="ready-name">Welcome, {user.name}!</h1>
            <p className="ready-info">
              {user.email} &nbsp;·&nbsp; {user.college} &nbsp;·&nbsp; {user.rollNo}
            </p>
          </div>
        </div>

        <div className="ready-card">
          <div className="ready-card-head">
            <span className="ready-badge">📋 Quiz Instructions</span>
            <h2 className="ready-card-title">Before You Begin</h2>
          </div>

          {/* Sections */}
          <div className="ready-sections">
            {SECTIONS_DISPLAY.map(s=>(
              <div key={s.name} className="ready-section" style={{borderColor:s.color,background:s.bg}}>
                <div className="ready-section-icon">{s.icon}</div>
                <div>
                  <div className="ready-section-name" style={{color:s.color}}>{s.name}</div>
                  <div className="ready-section-count">{s.count} Questions · 1 Mark each</div>
                </div>
              </div>
            ))}
          </div>

          {/* Rules */}
          <div className="ready-rules">
            {[
              ["⏱","Time Limit","Timer is enforced by the server. Quiz auto-submits when time runs out."],
              ["🖥️","Fullscreen Required","Quiz enters fullscreen automatically. Exiting fullscreen counts as a violation."],
              ["⚠️","Anti-Malpractice","Tab switch, window blur, and fullscreen exit are monitored. 4 violations = auto-submit."],
              ["📌","One Attempt","You can only take this quiz once. Answers are final upon submission."],
              ["💾","Auto-Save","Your progress is auto-saved every 10 seconds."],
              ["🌐","Stable Connection","Ensure a stable internet connection throughout the quiz."],
            ].map(([icon,title,desc])=>(
              <div key={title} className="ready-rule">
                <div className="ready-rule-icon">{icon}</div>
                <div><strong>{title}</strong><span>{desc}</span></div>
              </div>
            ))}
          </div>

          {/* Summary */}
          <div className="ready-summary">
            <div className="ready-sum-item"><div className="ready-sum-num">60</div><div className="ready-sum-lbl">Questions</div></div>
            <div className="ready-sum-sep"/>
            <div className="ready-sum-item"><div className="ready-sum-num">40</div><div className="ready-sum-lbl">Minutes</div></div>
            <div className="ready-sum-sep"/>
            <div className="ready-sum-item"><div className="ready-sum-num">60</div><div className="ready-sum-lbl">Total Marks</div></div>
          </div>

          {/* T&C */}
          <div className="ready-tnc-box">
            <div className="ready-tnc-scroll">
              <pre className="ready-tnc-preview">{TNC_TEXT.substring(0, 400)}…</pre>
            </div>
            <button className="ready-tnc-link" onClick={()=>setShowTNC(true)}>
              📄 Read full Terms &amp; Conditions →
            </button>
            <label className={`ready-tnc-label ${triedStart && !agreed ? "ready-tnc-label--warn" : ""}`}>
              <input
                type="checkbox"
                className="ready-tnc-check"
                checked={agreed}
                onChange={e => { setAgreed(e.target.checked); if(e.target.checked) setTriedStart(false); }}
              />
              <span>I have read and agree to the <strong>Terms &amp; Conditions</strong></span>
            </label>
            {triedStart && !agreed && (
              <div className="ready-tnc-warn">
                ⚠ Please tick the checkbox above to agree to the Terms &amp; Conditions before starting.
              </div>
            )}
          </div>

          <button
            className={`ready-start-btn ${!agreed ? "ready-start-btn--disabled" : ""}`}
            onClick={handleStart}
          >
            {agreed ? "Start Quiz Now →" : "🔒 Agree to T&C to Start"}
          </button>
          <p className="ready-start-note">
            By clicking Start, you enter fullscreen and the quiz timer begins immediately.
          </p>
        </div>
      </div>
    </div>
  );
}
