import React, { useState, useEffect, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { validateTestCode, registerWalkIn, resumeWalkIn } from "../utils/api";
import "./WalkInPortal.css";

const FIELDS = [
  ["name",     "Full Name",       "text",  true],
  ["usn",      "USN",             "text",  false],
  ["email",    "Email",           "email", true],
  ["phone",    "Mobile Number",   "tel",   true],
  ["course",   "Course",          "text",  false],
  ["branch",   "Branch",          "text",  false],
  ["college",  "College Name",    "text",  true],
  ["gender",   "Gender",          "select",false],
  ["dob",      "Date of Birth",   "date",  false],
  ["aadhaar",  "Aadhaar Number",  "text",  false],
  ["location", "Location",        "text",  false],
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
    try {
      const r = await validateTestCode({ testCode: code });
      setDrive(r.data.data); setCodeMsg(""); setFieldErr((fe) => ({ ...fe, testCode: "" }));
    } catch (e) { setDrive(null); setCodeMsg(e.message || "Invalid test code."); }
  };

  const onResume = (e) => {
    const f = e.target.files?.[0];
    if (!f) { setResume(null); return; }
    if (f.size > MAX_RESUME_MB * 1024 * 1024) { setErr(`Resume must be under ${MAX_RESUME_MB} MB.`); e.target.value = ""; return; }
    const reader = new FileReader();
    reader.onload = () => setResume({ filename: f.name, mime: f.type || "application/octet-stream", data: String(reader.result) });
    reader.readAsDataURL(f);
    setErr("");
  };

  const validate = () => {
    const fe = {};
    if (!form.name.trim()) fe.name = "Required";
    if (!form.email.trim()) fe.email = "Required";
    else if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(form.email.trim())) fe.email = "Invalid email";
    if (!form.college.trim()) fe.college = "Required";
    if (!form.phone.trim()) fe.phone = "Required";
    else if (!PHONE_RE.test(form.phone.replace(/\s/g, ""))) fe.phone = "10 digits";
    if (!form.testCode.trim()) fe.testCode = "Required";
    if (form.aadhaar && !AADHAAR_RE.test(form.aadhaar.replace(/\s/g, ""))) fe.aadhaar = "12 digits";
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

  const inputFor = ([k, label, type, req]) => (
    <div key={k} className={`wp-field ${k === "name" || k === "college" || k === "location" ? "wp-field--full" : ""}`}>
      <label className="wp-label">{label}{req && <span className="wp-req"> *</span>}</label>
      {type === "select" ? (
        <select className={`wp-input ${fieldErr[k] ? "wp-input--err" : ""}`} value={form[k]} onChange={set(k)}>
          <option value="">Select…</option><option>Male</option><option>Female</option><option>Other</option>
        </select>
      ) : (
        <input className={`wp-input ${fieldErr[k] ? "wp-input--err" : ""}`} type={type} value={form[k]}
          onChange={set(k)} onBlur={k === "testCode" ? checkCode : undefined}
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

              <div className="wp-grid">
                {FIELDS.filter(f => f[0] !== "testCode").map(inputFor)}
                <div className="wp-field wp-field--full">
                  <label className="wp-label">Resume (PDF/DOC, max {MAX_RESUME_MB} MB)</label>
                  <input className="wp-input" type="file" accept=".pdf,.doc,.docx" onChange={onResume} />
                  {resume && <span className="wp-field-err" style={{ color: "#059669" }}>✓ {resume.filename} attached</span>}
                </div>
              </div>

              <div className="wp-codebox">
                {inputFor(["testCode", "Test Code", "text", true])}
                {drive && (
                  <div className="wp-drive">
                    <div className="wp-drive-name">✓ {drive.assessmentName}</div>
                    <div className="wp-drive-meta">
                      {drive.durationMinutes} minutes{drive.college ? ` · ${drive.college}` : ""}
                      {drive.capacity ? ` · ${drive.capacity.current}/${drive.capacity.max} registered` : ""}
                    </div>
                  </div>
                )}
                {codeMsg && <div className="wp-err" style={{ marginTop: 8 }}>{codeMsg}</div>}
              </div>

              <label className="wp-tnc">
                <input type="checkbox" checked={agreed} onChange={(e) => setAgreed(e.target.checked)} />
                <span>I agree to the Terms &amp; Conditions and consent to camera-based proctoring during this assessment.</span>
              </label>

              {err && <div className="wp-err">{err}</div>}
              <button className="wp-btn" onClick={submit} disabled={busy}>{busy ? "Starting…" : "START ASSESSMENT"}</button>
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
              {err && <div className="wp-err">{err}</div>}
              <button className="wp-btn" onClick={doResume} disabled={busy}>{busy ? "Finding…" : "RESUME ASSESSMENT"}</button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
