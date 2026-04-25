import React, { useState, useEffect } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import { register, verifyToken } from "../utils/api";
import "./RegisterPage.css";

export default function RegisterPage() {
  const navigate  = useNavigate();
  const location  = useLocation();

  const [form, setForm] = useState({
    name:    "",
    email:   "",
    college: "",
    rollNo:  "",
    phone:   "",
  });
  const [errors,   setErrors]   = useState({});
  const [loading,  setLoading]  = useState(false);
  const [success,  setSuccess]  = useState(false);
  const [apiErr,   setApiErr]   = useState("");
  const [checking, setChecking] = useState(true);

  // ── Auto-redirect if already logged in ─────────────────────────────────────
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

  // ── Token in URL (e.g. from email link — legacy) ────────────────────────────
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

  // ── Client-side validation ──────────────────────────────────────────────────
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

  // ── Submit ──────────────────────────────────────────────────────────────────
  const handleSubmit = async (e) => {
    e.preventDefault();
    const v = validate();
    if (Object.keys(v).length) { setErrors(v); return; }

    setErrors({});
    setApiErr("");
    setLoading(true);

    try {
      const res = await register(form); // api.js builds the exact body

      // Defensive: accept token from multiple response shapes
      // backend now returns token at BOTH res.data.token AND res.data.data.token
      const payload = res?.data?.data || res?.data || {};
      const token   = res?.data?.token || payload?.token || null;
      const name    = res?.data?.user?.name  || payload?.name  || form.name.trim();
      const email   = res?.data?.user?.email || payload?.email || form.email.trim();

      if (!token) {
        // Backend responded 2xx but no token — config issue on Render
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
      // err.message is normalised in api.js interceptor and includes
      // the exact missing fields from the backend response
      setApiErr(err.message || "Registration failed. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  // ── Field helper ────────────────────────────────────────────────────────────
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

  if (checking) return <div className="rp-fullcenter"><div className="rp-spinner" /></div>;

  return (
    <div className="rp-root">
      {/* ── Left branding panel ── */}
      <div className="rp-left">
        <div className="rp-left-inner">
          <div className="rp-brand">
            <div className="rp-brand-logo">M</div>
            <div>
              <div className="rp-brand-name">Mandi Hariyanna Academy</div>
              <div className="rp-brand-sub">Mandi Harish Foundation®</div>
            </div>
          </div>
          <h1 className="rp-hero-title">
            Online Assessment<br /><span>Platform</span>
          </h1>
          <p className="rp-hero-sub">
            Test your skills in Aptitude, Logical Reasoning &amp; English in a
            secure, fullscreen, timed environment.
          </p>
          <div className="rp-features">
            {[
              { icon: "📋", t: "3 Sections",      d: "Aptitude · Logical · English" },
              { icon: "⏱",  t: "Timed Quiz",       d: "Server-enforced time limit"   },
              { icon: "🖥️", t: "Fullscreen Mode",  d: "Anti-malpractice monitoring"  },
              { icon: "📊", t: "Official Results", d: "Announced via MHA channels"   },
            ].map((f) => (
              <div key={f.t} className="rp-feat">
                <div className="rp-feat-icon">{f.icon}</div>
                <div>
                  <div className="rp-feat-title">{f.t}</div>
                  <div className="rp-feat-desc">{f.d}</div>
                </div>
              </div>
            ))}
          </div>
          <div className="rp-deco-circles">
            <div className="rp-circle rp-circle-1" />
            <div className="rp-circle rp-circle-2" />
            <div className="rp-circle rp-circle-3" />
          </div>
        </div>
      </div>

      {/* ── Right form panel ── */}
      <div className="rp-right">
        <div className="rp-form-card">
          <div className="rp-form-head">
            <h2 className="rp-form-title">Register &amp; Start Quiz</h2>
            <p className="rp-form-sub">
              Fill in your details to begin the assessment immediately.
            </p>
          </div>

          {success ? (
            <div className="rp-success">
              <div className="rp-success-check">✓</div>
              <h3>Registration Successful!</h3>
              <p>Redirecting you to the quiz…</p>
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
                {inp("rollNo",  "Roll Number",           "text",  "Your roll / registration number")}
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
                You will be taken directly to the quiz after registration.
              </p>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}