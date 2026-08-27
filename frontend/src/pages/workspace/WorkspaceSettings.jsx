import React, { useCallback, useEffect, useState } from "react";
import {
  updateWorkspace, listFields, createField, updateField, deleteField,
} from "../../utils/workspaceApi";
import { Loading, ErrorNote, Modal, Confirm, Spinner, useToast, Empty } from "./ui";

/*
 * Workspace management + dynamic registration fields.
 *
 * The six defaults (name, email, contact, college, course, branch) arrive from
 * the backend as system fields: always required, never deletable. Anything the
 * admin adds here appears on the candidate registration form automatically —
 * no code change, no deploy.
 */

const FIELD_TYPES = ["TEXT", "NUMBER", "EMAIL", "PHONE", "DROPDOWN", "DATE", "FILE", "TEXTAREA", "CHECKBOX", "RADIO"];

export default function WorkspaceSettings({ workspace, onSaved, readOnly }) {
  const [tab, setTab] = useState("company");
  const { showToast, toastEl } = useToast();
  return (
    <div>
      {toastEl}
      <div className="ad-page-title">Workspace Settings</div>
      <div className="ws-sub-tabs">
        <button className={`ws-sub-tab ${tab === "company" ? "ws-sub-tab--active" : ""}`} onClick={() => setTab("company")}>Company</button>
        <button className={`ws-sub-tab ${tab === "fields" ? "ws-sub-tab--active" : ""}`} onClick={() => setTab("fields")}>Registration Fields</button>
      </div>
      {tab === "company"
        ? <CompanyForm workspace={workspace} onSaved={onSaved} showToast={showToast} readOnly={readOnly} />
        : <FieldsManager showToast={showToast} readOnly={readOnly} />}
    </div>
  );
}

