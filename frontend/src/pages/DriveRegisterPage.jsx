import React, { useEffect, useMemo, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { getRegistrationForm, submitRegistration } from "../utils/workspaceApi";
import "./DriveRegisterPage.css";

/*
 * Public self-registration for a workspace drive.
 *
 *   /register/:workspaceSlug/:driveSlug
 *
 * Every field on this page comes from the API. Adding "CGPA" in the admin makes
 * it appear here on the next load — there is no hardcoded field list, and the
 * first round's name is whatever the admin called it.
 */

const MAX_FILE_MB = 5;

export default function DriveRegisterPage() {
  const { workspaceSlug, driveSlug } = useParams();
  const navigate = useNavigate();

  const [form, setForm] = useState(null);
  const [state, setState] = useState("loading");   // loading | ready | closed | notfound | error
  const [message, setMessage] = useState("");
  const [values, setValues] = useState({});
  const [errors, setErrors] = useState({});
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(null);

  useEffect(() => {
    let alive = true;
    getRegistrationForm(workspaceSlug, driveSlug)
      .then(d => { if (!alive) return; setForm(d); setState("ready"); })
      .catch(e => {
        if (!alive) return;
        setMessage(e.message);
        setState(e.state === "closed" ? "closed" : e.status === 404 ? "notfound" : "error");
      });
    return () => { alive = false; };
  }, [workspaceSlug, driveSlug]);

  const brand = useMemo(() => ({
    "--brand": form?.workspace?.branding?.primaryColor || "#4F46E5",
    "--brand-2": form?.workspace?.branding?.accentColor || "#0891B2",
  }), [form]);

  const setValue = (key, v) => {
    setValues(p => ({ ...p, [key]: v }));
    setErrors(p => (p[key] ? { ...p, [key]: undefined } : p));
  };

  const onFile = (key, file, fieldName) => {
    if (!file) return setValue(key, undefined);
    if (file.size > MAX_FILE_MB * 1024 * 1024) {
      setErrors(p => ({ ...p, [key]: `${fieldName} must be ${MAX_FILE_MB} MB or smaller.` }));
      return;
    }
    const reader = new FileReader();
    reader.onload = () => setValue(key, { filename: file.name, mime: file.type, data: String(reader.result) });
    reader.readAsDataURL(file);
  };

  const submit = async (e) => {
    e.preventDefault();
    setSubmitting(true); setErrors({}); setMessage("");
    try {
      const r = await submitRegistration(workspaceSlug, driveSlug, values);
      setDone(r);
    } catch (err) {
      // The backend is the authority — it returns the exact fields at fault.
      if (Array.isArray(err.errors) && err.errors.length) {
        const map = {};
        err.errors.forEach(x => { map[x.fieldKey] = x.message; });
        setErrors(map);
        setMessage(err.message || "Please correct the highlighted fields.");
        const first = document.querySelector(`[name="${err.errors[0].fieldKey}"]`);
        first?.scrollIntoView({ behavior: "smooth", block: "center" });
        first?.focus?.();
      } else {
        setMessage(err.message || "Registration failed. Please try again.");
      }
    } finally { setSubmitting(false); }
  };

  /* ── States ─────────────────────────────────────────────────────────────── */
  if (state === "loading") return <Shell><div className="reg-spin" aria-hidden="true" /><p>Loading registration…</p></Shell>;
  if (state === "notfound") return <Shell icon="🔍" title="Page not found"><p>This registration link is not valid. Please check the link you were given.</p></Shell>;
  if (state === "closed") return <Shell icon="🔒" title="Registration is closed"><p>{message || "This drive is not accepting registrations right now."}</p></Shell>;
  if (state === "error") return <Shell icon="⚠️" title="Something went wrong"><p>{message}</p></Shell>;

  const { workspace, drive, firstRound, fields, totalRounds } = form;
  const company = workspace.companyName || workspace.name;

  /* ── Success ────────────────────────────────────────────────────────────── */
  if (done) {
    return (
      <div className="reg-page" style={brand}>
        <div className="reg-card reg-card--done">
          <div className="reg-tick">✓</div>
          <h1 className="reg-done-title">
            {done.alreadyRegistered ? "You are already registered" : "Registration successful"}
          </h1>
          <p className="reg-done-sub">
            {done.alreadyRegistered
              ? "We found your existing registration for this drive — no duplicate was created."
              : "Your details have been saved."}
          </p>
          <dl className="reg-summary">
            <div><dt>Name</dt><dd>{done.student.name}</dd></div>
            <div><dt>Email</dt><dd>{done.student.email}</dd></div>
            <div><dt>Drive</dt><dd>{done.drive.name}</dd></div>
            {done.drive.role && <div><dt>Role</dt><dd>{done.drive.role}</dd></div>}
            <div><dt>First Round</dt><dd>{done.firstRound.name}</dd></div>
          </dl>
          <button className="reg-btn reg-btn--primary reg-btn--lg" onClick={() => navigate(done.testUrl)}>
            Start {done.firstRound.name} →
          </button>
          <p className="reg-fineprint">Keep this device and browser open. Your test link is personal to you.</p>
        </div>
      </div>
    );
  }

  /* ── Form ───────────────────────────────────────────────────────────────── */
  return (
    <div className="reg-page" style={brand}>
      <div className="reg-card">
        <header className="reg-head">
          <div className="reg-logo">
            {workspace.logo?.url
              ? <img src={workspace.logo.url} alt={`${company} logo`} />
              : <span>{(company || "?").charAt(0)}</span>}
          </div>
          <div className="reg-company">{company}</div>
          <h1 className="reg-title">{drive.name}</h1>
          {drive.role && <div className="reg-role">{drive.role}</div>}
          <p className="reg-intro">
            Register below to take <strong>{firstRound.name}</strong>
            {totalRounds > 1 ? <> — the first of {totalRounds} rounds.</> : "."}
          </p>
        </header>

        {message && !Object.keys(errors).length && <div className="reg-alert">{message}</div>}
        {message && Object.keys(errors).length > 0 && <div className="reg-alert">{message}</div>}

        <form onSubmit={submit} noValidate>
          {fields.map(f => (
            <FieldInput key={f.fieldKey} field={f}
              value={values[f.fieldKey]} error={errors[f.fieldKey]}
              onChange={(v) => setValue(f.fieldKey, v)}
              onFile={(file) => onFile(f.fieldKey, file, f.fieldName)} />
          ))}

          <button type="submit" className="reg-btn reg-btn--primary reg-btn--lg" disabled={submitting}>
            {submitting ? "Registering…" : "Register & Continue"}
          </button>
          <p className="reg-fineprint">
            Your details are shared only with {company} for this drive.
          </p>
        </form>
      </div>
    </div>
  );
}

/* ── One field, rendered from its backend configuration ───────────────────── */
function FieldInput({ field: f, value, error, onChange, onFile }) {
  const id = `f_${f.fieldKey}`;
  const common = {
    id, name: f.fieldKey, className: `reg-input ${error ? "reg-input--bad" : ""}`,
    placeholder: f.placeholder || "", "aria-invalid": !!error,
    "aria-describedby": error ? `${id}_err` : (f.helpText ? `${id}_help` : undefined),
  };

  const label = (
    <label className="reg-label" htmlFor={id}>
      {f.fieldName}{f.required && <span className="reg-req" aria-hidden="true"> *</span>}
      {f.required && <span className="reg-sr">(required)</span>}
    </label>
  );

  let control;
  switch (f.fieldType) {
    case "TEXTAREA":
      control = <textarea {...common} rows={3} value={value || ""} onChange={e => onChange(e.target.value)} />;
      break;
    case "DROPDOWN":
      control = (
        <select {...common} value={value || ""} onChange={e => onChange(e.target.value)}>
          <option value="">Select…</option>
          {(f.options || []).map(o => <option key={o} value={o}>{o}</option>)}
        </select>
      );
      break;
    case "RADIO":
      control = (
        <div className="reg-choices" role="radiogroup" aria-labelledby={id}>
          {(f.options || []).map(o => (
            <label key={o} className={`reg-choice ${value === o ? "reg-choice--on" : ""}`}>
              <input type="radio" name={f.fieldKey} value={o} checked={value === o} onChange={() => onChange(o)} />
              {o}
            </label>
          ))}
        </div>
      );
      break;
    case "CHECKBOX":
      control = (
        <label className="reg-check">
          <input type="checkbox" name={f.fieldKey} checked={!!value} onChange={e => onChange(e.target.checked ? "yes" : "")} />
          <span>{f.placeholder || "Yes"}</span>
        </label>
      );
      break;
    case "FILE":
      control = (
        <div>
          <input type="file" {...common} className="reg-file" onChange={e => onFile(e.target.files?.[0])} />
          {value?.filename && <div className="reg-help">Selected: {value.filename}</div>}
        </div>
      );
      break;
    case "DATE":
      control = <input type="date" {...common} value={value || ""} onChange={e => onChange(e.target.value)} />;
      break;
    case "NUMBER":
      control = <input type="number" {...common} value={value ?? ""} step="any"
        min={f.validation?.min ?? undefined} max={f.validation?.max ?? undefined}
        onChange={e => onChange(e.target.value)} />;
      break;
    case "EMAIL":
      control = <input type="email" {...common} value={value || ""} onChange={e => onChange(e.target.value)} />;
      break;
    case "PHONE":
      control = <input type="tel" inputMode="numeric" {...common} value={value || ""} onChange={e => onChange(e.target.value)} />;
      break;
    default:
      control = <input type="text" {...common} value={value || ""} onChange={e => onChange(e.target.value)} />;
  }

  return (
    <div className="reg-field">
      {label}
      {control}
      {f.helpText && !error && <div className="reg-help" id={`${id}_help`}>{f.helpText}</div>}
      {error && <div className="reg-err" id={`${id}_err`} role="alert">{error}</div>}
    </div>
  );
}

const Shell = ({ icon, title, children }) => (
  <div className="reg-state">
    {icon && <div className="reg-state-icon">{icon}</div>}
    {title && <h1>{title}</h1>}
    {children}
  </div>
);
