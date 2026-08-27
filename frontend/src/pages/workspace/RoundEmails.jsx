import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Loading, Empty, ErrorNote, Modal, Confirm, Spinner, useToast } from "./ui";
import {
  fetchEmailMeta, fetchEmailTemplates, createEmailTemplate, updateEmailTemplate,
  deleteEmailTemplate, previewEmail, testSendEmail,
  fetchEmailWorkflow, setEmailWorkflow, clearEmailWorkflow,
} from "../../utils/workspaceApi";

/*
 * Round → Emails.
 *
 * The primary feature is the WORKFLOW: for each event this round can raise, which
 * email goes out and whether it is on. Templates are the content underneath, kept
 * separate so one template can serve several events and assigning never copies.
 *
 * Three states are shown distinctly, because they behave differently at send time:
 *   ON              → that template is sent
 *   OFF             → nothing is sent
 *   Not configured  → the built-in email is used, exactly as before
 */

const STATE_UI = {
  on:             { label: "ON",             color: "#16A34A", bg: "#DCFCE7" },
  off:            { label: "OFF",            color: "#B91C1C", bg: "#FEE2E2" },
  not_configured: { label: "Not configured", color: "#64748B", bg: "#F1F5F9" },
};

function StateChip({ state }) {
  const s = STATE_UI[state] || STATE_UI.not_configured;
  return <span className="ad-badge" style={{ background: s.bg, color: s.color, fontWeight: 700 }}>{s.label}</span>;
}

