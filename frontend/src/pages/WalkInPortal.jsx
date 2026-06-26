import React, { useState, useEffect, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { validateTestCode, registerWalkIn, resumeWalkIn } from "../utils/api";
import "./WalkInPortal.css";

const FIELDS = [
  ["name",     "Full Name",       "text",  true],
  ["usn",      "USN",             "text",  true],
  ["email",    "Email",           "email", true],
  ["phone",    "Mobile Number",   "tel",   true],
  ["course",   "Course",          "text",  true],
  ["branch",   "Branch",          "text",  true],
  ["college",  "College Name",    "text",  true],
  ["gender",   "Gender",          "select",true],
  ["dob",      "Date of Birth",   "date",  true],
  ["aadhaar",  "Aadhaar Number",  "text",  true],
  ["location", "Address",         "text",  true],   // label "Address"; data key stays `location`
];

const AADHAAR_RE = /^\d{12}$/;
const PHONE_RE = /^\d{10}$/;
const MAX_RESUME_MB = 5;
const DRAFT_KEY = "mh_walkin_draft";   // local draft so an accidental close doesn't lose typing

const EMPTY = { name: "", usn: "", email: "", phone: "", course: "", branch: "", gender: "", dob: "", aadhaar: "", college: "", location: "", testCode: "" };

export default function WalkInPortal() {
  const navigate = useNavigate();
  const [mode, setMode] = useState("register");          // register | resume
  const [form, setForm] = useState(() => {
    try { const d = JSON.parse(localStorage.getItem(DRAFT_KEY) || "null"); return d ? { ...EMPTY, ...d } : EMPTY; }
    catch { return EMPTY; }
  });
  const [resume, setResume] = useState(null);
  const [agreed, setAgreed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [fieldErr, setFieldErr] = useState({});
  const [drive, setDrive] = useState(null);
  const [codeMsg, setCodeMsg] = useState("");
  const [codeChecking, setCodeChecking] = useState(false);
  const [restored, setRestored] = useState(false);
  // resume sub-window
  const [resumeForm, setResumeForm] = useState({ testCode: "", email: "", aadhaar: "" });

  // Draft auto-save: persist text fields so a refresh/accidental close restores them.
  const firstRun = useRef(true);
  useEffect(() => {
    const hasData = Object.values(form).some(Boolean);
    if (firstRun.current) { firstRun.current = false; if (hasData) setRestored(true); return; }
    try { localStorage.setItem(DRAFT_KEY, JSON.stringify(form)); } catch { /* ignore */ }
  }, [form]);

  const set = (k) => (e) => {
    setForm((f) => ({ ...f, [k]: e.target.value }));
    setErr(""); setFieldErr((fe) => ({ ...fe, [k]: "" }));
    if (k === "testCode") { setDrive(null); setCodeMsg(""); }
  };
  const setR = (k) => (e) => { setResumeForm((f) => ({ ...f, [k]: e.target.value })); setErr(""); };

  const clearDraft = () => { try { localStorage.removeItem(DRAFT_KEY); } catch { /* ignore */ } };

  const checkCode = async () => {
    const code = form.testCode.trim();
    if (!code) return;
    setCodeChecking(true); setCodeMsg("");
    try {
      const r = await validateTestCode({ testCode: code });
      setDrive(r.data.data); setCodeMsg(""); setFieldErr((fe) => ({ ...fe, testCode: "" }));
    } catch (e) { setDrive(null); setCodeMsg(e.message || "Unable to verify your test code. Please check the code and try again."); }
    finally { setCodeChecking(false); }
  };

  const onResume = (e) => {
    const f = e.target.files?.[0];
    if (!f) { setResume(null); return; }
    const okExt = /\.(pdf|docx?|DOC|DOCX|PDF)$/i.test(f.name);
    if (!okExt) { setFieldErr((fe) => ({ ...fe, resume: "Only PDF, DOC or DOCX files are allowed" })); e.target.value = ""; setResume(null); return; }
    if (f.size > MAX_RESUME_MB * 1024 * 1024) { setFieldErr((fe) => ({ ...fe, resume: `Resume must be under ${MAX_RESUME_MB} MB` })); e.target.value = ""; setResume(null); return; }
    const reader = new FileReader();
    reader.onload = () => setResume({ filename: f.name, mime: f.type || "application/octet-stream", data: String(reader.result), size: f.size });
    reader.readAsDataURL(f);
    setErr(""); setFieldErr((fe) => ({ ...fe, resume: "" }));
  };

  const validate = () => {
    const fe = {};
    // All these are mandatory.
    ["name", "usn", "course", "branch", "college", "gender", "dob", "location"].forEach((k) => {
      if (!String(form[k] || "").trim()) fe[k] = "Required";
    });
    if (!form.email.trim()) fe.email = "Required";
    else if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(form.email.trim())) fe.email = "Enter a valid email address";
    if (!form.phone.trim()) fe.phone = "Required";
    else if (!PHONE_RE.test(form.phone.replace(/\s/g, ""))) fe.phone = "Enter a 10-digit mobile number";
    if (!form.aadhaar.trim()) fe.aadhaar = "Required";
    else if (!AADHAAR_RE.test(form.aadhaar.replace(/\s/g, ""))) fe.aadhaar = "Enter a 12-digit Aadhaar number";
    if (form.dob && new Date(form.dob) > new Date()) fe.dob = "Date of birth cannot be in the future";
    if (!form.testCode.trim()) fe.testCode = "Required";
    if (!resume) fe.resume = "Resume is required (PDF, DOC or DOCX)";
    return fe;
  };

  const submit = async () => {
    const fe = validate();
    if (Object.keys(fe).length) { setFieldErr(fe); setErr("Please correct the highlighted fields."); return; }
    if (!agreed) { setErr("Please accept the Terms & Conditions to continue."); return; }
    setBusy(true); setErr("");
    try {
      const r = await registerWalkIn({ ...form, testCode: form.testCode.trim().toUpperCase(), resume });
      clearDraft();
      navigate(`/assessment/${r.data.token}`);
    } catch (e) { setErr(e.message || "Registration failed."); setBusy(false); }
  };

  const doResume = async () => {
    if (!resumeForm.testCode.trim()) { setErr("Enter your test code."); return; }
    if (!resumeForm.email.trim() && !resumeForm.aadhaar.trim()) { setErr("Enter your email or Aadhaar number."); return; }
    setBusy(true); setErr("");
    try {
      const r = await resumeWalkIn({ testCode: resumeForm.testCode.trim().toUpperCase(), email: resumeForm.email.trim(), aadhaar: resumeForm.aadhaar.trim() });
      navigate(`/assessment/${r.data.token}`);
    } catch (e) { setErr(e.message || "Could not resume."); setBusy(false); }
  };

  const collegeOptions = drive?.colleges || [];
  const inputFor = ([k, label, type, req]) => (
    <div key={k} className={`wp-field ${k === "name" || k === "college" || k === "location" ? "wp-field--full" : ""}`}>
      <label className="wp-label">{label}{req && <span className="wp-req"> *</span>}</label>
      {k === "college" ? (
        // College must be SELECTED from the drive's list — no free typing.
        collegeOptions.length ? (
          <select className={`wp-input ${fieldErr[k] ? "wp-input--err" : ""}`} value={form[k]} onChange={set(k)}>
            <option value="">Select your college…</option>
            {collegeOptions.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
        ) : (
          <select className="wp-input" value="" disabled>
            <option value="">Verify your test code first to load colleges</option>
          </select>
        )
      ) : type === "select" ? (
        <select className={`wp-input ${fieldErr[k] ? "wp-input--err" : ""}`} value={form[k]} onChange={set(k)}>
          <option value="">Select…</option><option>Male</option><option>Female</option><option>Other</option>
        </select>
      ) : (
        <input className={`wp-input ${fieldErr[k] ? "wp-input--err" : ""}`} type={type} value={form[k]}
          onChange={set(k)} onBlur={k === "testCode" ? checkCode : undefined}
          max={type === "date" ? new Date().toISOString().slice(0, 10) : undefined}
          inputMode={k === "phone" || k === "aadhaar" ? "numeric" : undefined}
          placeholder={k === "testCode" ? "e.g. MH001" : ""} />
      )}
      {fieldErr[k] && <span className="wp-field-err">{fieldErr[k]}</span>}
    </div>
  );

  return (
    <div className="wp-root">
      <header className="wp-top">
        <img src="/logo.png" alt="M H Foundation" className="wp-logo" onError={(e) => { e.currentTarget.style.display = "none"; }} />
        <div>
          <div className="wp-brand">M H FOUNDATION</div>
          <div className="wp-partner">Walk-in Assessment Portal · Inference Labs Pvt. Ltd.</div>
        </div>
      </header>

      <div className="wp-body">
        <div className="wp-card">
          <div className="wp-tabs">
            <button className={`wp-tab ${mode === "register" ? "wp-tab--active" : ""}`} onClick={() => { setMode("register"); setErr(""); }}>New Registration</button>
            <button className={`wp-tab ${mode === "resume" ? "wp-tab--active" : ""}`} onClick={() => { setMode("resume"); setErr(""); }}>Resume Assessment</button>
          </div>

          {mode === "register" ? (
            <>
              <h1 className="wp-title">Candidate Registration</h1>
              <p className="wp-sub">Fill in your details and your test code to begin the assessment.</p>
              {restored && (
                <div className="wp-restored">↩ We restored your earlier details.{" "}
                  <button className="wp-link-btn" onClick={() => { setForm(EMPTY); clearDraft(); setRestored(false); }}>Clear</button>
                </div>
              )}

              {/* Test code FIRST — verifying it loads the college dropdown below. */}
              <div className="wp-codebox">
                {inputFor(["testCode", "Test Code", "text", true])}
                {codeChecking && <div className="wp-checking"><span className="wp-spin" /> Verifying test code…</div>}
                {drive && (
                  <div className="wp-drive">
                    <div className="wp-drive-name">✓ {drive.assessmentName}</div>
                    <div className="wp-drive-meta">
                      {drive.durationMinutes} minutes{drive.college ? ` · ${drive.college}` : ""}
                    </div>
                  </div>
                )}
                {codeMsg && <div className="wp-err" style={{ marginTop: 8 }}>{codeMsg}</div>}
              </div>

              <div className="wp-grid">
                {FIELDS.filter(f => f[0] !== "testCode").map(inputFor)}
                <div className="wp-field wp-field--full">
                  <label className="wp-label">Resume (PDF, DOC or DOCX · max {MAX_RESUME_MB} MB)<span className="wp-req"> *</span></label>
                  <input className={`wp-input ${fieldErr.resume ? "wp-input--err" : ""}`} type="file" accept=".pdf,.doc,.docx" onChange={onResume} />
                  {resume && <span className="wp-field-err" style={{ color: "#059669" }}>✓ {resume.filename} attached</span>}
                  {fieldErr.resume && <span className="wp-field-err">{fieldErr.resume}</span>}
                </div>
              </div>

              <label className="wp-tnc">
                <input type="checkbox" checked={agreed} onChange={(e) => setAgreed(e.target.checked)} />
                <span>I agree to the Terms &amp; Conditions and consent to camera-based proctoring during this assessment.</span>
              </label>

              {err && <div className="wp-err wp-shake">{err}</div>}
              <button className="wp-btn" onClick={submit} disabled={busy}>{busy ? <><span className="wp-spin" /> Starting…</> : "START ASSESSMENT"}</button>
              <p className="wp-note">On start you'll enter fullscreen with your camera on. A laptop/desktop and a quiet room are required.</p>
            </>
          ) : (
            <>
              <h1 className="wp-title">Resume Your Assessment</h1>
              <p className="wp-sub">Already registered? Enter your test code and your email or Aadhaar to continue from where you left off.</p>
              <div className="wp-grid">
                <div className="wp-field wp-field--full">
                  <label className="wp-label">Test Code<span className="wp-req"> *</span></label>
                  <input className="wp-input" value={resumeForm.testCode} placeholder="e.g. MH001" onChange={setR("testCode")} />
                </div>
                <div className="wp-field wp-field--full">
                  <label className="wp-label">Email</label>
                  <input className="wp-input" type="email" value={resumeForm.email} onChange={setR("email")} />
                </div>
                <div className="wp-field wp-field--full">
                  <label className="wp-label">Aadhaar Number</label>
                  <input className="wp-input" value={resumeForm.aadhaar} onChange={setR("aadhaar")} />
                </div>
              </div>
              <p className="wp-note" style={{ textAlign: "left", margin: "4px 0 12px" }}>Enter your email <strong>or</strong> Aadhaar (either is enough).</p>
              {err && <div className="wp-err wp-shake">{err}</div>}
              <button className="wp-btn" onClick={doResume} disabled={busy}>{busy ? <><span className="wp-spin" /> Finding…</> : "RESUME ASSESSMENT"}</button>
            </>
          )}

          {busy && (
            <div className="wp-overlay">
              <div className="wp-spin wp-spin--lg" />
              <div className="wp-overlay-text">{mode === "register" ? "Setting up your assessment…" : "Finding your registration…"}</div>
            </div>
          )}
        </div>

        <footer className="wp-footer">
          © {new Date().getFullYear()} M H FOUNDATION · In association with Inference Labs Private Limited<br />
          For assistance, please contact your assessment coordinator.
        </footer>
      </div>
    </div>
  );
}
