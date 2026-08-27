import React, { useCallback, useEffect, useState } from "react";
import { Modal, Confirm, Spinner } from "./ui";
import { fetchEmailTemplates, previewEmail, sendManualEmail } from "../../utils/workspaceApi";

/*
 * Send an existing email template to candidates picked from THIS round.
 *
 * The frontend never sends addresses — only candidate ids — so the backend stays
 * the thing that decides who may be mailed. It re-checks every id against the
 * workspace scope, which is what stops a stale or tampered id from reaching
 * someone in another workspace.
 *
 * Placeholder rendering, escaping and {{link}} handling all stay on the server:
 * the preview here is whatever POST /preview returns, shown in the same
 * sandboxed iframe the Emails tab uses.
 */
export default function ManualSendDialog({ round, candidates, onClose, onSent, toast }) {
  const roundId = round?._id;
  const [templates, setTemplates] = useState([]);
  const [templateId, setTemplateId] = useState("");
  const [loading, setLoading] = useState(true);
  const [preview, setPreview] = useState(null);
  const [previewing, setPreviewing] = useState(false);
  const [err, setErr] = useState("");
  const [confirming, setConfirming] = useState(false);
  const [sending, setSending] = useState(false);
  const [result, setResult] = useState(null);   // backend's own per-recipient outcome
  const [showAll, setShowAll] = useState(false);

  const selected = templates.find((t) => String(t._id) === String(templateId)) || null;

  useEffect(() => {
    let alive = true;
    fetchEmailTemplates(roundId)
      .then((r) => { if (alive) setTemplates(r.data.data || []); })
      .catch((e) => { if (alive) setErr(e?.response?.data?.message || "Could not load the email templates."); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [roundId]);

  // Render through the backend whenever the chosen template changes, so the
  // subject and body shown are exactly what it will produce.
  const loadPreview = useCallback(async (tpl) => {
    if (!tpl) { setPreview(null); return; }
    setPreviewing(true); setErr("");
    try {
      const r = await previewEmail({ roundId, subject: tpl.subject, html: tpl.html });
      setPreview(r.data.data);
    } catch (e) { setErr(e?.response?.data?.message || "Could not render the preview."); }
    finally { setPreviewing(false); }
  }, [roundId]);

  useEffect(() => { loadPreview(selected); }, [templateId, selected, loadPreview]);

  const send = async () => {
    if (sending) return;                    // guards a double-click on Confirm
    setSending(true); setErr("");
    try {
      const r = await sendManualEmail({
        roundId,
        templateId,
        candidateIds: candidates.map((c) => c._id),
      });
      const data = r.data.data || {};
      setResult(data);
      setConfirming(false);
      if (!data.failedCount) {
        toast({ type: "success", title: `Email sent to ${data.sentCount} candidate${data.sentCount === 1 ? "" : "s"}` });
        onSent?.();                          // clears the selection — success only
      }
    } catch (e) {
      setConfirming(false);
      // Selection is deliberately left intact so the send can be retried.
      setErr(e?.response?.data?.message || "Unable to send email. Please try again.");
    } finally { setSending(false); }
  };

  const shown = showAll ? candidates : candidates.slice(0, 5);
  const canSend = candidates.length > 0 && !!templateId;

  // The backend reports per-recipient outcomes, so a partial failure is shown as
  // exactly that rather than being rounded up to "sent".
  if (result) {
    return (
      <Modal title="Email sending completed" onClose={onClose}
        footer={<button className="ad-btn ad-btn--primary" onClick={onClose}>Close</button>}>
        <div style={{ display: "flex", gap: 16, flexWrap: "wrap", marginBottom: 12 }}>
          <div><div style={{ fontSize: 24, fontWeight: 800, color: "#16A34A" }}>{result.sentCount}</div><div className="ad-hint">sent</div></div>
          {result.failedCount > 0 && (
            <div><div style={{ fontSize: 24, fontWeight: 800, color: "#B91C1C" }}>{result.failedCount}</div><div className="ad-hint">failed</div></div>
          )}
        </div>
        {result.failedCount > 0 && (
          <div className="ms-fail">
            <strong>Failed</strong>
            {(result.failed || []).map((f, i) => (
              <div key={i} className="ad-hint" style={{ marginTop: 4 }}>{f.email} — {f.reason}</div>
            ))}
            <div className="ad-hint" style={{ marginTop: 8 }}>
              The selection has been kept so you can retry these.
            </div>
          </div>
        )}
      </Modal>
    );
  }

  return (
    <>
      <Modal
        wide
        title="Send email"
        sub={`${round?.name} — ${candidates.length} recipient${candidates.length === 1 ? "" : "s"}`}
        onClose={onClose}
        footer={
          <>
            <button className="ad-btn ad-btn--outline" onClick={onClose} disabled={sending}>Cancel</button>
            <button className="ad-btn ad-btn--primary" disabled={!canSend || sending}
                    title={canSend ? "" : "Select candidates and an email template"}
                    onClick={() => setConfirming(true)}>
              {sending ? <><Spinner />Sending…</> : "Send email"}
            </button>
          </>
        }
      >
        <div className="ms-grid">
          <div className="ms-form">
            <div className="ad-field">
              <label className="ad-label">Recipients ({candidates.length})</label>
              <div className="ms-recipients">
                {shown.map((c) => (
                  <div key={c._id} className="ms-recipient">
                    <span style={{ fontWeight: 600 }}>{c.name || "—"}</span>
                    <span className="ad-td-sm">{c.email || <em>no email address</em>}</span>
                  </div>
                ))}
                {candidates.length > 5 && (
                  <button type="button" className="ad-btn ad-btn--sm ad-btn--outline" style={{ marginTop: 6 }}
                          onClick={() => setShowAll((v) => !v)}>
                    {showAll ? "Show fewer" : `Show all ${candidates.length}`}
                  </button>
                )}
              </div>
            </div>

            <div className="ad-field" style={{ marginTop: 12 }}>
              <label className="ad-label">Email template</label>
              {loading ? <div className="ad-hint"><Spinner />Loading templates…</div>
                : templates.length === 0 ? (
                  <div className="ad-hint">
                    This round has no email templates yet. Create one under the <strong>Emails</strong> tab first.
                  </div>
                ) : (
                  <select className="ad-input ad-select" value={templateId}
                          onChange={(e) => { setTemplateId(e.target.value); setErr(""); }}>
                    <option value="">Select an email template…</option>
                    {templates.map((t) => (
                      <option key={t._id} value={t._id}>{t.name}{t.enabled ? "" : " (disabled)"}</option>
                    ))}
                  </select>
                )}
            </div>

            {selected && (
              <div className="ad-field" style={{ marginTop: 12 }}>
                <label className="ad-label">Subject</label>
                {/* The backend-rendered subject, not the raw template text. */}
                <div className="ms-subject">{previewing ? "Rendering…" : (preview?.subject || selected.subject)}</div>
                {!selected.enabled && (
                  <span className="ad-hint" style={{ color: "#B45309" }}>
                    This template is disabled for automatic events, but sending it manually still works.
                  </span>
                )}
              </div>
            )}

            {err && <p className="ad-form-err" style={{ marginTop: 10 }}>{err}</p>}
          </div>

          <div className="ms-preview">
            <div className="ad-label" style={{ marginBottom: 6 }}>Preview</div>
            {!selected ? (
              <div className="ad-empty" style={{ margin: 0 }}>Choose a template to see how it will look.</div>
            ) : previewing ? (
              <div className="ad-empty" style={{ margin: 0 }}><Spinner />Rendering…</div>
            ) : (
              <div className="re-mail">
                <div className="re-mail-subject"><strong>Subject:</strong> {preview?.subject}</div>
                <iframe title="Email preview" className="re-mail-body" sandbox="" srcDoc={preview?.html || ""} />
              </div>
            )}
          </div>
        </div>
      </Modal>

      {confirming && (
        <Confirm
          title="Send this email?"
          message={
            <>
              <div style={{ marginBottom: 8 }}><strong>{selected?.name}</strong></div>
              <div>This will send an email to <strong>{candidates.length} candidate{candidates.length === 1 ? "" : "s"}</strong> in {round?.name}.</div>
            </>
          }
          confirmLabel="Confirm & send" busyLabel="Sending…" loading={sending}
          onConfirm={send} onCancel={() => setConfirming(false)}
        />
      )}
    </>
  );
}
