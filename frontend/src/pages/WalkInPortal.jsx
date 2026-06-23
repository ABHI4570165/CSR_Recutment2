import React, { useState } from "react";
import { useNavigate } from "react-router-dom";
import { validateTestCode, registerWalkIn } from "../utils/api";
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

export default function WalkInPortal() {
  const navigate = useNavigate();
  const [form, setForm] = useState({
    name: "", usn: "", email: "", phone: "", course: "", branch: "", gender: "", dob: "",
    aadhaar: "", college: "", location: "", testCode: "",
  });
  const [resume, setResume] = useState(null);   // { filename, mime, data }
  const [agreed, setAgreed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [fieldErr, setFieldErr] = useState({});
  const [drive, setDrive] = useState(null);   // validated drive info (shown once code verified)
  const [codeMsg, setCodeMsg] = useState("");

  const set = (k) => (e) => {
    setForm((f) => ({ ...f, [k]: e.target.value }));
    setErr(""); setFieldErr((fe) => ({ ...fe, [k]: "" }));
    if (k === "testCode") { setDrive(null); setCodeMsg(""); }
  };

  // Live test-code check (on blur) — shows the drive details + capacity inline.
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
    reader.readAsDataURL(f);  // → data URL; backend strips the prefix
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
      navigate(`/assessment/${r.data.token}`);   // reuse the EXISTING assessment engine
    } catch (e) { setErr(e.message || "Registration failed."); setBusy(false); }
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
          <h1 className="wp-title">Candidate Registration</h1>
          <p className="wp-sub">Fill in your details and your test code to begin the assessment.</p>

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
        </div>
      </div>
    </div>
  );
}
