import React, { useState, useEffect } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import { register, verifyToken } from "../utils/api";
import "./RegisterPage.css";

/* ── Motivational quotes – rotates each visit ──────────────── */
const QUOTES = [
  { text: "The secret of getting ahead is getting started.", author: "Mark Twain" },
  { text: "Success is the sum of small efforts repeated day in and day out.", author: "Robert Collier" },
  { text: "Believe you can and you're halfway there.", author: "Theodore Roosevelt" },
  { text: "An investment in knowledge pays the best interest.", author: "Benjamin Franklin" },
  { text: "The expert in anything was once a beginner.", author: "Helen Hayes" },
];
const quote = QUOTES[Math.floor(Date.now() / 86400000) % QUOTES.length];

/* ── Quiz sections ─────────────────────────────────────────── */
const SECTIONS = [
  "Quantitative Aptitude",
  "Analytical Reasoning",
  "Logical / Critical Reasoning",
  "Technical Aptitude",
  "English / Verbal Ability",
  "Scenario-Based / Behavioral",
];

/* ── Instructions ──────────────────────────────────────────── */
const INSTRUCTIONS = [
  {
    icon: "📋",
    color: "gold",
    label: "6 Sections",
    desc: "Covers all key competency areas tested by top recruiters.",
  },
  {
    icon: "⏱",
    color: "cyan",
    label: "Auto-Submit When Time Is Up",
    desc: "The quiz submits automatically once the timer reaches zero.",
  },
  {
    icon: "🖥️",
    color: "purple",
    label: "Fullscreen Mode Required",
    desc: "The assessment runs in mandatory fullscreen to maintain integrity.",
  },
  {
    icon: "🛡️",
    color: "red",
    label: "Anti-Malpractice Monitoring",
    desc: "Tab-switching and window-blur events are tracked throughout the quiz.",
  },
];

/* ── Floating background icons ─────────────────────────────── */
const FLOAT_ICONS = ["📐", "📊", "🔢", "🧠", "✏️", "📝", "⚡"];