/* ── Company details ──────────────────────────────────────────────────────── */
function CompanyForm({ workspace, onSaved, showToast, readOnly }) {
  const [f, setF] = useState({
    name: "", companyName: "", logoUrl: "", website: "", industry: "", location: "",
    contactEmail: "", about: "", primaryColor: "#4F46E5", accentColor: "#0891B2", isActive: true,
  });
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!workspace) return;
    setF({
      name: workspace.name || "",
      companyName: workspace.companyName || "",
      logoUrl: workspace.logo?.url || "",
      website: workspace.details?.website || "",
      industry: workspace.details?.industry || "",
      location: workspace.details?.location || "",
      contactEmail: workspace.details?.contactEmail || "",
      about: workspace.details?.about || "",
      primaryColor: workspace.branding?.primaryColor || "#4F46E5",
      accentColor: workspace.branding?.accentColor || "#0891B2",
      isActive: workspace.isActive !== false,
    });
  }, [workspace]);

  const set = (k) => (e) => setF(p => ({ ...p, [k]: e.target.type === "checkbox" ? e.target.checked : e.target.value }));

  const save = async (e) => {
    e.preventDefault();
    if (!f.name.trim()) { showToast({ type: "error", title: "Workspace name is required." }); return; }
    setSaving(true);
    try {
      const w = await updateWorkspace({
        name: f.name.trim(), companyName: f.companyName.trim(),
        logo: f.logoUrl.trim() ? { url: f.logoUrl.trim() } : null,
        details: { website: f.website, industry: f.industry, location: f.location, contactEmail: f.contactEmail, about: f.about },
        branding: { primaryColor: f.primaryColor, accentColor: f.accentColor },
        isActive: f.isActive,
      });
      showToast({ title: "Workspace saved" });
      onSaved?.(w);
    } catch (e2) { showToast({ type: "error", title: "Could not save", lines: [e2.message] }); }
    finally { setSaving(false); }
  };

  if (!workspace) return <Loading />;

  return (
    <form onSubmit={save}>
      <section className="ad-card-section">
        <div className="ad-card-section-title">🏢 Company</div>
        <div className="ws-form-grid">
          <div className="ad-field">
            <label className="ad-label">Workspace Name<span className="ws-req">*</span></label>
            <input className="ad-input" value={f.name} onChange={set("name")} disabled={readOnly} />
          </div>
          <div className="ad-field">
            <label className="ad-label">Company Name</label>
            <input className="ad-input" value={f.companyName} onChange={set("companyName")} disabled={readOnly} />
          </div>
          <div className="ad-field">
            <label className="ad-label">Logo URL</label>
            <input className="ad-input" value={f.logoUrl} onChange={set("logoUrl")} placeholder="https://…" disabled={readOnly} />
            <div className="ws-hint">Shown on the public final-selection page.</div>
          </div>
          <div className="ad-field">
            <label className="ad-label">Website</label>
            <input className="ad-input" value={f.website} onChange={set("website")} disabled={readOnly} />
          </div>
          <div className="ad-field">
            <label className="ad-label">Industry</label>
            <input className="ad-input" value={f.industry} onChange={set("industry")} disabled={readOnly} />
          </div>
          <div className="ad-field">
            <label className="ad-label">Location</label>
            <input className="ad-input" value={f.location} onChange={set("location")} disabled={readOnly} />
          </div>
          <div className="ad-field">
            <label className="ad-label">Contact Email</label>
            <input className="ad-input" value={f.contactEmail} onChange={set("contactEmail")} disabled={readOnly} />
          </div>
        </div>
        <div className="ad-field" style={{ marginTop: 14 }}>
          <label className="ad-label">About</label>
          <textarea className="ad-input" rows={3} value={f.about} onChange={set("about")} disabled={readOnly} />
        </div>
      </section>

      <section className="ad-card-section">
        <div className="ad-card-section-title">🎨 Branding &amp; Status</div>
        <div className="ws-form-grid">
          <div className="ad-field">
            <label className="ad-label">Primary Colour</label>
            <input type="color" className="ad-input" style={{ height: 42, padding: 4 }} value={f.primaryColor} onChange={set("primaryColor")} disabled={readOnly} />
          </div>
          <div className="ad-field">
            <label className="ad-label">Accent Colour</label>
            <input type="color" className="ad-input" style={{ height: 42, padding: 4 }} value={f.accentColor} onChange={set("accentColor")} disabled={readOnly} />
          </div>
          <div className="ad-field">
            <label className="ad-label">Status</label>
            <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, marginTop: 8 }}>
              <input type="checkbox" checked={f.isActive} onChange={set("isActive")} disabled={readOnly} />
              Workspace is active
            </label>
            <div className="ws-hint">A deactivated workspace disappears from the switcher and its APIs stop responding.</div>
          </div>
        </div>
      </section>

      {!readOnly && (
        <div style={{ display: "flex", justifyContent: "flex-end", gap: 10 }}>
          <button className="ad-btn ad-btn--primary" disabled={saving}>{saving ? <><Spinner />Saving…</> : "Save Workspace"}</button>
        </div>
      )}
    </form>
  );
}