/* ── One event row in the workflow ─────────────────────────────────────────── */
function EventRow({ event, templates, busy, onChoose }) {
  const assigned = templates.find((t) => String(t._id) === String(event.templateId));
  return (
    <div className="ws-round-card" style={{ marginBottom: 10 }}>
      <div className="re-event">
        <div className="re-event-main">
          <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
            <strong style={{ fontSize: 15 }}>{event.label}</strong>
            <StateChip state={event.state} />
          </div>
          <div className="ad-hint" style={{ marginTop: 4 }}>{event.fires}</div>
          {event.state === "not_configured" && (
            <div className="ad-hint" style={{ marginTop: 6, color: "#64748B" }}>
              The built-in email is sent. Choose <strong>Send nothing</strong> if you do not want any email at this event.
            </div>
          )}
          {event.state === "off" && (
            <div className="ad-hint" style={{ marginTop: 6, color: "#B91C1C" }}>
              <strong>No email is sent</strong> at this event.
            </div>
          )}
          {event.state === "on" && assigned && (
            <div className="ad-hint" style={{ marginTop: 6, color: "#16A34A" }}>
              Sends <strong>{assigned.name}</strong>.
            </div>
          )}
        </div>

        <div className="re-event-controls">
          {/* ONE control with three explicit outcomes. A separate dropdown plus a
              toggle could not express "send nothing" for an event that had no
              template, which left the built-in email firing with no way to stop
              it short of inventing a throwaway template. */}
          <label className="ad-label" style={{ fontSize: 11 }}>What happens at this event</label>
          <select
            className="ad-input ad-select"
            value={event.state === "not_configured" ? "builtin" : (event.state === "off" ? "nothing" : (event.templateId || "nothing"))}
            disabled={busy}
            onChange={(e) => onChoose(event, e.target.value)}
          >
            <option value="builtin">Use the built-in email (default)</option>
            <option value="nothing">Send nothing</option>
            {templates.length > 0 && (
              <optgroup label="Send this template">
                {templates.map((t) => <option key={t._id} value={t._id}>{t.name}</option>)}
              </optgroup>
            )}
          </select>
          {busy && <div className="ad-hint" style={{ marginTop: 6 }}><Spinner />Saving…</div>}
          {assigned && !assigned.enabled && (
            <div className="ad-hint" style={{ marginTop: 6, color: "#B45309" }}>
              “{assigned.name}” is itself disabled, so nothing sends.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/* ── Template editor ──────────────────────────────────────────────────────── */
function TemplateEditor({ roundId, initial, placeholders, triggers, onClose, onSaved, toast }) {
  const [name, setName]       = useState(initial?.name || "");
  const [subject, setSubject] = useState(initial?.subject || "");
  const [html, setHtml]       = useState(initial?.html || DEFAULT_HTML);
  const [trigger, setTrigger] = useState(initial?.trigger || "");
  const [enabled, setEnabled] = useState(initial?.enabled !== false);
  const [saving, setSaving]   = useState(false);
  const [err, setErr]         = useState("");
  const [preview, setPreview] = useState(null);
  const [previewing, setPreviewing] = useState(false);
  const [focus, setFocus]     = useState("html");   // where a placeholder click inserts

  // Insert at the caret of whichever field was last focused, so a placeholder
  // can go into the subject as easily as the body.
  const insert = (token) => {
    const t = `{{${token}}}`;
    const id = focus === "subject" ? "re-subject" : "re-html";
    const el = document.getElementById(id);
    const setter = focus === "subject" ? setSubject : setHtml;
    const cur = focus === "subject" ? subject : html;
    if (!el) { setter(cur + t); return; }
    const s = el.selectionStart ?? cur.length;
    const e = el.selectionEnd ?? cur.length;
    setter(cur.slice(0, s) + t + cur.slice(e));
    requestAnimationFrame(() => { el.focus(); el.selectionStart = el.selectionEnd = s + t.length; });
  };

  const body = () => ({ roundId, name, subject, html, enabled, ...(trigger ? { trigger } : {}) });

  const doPreview = async () => {
    setPreviewing(true); setErr("");
    try {
      const r = await previewEmail({ roundId, subject, html });
      setPreview(r.data.data);
    } catch (e) { setErr(e?.response?.data?.message || "Could not render the preview."); }
    finally { setPreviewing(false); }
  };

  const save = async () => {
    setSaving(true); setErr("");
    try {
      if (initial?._id) await updateEmailTemplate(initial._id, body());
      else await createEmailTemplate(body());
      toast({ type: "success", title: initial ? "Template updated" : "Template created" });
      onSaved();
    } catch (e) {
      // Backend rules (the {{link}} requirement especially) are surfaced verbatim
      // rather than re-implemented here, so there is one source of truth.
      setErr(e?.response?.data?.message || "Unable to save the email template. Please try again.");
    } finally { setSaving(false); }
  };

  return (
    <Modal
      wide
      title={initial ? "Edit email template" : "Create email template"}
      sub="Write the email once, then assign it to as many events as you like."
      onClose={onClose}
      footer={
        <>
          <button className="ad-btn ad-btn--outline" onClick={onClose} disabled={saving}>Cancel</button>
          <button className="ad-btn ad-btn--outline" onClick={doPreview} disabled={previewing || saving}>
            {previewing ? <><Spinner />Rendering…</> : "Preview"}
          </button>
          <button className="ad-btn ad-btn--primary" onClick={save} disabled={saving}>
            {saving ? <><Spinner />Saving…</> : initial ? "Save changes" : "Create template"}
          </button>
        </>
      }
    >
      <div className="re-editor">
        <div className="re-editor-form">
          <div className="ad-field">
            <label className="ad-label">Email name</label>
            <input className="ad-input" value={name} autoFocus placeholder="e.g. Round 1 Assessment Link Email"
                   onChange={(e) => { setName(e.target.value); setErr(""); }} />
          </div>

          <div className="ad-field" style={{ marginTop: 10 }}>
            <label className="ad-label">Subject</label>
            <input id="re-subject" className="ad-input" value={subject}
                   placeholder="Your {{roundName}} assessment link"
                   onFocus={() => setFocus("subject")}
                   onChange={(e) => { setSubject(e.target.value); setErr(""); }} />
            <span className="ad-hint">Placeholders work here too.</span>
          </div>

          <div className="ad-field" style={{ marginTop: 10 }}>
            <label className="ad-label">Insert placeholder</label>
            <div className="re-tokens">
              {placeholders.map(([key, desc]) => (
                <button key={key} type="button" className="re-token" title={desc} onClick={() => insert(key)}>
                  {`{{${key}}}`}
                </button>
              ))}
            </div>
            <span className="ad-hint">Inserts into the {focus === "subject" ? "subject" : "body"} at your cursor.</span>
          </div>

          <div className="ad-field" style={{ marginTop: 10 }}>
            <label className="ad-label">HTML body</label>
            <textarea id="re-html" className="ad-input re-html" rows={16} spellCheck={false} value={html}
                      onFocus={() => setFocus("html")}
                      onChange={(e) => { setHtml(e.target.value); setErr(""); }} />
            <span className="ad-hint">Full HTML — tables, buttons, inline styles and images all work.</span>
          </div>

          <div className="ad-grid-2" style={{ marginTop: 10 }}>
            <div className="ad-field">
              <label className="ad-label">Intended for (optional)</label>
              <select className="ad-input ad-select" value={trigger} onChange={(e) => setTrigger(e.target.value)}>
                <option value="">Not specific to one event</option>
                {triggers.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
              </select>
              <span className="ad-hint">A label only — where it actually sends is set in the workflow above.</span>
            </div>
            <div className="ad-field">
              <label className="ad-label">Status</label>
              <select className="ad-input ad-select" value={enabled ? "1" : "0"} onChange={(e) => setEnabled(e.target.value === "1")}>
                <option value="1">Active</option>
                <option value="0">Disabled — never sends</option>
              </select>
            </div>
          </div>

          {err && <p className="ad-form-err" style={{ marginTop: 10 }}>{err}</p>}
        </div>

        <div className="re-editor-preview">
          <div className="ad-label" style={{ marginBottom: 6 }}>Preview</div>
          {!preview ? (
            <div className="ad-empty" style={{ margin: 0 }}>Click <strong>Preview</strong> to see this rendered with sample candidate data.</div>
          ) : (
            <div className="re-mail">
              <div className="re-mail-subject"><strong>Subject:</strong> {preview.subject || <em>(empty)</em>}</div>
              {/* Rendered by the backend, which owns placeholder substitution and
                  escaping — the frontend never substitutes anything itself. */}
              <iframe title="Email preview" className="re-mail-body" sandbox="" srcDoc={preview.html} />
            </div>
          )}
        </div>
      </div>
    </Modal>
  );
}

const DEFAULT_HTML = `<div style="font-family:Arial,Helvetica,sans-serif;max-width:600px;margin:0 auto;padding:24px;color:#111">
  <h2 style="color:#4F46E5;margin:0 0 12px">{{brand}}</h2>
  <p>Hello {{name}},</p>
  <p>Your {{roundName}} assessment for {{driveName}} is scheduled on <strong>{{date}}</strong>.</p>
  <p style="text-align:center;margin:28px 0">
    <a href="{{link}}" style="background:#4F46E5;color:#fff;padding:12px 28px;border-radius:8px;text-decoration:none;display:inline-block">Start assessment</a>
  </p>
  <p style="color:#6b7280;font-size:13px">If the button does not work, copy this link:<br>{{link}}</p>
</div>`;

/* ── Test send ────────────────────────────────────────────────────────────── */
function TestSendDialog({ roundId, template, onClose, toast }) {
  const [to, setTo] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [done, setDone] = useState(false);

  const send = async () => {
    setBusy(true); setErr("");
    try {
      await testSendEmail({ roundId, to, name: template.name, subject: template.subject,
                            html: template.html, trigger: template.trigger || undefined });
      setDone(true);
      toast({ type: "success", title: `Test email sent to ${to}` });
    } catch (e) { setErr(e?.response?.data?.message || "Could not send the test email."); }
    finally { setBusy(false); }
  };

  return (
    <Modal title="Send a test email" sub={template.name} onClose={onClose}
      footer={
        <>
          <button className="ad-btn ad-btn--outline" onClick={onClose}>Close</button>
          <button className="ad-btn ad-btn--primary" onClick={send} disabled={busy || !to.trim()}>
            {busy ? <><Spinner />Sending…</> : "Send test email"}
          </button>
        </>
      }>
      <div className="ad-field">
        <label className="ad-label">Send to</label>
        <input className="ad-input" value={to} autoFocus placeholder="you@example.com"
               onChange={(e) => { setTo(e.target.value); setErr(""); setDone(false); }} />
        <span className="ad-hint">Sent with sample candidate data, not to any real candidate.</span>
      </div>
      {done && <p style={{ color: "#16A34A", fontWeight: 700, marginTop: 10 }}>✓ Test email sent successfully.</p>}
      {err && <p className="ad-form-err" style={{ marginTop: 10 }}>{err}</p>}
    </Modal>
  );
}

/* ── The tab ──────────────────────────────────────────────────────────────── */
export default function RoundEmails({ round, readOnly }) {
  const roundId = round?._id;
  const { showToast, toastEl } = useToast();
  const [meta, setMeta] = useState({ triggers: [], placeholders: [] });
  const [workflow, setWorkflow] = useState([]);
  const [templates, setTemplates] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [busyEvent, setBusyEvent] = useState(null);
  const [editing, setEditing] = useState(null);     // template | "new"
  const [testing, setTesting] = useState(null);
  const [confirmDel, setConfirmDel] = useState(null);
  const [delBusy, setDelBusy] = useState(false);

  const load = useCallback(async () => {
    if (!roundId) return;
    setLoading(true); setError("");
    try {
      const [m, w, t] = await Promise.all([
        fetchEmailMeta(), fetchEmailWorkflow(roundId), fetchEmailTemplates(roundId),
      ]);
      setMeta(m.data.data || { triggers: [], placeholders: [] });
      setWorkflow(w.data.data || []);
      setTemplates(t.data.data || []);
    } catch (e) {
      setError(e?.response?.data?.message || "Unable to load the email configuration for this round.");
    } finally { setLoading(false); }
  }, [roundId]);

  // Reloads whenever the round changes, so switching rounds never shows another
  // round's configuration.
  useEffect(() => { load(); }, [load]);

  /*
   * Three outcomes, one handler:
   *   "builtin" → DELETE the row, so the event returns to the built-in email
   *   "nothing" → keep a row with no template and enabled false → sends nothing
   *   <id>      → assign that template and switch it on
   *
   * "builtin" must delete rather than write a disabled row: a disabled row means
   * "send nothing", which is the opposite of restoring the default.
   */
  const onChoose = async (event, choice) => {
    setBusyEvent(event.value);
    try {
      if (choice === "builtin") {
        if (event.id) await clearEmailWorkflow(event.id);
      } else if (choice === "nothing") {
        await setEmailWorkflow({ roundId, trigger: event.value, templateId: null, enabled: false });
      } else {
        await setEmailWorkflow({ roundId, trigger: event.value, templateId: choice, enabled: true });
      }
      const w = await fetchEmailWorkflow(roundId);
      setWorkflow(w.data.data || []);
      showToast({ type: "success", title: "Saved" });
    } catch (e) {
      showToast({ type: "error", title: e?.response?.data?.message || "Unable to save email configuration. Please try again." });
      // Re-read so the control snaps back to what the server actually holds
      // rather than showing a choice that was refused.
      try { const w = await fetchEmailWorkflow(roundId); setWorkflow(w.data.data || []); } catch { /* keep the error visible */ }
    } finally { setBusyEvent(null); }
  };

  const assignedTo = useMemo(() => {
    const map = {};
    workflow.forEach((w) => { if (w.templateId) (map[w.templateId] ||= []).push(w.label); });
    return map;
  }, [workflow]);

  const doDelete = async () => {
    setDelBusy(true);
    try {
      await deleteEmailTemplate(confirmDel._id);
      setConfirmDel(null);
      showToast({ type: "success", title: "Template deleted" });
      await load();
    } catch (e) {
      showToast({ type: "error", title: e?.response?.data?.message || "Could not delete the template." });
    } finally { setDelBusy(false); }
  };

  if (loading) return <Loading label="Loading email configuration…" />;
  if (error) return <ErrorNote message={error} onRetry={load} />;

  return (
    <div>
      {toastEl}

      {/* SECTION 1 — the workflow. The whole point of the page: at a glance,
          which email goes out at each stage of this round. */}
      <div className="ad-card-section" style={{ marginBottom: 16 }}>
        <div className="ad-card-section-title">📧 {round?.name} — Email workflow</div>
        <span className="ad-hint" style={{ display: "block", marginBottom: 12 }}>
          For each event, choose the email that should go out and switch it on or off.
          <strong> Not configured</strong> keeps the existing built-in email; <strong>OFF</strong> sends nothing at all.
        </span>
        {workflow.map((event) => (
          <EventRow key={event.value} event={event} templates={templates}
                    busy={busyEvent === event.value || readOnly}
                    onChoose={onChoose} />
        ))}
      </div>

      {/* SECTION 2 — the content behind the workflow. */}
      <div className="ad-card-section">
        <div className="ad-card-section-title" style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <span>Email templates ({templates.length})</span>
          {!readOnly && <button className="ad-btn ad-btn--sm ad-btn--primary" onClick={() => setEditing("new")}>+ Create email template</button>}
        </div>

        {templates.length === 0 ? (
          <Empty icon="✉️" title="No email templates yet"
                 hint="Create one, then assign it to an event above. Until then this round keeps using the built-in emails." />
        ) : templates.map((t) => (
          <div key={t._id} className="ws-round-card" style={{ marginBottom: 8 }}>
            <div className="re-tpl">
              <div style={{ minWidth: 0, flex: 1 }}>
                <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                  <strong>{t.name}</strong>
                  <span className="ad-badge" style={{ background: t.enabled ? "#DCFCE7" : "#FEE2E2", color: t.enabled ? "#16A34A" : "#B91C1C" }}>
                    {t.enabled ? "Active" : "Disabled"}
                  </span>
                  {(assignedTo[String(t._id)] || []).map((lbl) => (
                    <span key={lbl} className="ad-badge ad-badge--blue">{lbl}</span>
                  ))}
                  {!assignedTo[String(t._id)] && <span className="ad-badge ad-badge--gray">Not assigned</span>}
                </div>
                <div className="ad-hint" style={{ marginTop: 4, wordBreak: "break-word" }}>{t.subject}</div>
              </div>
              {!readOnly && (
                <div className="re-tpl-actions">
                  <button className="ad-btn ad-btn--sm ad-btn--outline" onClick={() => setEditing(t)}>Edit</button>
                  <button className="ad-btn ad-btn--sm ad-btn--outline" onClick={() => setTesting(t)}>Test send</button>
                  <button className="ad-btn ad-btn--sm ad-btn--danger" onClick={() => setConfirmDel(t)}>Delete</button>
                </div>
              )}
            </div>
          </div>
        ))}
      </div>

      {editing && (
        <TemplateEditor
          roundId={roundId}
          initial={editing === "new" ? null : editing}
          placeholders={meta.placeholders || []}
          triggers={(meta.triggers || []).filter((t) => t.value !== "MANUAL")}
          onClose={() => setEditing(null)}
          onSaved={() => { setEditing(null); load(); }}
          toast={showToast}
        />
      )}

      {testing && <TestSendDialog roundId={roundId} template={testing} onClose={() => setTesting(null)} toast={showToast} />}

      {confirmDel && (
        <Confirm
          title="Delete this email template?"
          message={
            (assignedTo[String(confirmDel._id)] || []).length
              ? `“${confirmDel.name}” is currently assigned to ${assignedTo[String(confirmDel._id)].join(", ")}. Deleting it means those events send nothing until you assign another template.`
              : `“${confirmDel.name}” is not assigned to any event. Deleting it affects nothing else.`
          }
          confirmLabel="Delete" tone="danger" loading={delBusy}
          onConfirm={doDelete} onCancel={() => setConfirmDel(null)}
        />
      )}
    </div>
  );
}