export default function RegisterPage() {
  const navigate  = useNavigate();
  const location  = useLocation();

  const [form, setForm] = useState({
    name: "", email: "", college: "", rollNo: "", phone: "",
  });
  const [errors,   setErrors]   = useState({});
  const [loading,  setLoading]  = useState(false);
  const [success,  setSuccess]  = useState(false);
  const [apiErr,   setApiErr]   = useState("");
  const [checking, setChecking] = useState(true);

  // ── Auto-redirect if already logged in ────────────────────
  useEffect(() => {
    const token = localStorage.getItem("quizToken");
    if (!token) { setChecking(false); return; }
    verifyToken()
      .then((res) => {
        const user = res?.data?.data || {};
        navigate("/ready", { state: { user, token }, replace: true });
      })
      .catch(() => {
        localStorage.removeItem("quizToken");
        setChecking(false);
      });
  }, []);

  // ── Token in URL (legacy) ──────────────────────────────────
  useEffect(() => {
    const t = new URLSearchParams(location.search).get("token");
    if (!t) return;
    localStorage.setItem("quizToken", t);
    verifyToken()
      .then((res) => {
        const user = res?.data?.data || {};
        navigate("/ready", { state: { user, token: t }, replace: true });
      })
      .catch(() => {
        localStorage.removeItem("quizToken");
        setChecking(false);
      });
  }, [location.search]);

  // ── Validation ─────────────────────────────────────────────
  const validate = () => {
    const e = {};
    if (!form.name.trim())    e.name    = "Name is required";
    if (!form.email.trim())   e.email   = "Email is required";
    else if (!/\S+@\S+\.\S+/.test(form.email)) e.email = "Enter a valid email";
    if (!form.college.trim()) e.college = "College / institution is required";
    if (!form.rollNo.trim())  e.rollNo  = "Roll number is required";
    if (!form.phone.trim())   e.phone   = "Phone number is required";
    else if (!/^\d{10}$/.test(form.phone.replace(/[\s-]/g, "")))
      e.phone = "Enter a valid 10-digit number";
    return e;
  };

  // ── Submit ─────────────────────────────────────────────────
  const handleSubmit = async (e) => {
    e.preventDefault();
    const v = validate();
    if (Object.keys(v).length) { setErrors(v); return; }

    setErrors({});
    setApiErr("");
    setLoading(true);

    try {
      const res = await register(form);
      const payload = res?.data?.data || res?.data || {};
      const token   = res?.data?.token || payload?.token || null;
      const name    = res?.data?.user?.name  || payload?.name  || form.name.trim();
      const email   = res?.data?.user?.email || payload?.email || form.email.trim();

      if (!token) {
        setApiErr(
          "Server returned no token. Verify JWT_SECRET is set in Render environment variables. " +
          `Response: ${JSON.stringify(res?.data)}`
        );
        return;
      }

      localStorage.setItem("quizToken", token);
      setSuccess(true);

      setTimeout(() => {
        navigate("/ready", {
          state: {
            token,
            user: {
              name,
              email,
              college: form.college.trim(),
              rollNo:  form.rollNo.trim().toUpperCase(),
            },
          },
        });
      }, 1200);
    } catch (err) {
      setApiErr(err.message || "Registration failed. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  // ── Field helper ───────────────────────────────────────────
  const inp = (key, label, type = "text", ph = "") => (
    <div className="rp-field" key={key}>
      <label className="rp-label">{label}</label>
      <input
        type={type}
        className={`rp-input ${errors[key] ? "rp-input--err" : ""}`}
        placeholder={ph || label}
        value={form[key]}
        onChange={(ev) => {
          setForm((f) => ({ ...f, [key]: ev.target.value }));
          setErrors((er) => ({ ...er, [key]: "" }));
          setApiErr("");
        }}
        autoComplete="off"
      />
      {errors[key] && <span className="rp-field-err">⚠ {errors[key]}</span>}
    </div>
  );

  if (checking) {
    return (
      <div className="rp-fullcenter">
        <div className="rp-spinner" />
      </div>
    );
  }

  return (
    <div className="rp-root">

      {/* ── Floating quiz icons ── */}
      <div className="rp-float-icons" aria-hidden>
        {FLOAT_ICONS.map((ic, i) => (
          <span key={i} className="rp-float-icon">{ic}</span>
        ))}
      </div>

      {/* ══════════════ LEFT BRANDING PANEL ══════════════ */}
      <div className="rp-left">
        <div className="rp-left-inner">

          {/* Brand */}
          <div className="rp-brand">
            <div className="rp-brand-logo" aria-label="MHA Logo">M</div>
            <div>
              <div className="rp-brand-name">M H Foundation</div>
              <div className="rp-brand-sub">M H Foundation®</div>
            </div>
          </div>

          {/* Live badge */}
          <div className="rp-live-badge">
            <span className="rp-live-dot" />
            Assessment Live
          </div>

          {/* Hero title */}
          <h1 className="rp-hero-title">
            Online Assessment<br />
            <span>Platform</span>
          </h1>

          <p className="rp-hero-sub">
            A rigorous, fullscreen-proctored quiz spanning six competency
            domains — designed to challenge and showcase your true potential.
          </p>

          {/* Motivational quote */}
          <div className="rp-quote">
            <div className="rp-quote-text">"{quote.text}"</div>
            <div className="rp-quote-author">— {quote.author}</div>
          </div>

          {/* Instructions */}
          <div className="rp-instructions">
            <div className="rp-instructions-title">Exam Guidelines</div>
            <div className="rp-instr-list">
              {INSTRUCTIONS.map((ins) => (
                <div className="rp-instr-item" key={ins.label}>
                  <div className={`rp-instr-icon ${ins.color}`}>{ins.icon}</div>
                  <div className="rp-instr-body">
                    <div className="rp-instr-label">{ins.label}</div>
                    <div className="rp-instr-desc">{ins.desc}</div>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Section pills */}
          <div>
            <div className="rp-instructions-title" style={{ marginBottom: 10 }}>
              6 Question Sections
            </div>
            <div className="rp-sections">
              {SECTIONS.map((s) => (
                <span className="rp-pill" key={s}>{s}</span>
              ))}
            </div>
          </div>

          {/* Stats */}
          <div className="rp-stats">
            <div className="rp-stat">
              <div className="rp-stat-num">6</div>
              <div className="rp-stat-lbl">Sections</div>
            </div>
            <div className="rp-stat">
              <div className="rp-stat-num">90</div>
              <div className="rp-stat-lbl">Minutes</div>
            </div>
            <div className="rp-stat">
              <div className="rp-stat-num">100%</div>
              <div className="rp-stat-lbl">Proctored</div>
            </div>
            <div className="rp-stat">
              <div className="rp-stat-num">Free</div>
              <div className="rp-stat-lbl">No Cost</div>
            </div>
          </div>

          {/* Decorative circles */}
          <div className="rp-deco-circles">
            <div className="rp-circle rp-circle-1" />
            <div className="rp-circle rp-circle-2" />
            <div className="rp-circle rp-circle-3" />
          </div>

        </div>
      </div>

      {/* ══════════════ RIGHT FORM PANEL ══════════════ */}
      <div className="rp-right">
        <div className="rp-form-card">

          <div className="rp-form-head">
            <h2 className="rp-form-title">Register &amp; Begin</h2>
            <p className="rp-form-sub">
              One-time registration — you'll be taken straight to the quiz.
              No login required.
            </p>
          </div>

          {success ? (
            <div className="rp-success">
              <div className="rp-success-check">✓</div>
              <h3>Registration Successful!</h3>
              <p>Preparing your assessment… good luck! 🚀</p>
              <div className="rp-progress">
                <div className="rp-progress-fill" />
              </div>
            </div>
          ) : (
            <form className="rp-form" onSubmit={handleSubmit} noValidate>
              <div className="rp-grid">
                {inp("name",    "Full Name",             "text",  "Your full name")}
                {inp("email",   "Email Address",         "email", "you@example.com")}
                {inp("college", "College / Institution", "text",  "Your institution name")}
                {inp("rollNo",  "Roll Number",           "text",  "Roll / registration number")}
                {inp("phone",   "Phone Number",          "tel",   "10-digit mobile number")}
              </div>

              {apiErr && (
                <div className="rp-api-err">
                  <span>⚠</span>
                  <span>{apiErr}</span>
                </div>
              )}

              <button className="rp-submit" type="submit" disabled={loading}>
                {loading
                  ? <><span className="rp-spin" /><span>Registering…</span></>
                  : <>Register &amp; Start Quiz →</>
                }
              </button>

              <p className="rp-note">
                🔒 Your information is used solely for assessment purposes and
                will never be shared with third parties.
              </p>
            </form>
          )}
        </div>
      </div>

    </div>
  );
}