/* ── Dynamic registration fields ──────────────────────────────────────────── */
function FieldsManager({ showToast, readOnly }) {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");
  const [editing, setEditing] = useState(null);   // field object or "new"
  const [delTarget, setDelTarget] = useState(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true); setErr("");
    try {
      setRows(await listFields() || []);
    } catch (e) { setErr(e.message); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { load(); }, [load]);

  const remove = async () => {
    setBusy(true);
    try {
      await deleteField(delTarget._id);
      showToast({ title: `Removed "${delTarget.fieldName}"` });
      setDelTarget(null); load();
    } catch (e) { showToast({ type: "error", title: "Could not remove", lines: [e.message] }); }
    finally { setBusy(false); }
  };

  if (loading && !rows.length) return <Loading label="Loading registration fields…" />;

  return (
    <div>
      {err && <ErrorNote message={err} onRetry={load} />}
      <div className="ad-section-head">
        <div style={{ fontSize: 13, color: "var(--text-2)", maxWidth: "60ch" }}>
          These fields make up the candidate registration form. The six system fields are always required.
          Anything you add appears on the form automatically.
        </div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          {!readOnly && <button className="ad-btn ad-btn--primary" onClick={() => setEditing("new")}>＋ Add Field</button>}
        </div>
      </div>

      <div className="ad-table-wrap">
        <table className="ad-table">
          <thead>
            <tr><th>#</th><th>Field</th><th>Key</th><th>Type</th><th>Required</th><th>Options</th><th>Actions</th></tr>
          </thead>
          <tbody>
            {rows.map((f, i) => (
              <tr key={f._id}>
                <td className="ad-td-num">{f.order ?? i + 1}</td>
                <td>
                  <strong>{f.fieldName}</strong>
                  {f.isSystem && <span className="ad-badge ad-badge--gray" style={{ marginLeft: 8 }}>System</span>}
                </td>
                <td><code className="ad-mono">{f.fieldKey}</code></td>
                <td className="ad-td-sm">{f.fieldType}</td>
                <td>{f.required ? <span className="ad-badge ad-badge--green">Required</span> : <span className="ad-badge ad-badge--gray">Optional</span>}</td>
                <td className="ad-td-sm">{(f.options || []).join(", ") || "—"}</td>
                <td style={{ display: "flex", gap: 6 }}>
                  {!readOnly && <button className="ad-btn ad-btn--sm ad-btn--outline" onClick={() => setEditing(f)}>Edit</button>}
                  {!readOnly && !f.isSystem && <button className="ad-btn ad-btn--sm ad-btn--danger" onClick={() => setDelTarget(f)}>Delete</button>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {editing && (
        <FieldModal
          field={editing === "new" ? null : editing}
          onClose={() => setEditing(null)}
          onSaved={() => { setEditing(null); load(); showToast({ title: "Field saved" }); }}
          onError={(m) => showToast({ type: "error", title: "Could not save", lines: [m] })}
        />
      )}
      {delTarget && (
        <Confirm title="Remove this field?"
          message={<>Candidates will no longer be asked for <strong>{delTarget.fieldName}</strong>. Answers already collected are kept.</>}
          confirmLabel="Remove Field" busyLabel="Removing…" tone="danger"
          loading={busy} onConfirm={remove} onCancel={() => setDelTarget(null)} />
      )}
    </div>
  );
}

function FieldModal({ field, driveId, onClose, onSaved, onError }) {
  const isNew = !field;
  const [f, setF] = useState({
    fieldName: field?.fieldName || "", fieldKey: field?.fieldKey || "",
    fieldType: field?.fieldType || "TEXT", required: field?.required || false,
    order: field?.order ?? 100, placeholder: field?.placeholder || "",
    helpText: field?.helpText || "", options: (field?.options || []).join(", "),
    min: field?.validation?.min ?? "", max: field?.validation?.max ?? "",
    regex: field?.validation?.regex || "", message: field?.validation?.message || "",
  });
  const [saving, setSaving] = useState(false);
  const set = (k) => (e) => setF(p => ({ ...p, [k]: e.target.type === "checkbox" ? e.target.checked : e.target.value }));
  const needsOptions = ["DROPDOWN", "RADIO", "CHECKBOX"].includes(f.fieldType);

  const submit = async (e) => {
    e.preventDefault();
    setSaving(true);
    const payload = {
      fieldName: f.fieldName.trim(), fieldType: f.fieldType, required: f.required,
      order: Number(f.order) || 100, placeholder: f.placeholder, helpText: f.helpText,
      options: needsOptions ? f.options.split(",").map(s => s.trim()).filter(Boolean) : [],
      validation: {
        min: f.min === "" ? null : Number(f.min), max: f.max === "" ? null : Number(f.max),
        regex: f.regex, message: f.message,
      },
      ...(isNew ? { fieldKey: f.fieldKey.trim() || undefined, driveId: driveId || null } : {}),
    };
    try {
      if (isNew) await createField(payload);
      else await updateField(field._id, payload);
      onSaved();
    } catch (e2) { onError(e2.message); }
    finally { setSaving(false); }
  };

  return (
    <Modal title={isNew ? "Add Registration Field" : `Edit “${field.fieldName}”`}
      sub={field?.isSystem ? "This is a system field — its key, type and required flag are fixed." : "Appears on the candidate registration form immediately."}
      onClose={onClose}>
      <form onSubmit={submit}>
        <div className="ws-form-grid">
          <div className="ad-field">
            <label className="ad-label">Field Name<span className="ws-req">*</span></label>
            <input className="ad-input" value={f.fieldName} onChange={set("fieldName")} placeholder="e.g. CGPA" autoFocus />
          </div>
          {isNew && (
            <div className="ad-field">
              <label className="ad-label">Field Key</label>
              <input className="ad-input" value={f.fieldKey} onChange={set("fieldKey")} placeholder="auto from name" />
              <div className="ws-hint">Machine key stored on the candidate. Leave blank to generate.</div>
            </div>
          )}
          <div className="ad-field">
            <label className="ad-label">Field Type</label>
            <select className="ad-input ad-select" value={f.fieldType} onChange={set("fieldType")} disabled={field?.isSystem}>
              {FIELD_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
            </select>
          </div>
          <div className="ad-field">
            <label className="ad-label">Display Order</label>
            <input type="number" className="ad-input" value={f.order} onChange={set("order")} />
          </div>
          <div className="ad-field">
            <label className="ad-label">Placeholder</label>
            <input className="ad-input" value={f.placeholder} onChange={set("placeholder")} />
          </div>
          <div className="ad-field">
            <label className="ad-label">Help Text</label>
            <input className="ad-input" value={f.helpText} onChange={set("helpText")} />
          </div>
        </div>

        {needsOptions && (
          <div className="ad-field" style={{ marginTop: 14 }}>
            <label className="ad-label">Options (comma separated)</label>
            <input className="ad-input" value={f.options} onChange={set("options")} placeholder="2024, 2025, 2026" />
          </div>
        )}

        <div className="ad-card-section-title" style={{ marginTop: 18 }}>Validation</div>
        <div className="ws-form-grid">
          <div className="ad-field">
            <label className="ad-label">Min</label>
            <input type="number" className="ad-input" value={f.min} onChange={set("min")} />
          </div>
          <div className="ad-field">
            <label className="ad-label">Max</label>
            <input type="number" className="ad-input" value={f.max} onChange={set("max")} />
          </div>
          <div className="ad-field">
            <label className="ad-label">Pattern (regex)</label>
            <input className="ad-input" value={f.regex} onChange={set("regex")} placeholder="^[6-9]\\d{9}$" />
          </div>
          <div className="ad-field">
            <label className="ad-label">Error Message</label>
            <input className="ad-input" value={f.message} onChange={set("message")} placeholder="Shown when the value is invalid" />
          </div>
        </div>

        <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, marginTop: 16 }}>
          <input type="checkbox" checked={f.required} onChange={set("required")} disabled={field?.isSystem} />
          Required — candidates cannot start a test without it
        </label>

        <div style={{ display: "flex", gap: 10, justifyContent: "flex-end", marginTop: 20 }}>
          <button type="button" className="ad-btn ad-btn--outline" onClick={onClose} disabled={saving}>Cancel</button>
          <button type="submit" className="ad-btn ad-btn--primary" disabled={saving}>
            {saving ? <><Spinner />Saving…</> : isNew ? "Add Field" : "Save Changes"}
          </button>
        </div>
      </form>
    </Modal>
  );
}
