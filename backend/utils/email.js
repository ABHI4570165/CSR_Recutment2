const nodemailer = require("nodemailer");
const path = require("path");
const fs = require("fs");

let transporter = null;

// Logo referenced from the public frontend origin (FRONTEND_URL/logo.png).
// A hosted HTTPS URL renders reliably in Gmail, Outlook, and all webmail —
// works in both SMTP and Brevo HTTPS API mode (no CID, no attachment).
function logoImgTag() {
  const logoUrl = `${(process.env.FRONTEND_URL || "http://localhost:5173").replace(/\/+$/, "")}/logo.png`;
  return `<img src="${logoUrl}" alt="M H Foundation" width="64" height="64" style="display:block;margin:0 auto 10px;border-radius:12px;background:#fff;padding:4px;" />`;
}

// ── Delivery mode ──────────────────────────────────────────────────────────────
// Render's free/standard egress BLOCKS outbound SMTP ports (25/465/587). When a
// Brevo HTTP API key is present we send over HTTPS (443) — which Render allows —
// instead of SMTP. This is the production-correct path; SMTP stays as a fallback
// (and is what runs locally).
function usingApi() { return !!process.env.BREVO_API_KEY; }

// Structural sanity check for the Brevo key (no value exposed).
function apiKeyLooksValid() {
  const k = process.env.BREVO_API_KEY || "";
  return k.startsWith("xsmtpsib-") && k.length > 50;
}

// Full, password-free error dump for Render logs.
function logMailError(ctx, err) {
  console.error(`[email] ✖ ${ctx} FAILED`);
  console.error(`        message:      ${err?.message}`);
  console.error(`        code:         ${err?.code}`);
  console.error(`        command:      ${err?.command}`);
  console.error(`        responseCode: ${err?.responseCode}`);
  console.error(`        response:     ${err?.response}`);
  if (err?.stack) console.error(`        stack:        ${String(err.stack).split("\n").slice(0, 4).join(" | ")}`);
}

function getTransporter() {
  if (transporter) return transporter;
  const port = parseInt(process.env.EMAIL_PORT) || 587;
  const secure = String(process.env.EMAIL_SECURE) === "true"; // true for 465, false for 587/STARTTLS
  console.log(`[email] STEP 2 creating SMTP transport host=${process.env.EMAIL_HOST || "smtp.gmail.com"} port=${port} secure=${secure}`);
  transporter = nodemailer.createTransport({
    host:   process.env.EMAIL_HOST || "smtp.gmail.com",
    port,
    secure,
    auth: { user: process.env.EMAIL_USER, pass: process.env.EMAIL_PASS },
    requireTLS: !secure,                 // enforce STARTTLS on 587
    pool: true,
    maxConnections: parseInt(process.env.EMAIL_MAX_CONNECTIONS) || 5,
    maxMessages: 100,
    rateDelta: 1000,
    rateLimit: parseInt(process.env.EMAIL_RATE_LIMIT) || 5,
    // Explicit timeouts so a BLOCKED port fails fast & loud instead of hanging forever.
    connectionTimeout: parseInt(process.env.EMAIL_CONN_TIMEOUT) || 10000, // TCP connect
    greetingTimeout:   parseInt(process.env.EMAIL_GREET_TIMEOUT) || 10000, // SMTP greeting
    socketTimeout:     parseInt(process.env.EMAIL_SOCKET_TIMEOUT) || 20000, // inactivity
  });
  console.log(`[email] STEP 3 SMTP transport created`);
  return transporter;
}

function emailConfigured() {
  return usingApi() || !!(process.env.EMAIL_USER && process.env.EMAIL_PASS);
}

// Non-secret diagnostic of which email vars are present (for logging / test endpoint).
function emailDiag() {
  return {
    mode: usingApi() ? "brevo-api(https:443)" : "smtp",
    apiKeySet: usingApi(),
    apiKeyLooksValid: apiKeyLooksValid(),
    host: process.env.EMAIL_HOST || "(default smtp.gmail.com)",
    port: process.env.EMAIL_PORT || "587",
    secure: String(process.env.EMAIL_SECURE) === "true",
    userSet: !!process.env.EMAIL_USER,
    passSet: !!process.env.EMAIL_PASS,
    from: process.env.EMAIL_FROM || "(default)",
    configured: emailConfigured(),
  };
}

// Parse "Name <email@x>" or "email@x" into { name, email } for the Brevo API.
function parseFrom(raw) {
  const s = String(raw || "M H Foundation <no-reply@mhacademy.in>").trim();
  const m = s.match(/^\s*"?([^"<]*)"?\s*<([^>]+)>\s*$/);
  if (m) return { name: m[1].trim() || "M H Foundation", email: m[2].trim() };
  return { name: "M H Foundation", email: s };
}

// ── Send over Brevo HTTPS API (port 443 — not blocked on Render) ───────────────
async function sendViaBrevoApi({ to, subject, html, text, attachments }) {
  if (typeof fetch !== "function") throw new Error("global fetch unavailable — Node 18+ required for Brevo API mode");
  const sender = parseFrom(process.env.EMAIL_FROM);
  const payload = {
    sender,
    to: [{ email: to }],
    subject,
    ...(html ? { htmlContent: html } : {}),
    ...(text ? { textContent: text } : {}),
  };
  if (attachments && attachments.length) {
    payload.attachment = attachments
      .filter(a => a.path && fs.existsSync(a.path))
      .map(a => ({ name: a.filename || "attachment", content: fs.readFileSync(a.path).toString("base64") }));
  }
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), parseInt(process.env.EMAIL_API_TIMEOUT) || 15000);
  let resp, data;
  try {
    resp = await fetch("https://api.brevo.com/v3/smtp/email", {
      method: "POST",
      headers: { "api-key": process.env.BREVO_API_KEY, "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify(payload),
      signal: ctrl.signal,
    });
    data = await resp.json().catch(() => ({}));
  } finally { clearTimeout(timer); }
  if (!resp.ok) {
    const msg = resp.status === 401
      ? "Brevo API key is invalid or has been revoked. Regenerate it at app.brevo.com → Settings → API Keys and update BREVO_API_KEY in your Render environment variables."
      : `Brevo API ${resp.status}: ${data?.message || data?.code || JSON.stringify(data)}`;
    const e = new Error(msg);
    e.code = `BREVO_${resp.status}`; e.responseCode = resp.status; e.response = JSON.stringify(data);
    throw e;
  }
  console.log(`[email] STEP 7 accepted by Brevo API · STEP 8 messageId=${data?.messageId}`);
  return data?.messageId || "brevo-api";
}

// Verify the transport before sending. Returns { ok, error }.
async function verifyTransport() {
  if (usingApi()) {
    console.log("[email] STEP 4 verify skipped (Brevo HTTPS API mode) · STEP 5 ok");
    return { ok: true, mode: "api" };
  }
  try {
    console.log("[email] STEP 4 verifying SMTP connection…");
    await getTransporter().verify();
    console.log("[email] STEP 5 SMTP verified OK");
    return { ok: true, mode: "smtp" };
  } catch (err) {
    logMailError("SMTP verify", err);
    return { ok: false, error: err.message, code: err.code };
  }
}

// Generic send. Throws on failure so the queue can record + retry.
async function sendMail({ to, subject, html, text, attachments }) {
  const api = usingApi();
  console.log(`[email] STEP 6 sending → to=${to} subject="${subject}" via=${api ? "Brevo-API(HTTPS)" : `SMTP ${process.env.EMAIL_HOST}:${process.env.EMAIL_PORT || 587}`}`);
  try {
    if (api) return await sendViaBrevoApi({ to, subject, html, text, attachments });
    const t = getTransporter();
    const info = await t.sendMail({
      from: process.env.EMAIL_FROM || "M H Foundation <noreply@mhacademy.in>",
      to, subject, html, text,
      ...(attachments && attachments.length ? { attachments } : {}),
    });
    console.log(`[email] STEP 7 accepted=${JSON.stringify(info.accepted)} rejected=${JSON.stringify(info.rejected)} · STEP 8 messageId=${info.messageId}`);
    return info.messageId;
  } catch (err) {
    logMailError(`sendMail to ${to}`, err);
    throw err;
  }
}

// ── Brand constants ───────────────────────────────────────────────────────────
const BRAND = "M H FOUNDATION";
const HIRING_PARTNER = "Inference Labs Private Limited";
const PRIMARY = "#1a56db";

// Escape values interpolated into email HTML (names come from CSV — untrusted).
function esc(s) {
  return String(s ?? "")
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

function fmtDate(d) {
  if (!d) return "—";
  return new Date(d).toLocaleString("en-IN", {
    day: "numeric", month: "long", year: "numeric",
    hour: "2-digit", minute: "2-digit", timeZone: "Asia/Kolkata",
  });
}
function fmtDateOnly(d) {
  if (!d) return "—";
  return new Date(d).toLocaleDateString("en-IN", { day: "numeric", month: "long", year: "numeric", timeZone: "Asia/Kolkata" });
}
function fmtTimeOnly(d) {
  if (!d) return "—";
  return new Date(d).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", timeZone: "Asia/Kolkata" });
}

function shell(innerHtml) {
  return `
  <div style="background:#f3f4f6;padding:24px 12px;font-family:Segoe UI,Arial,sans-serif;">
    <div style="max-width:600px;margin:0 auto;background:#fff;border-radius:14px;overflow:hidden;border:1px solid #e5e7eb;">
      <div style="background:linear-gradient(135deg,${PRIMARY},#1e3a8a);padding:28px;text-align:center;">
        ${logoImgTag()}
        <div style="color:#fff;font-size:24px;font-weight:800;letter-spacing:1px;">${BRAND}</div>
        <div style="color:rgba(255,255,255,.85);font-size:12px;margin-top:6px;">Hiring Partner — ${HIRING_PARTNER}</div>
      </div>
      ${innerHtml}
      <div style="background:#0f172a;padding:20px 28px;text-align:center;">
        <div style="color:#e2e8f0;font-size:13px;font-weight:700;">${BRAND}</div>
        <div style="color:#94a3b8;font-size:11px;margin-top:4px;">In association with ${HIRING_PARTNER}</div>
        <div style="color:#64748b;font-size:10px;margin-top:8px;">This is an automated message. Please do not reply.</div>
      </div>
    </div>
  </div>`;
}

// ── Shortlist email (sent immediately on upload) ──────────────────────────────
function shortlistHtml({ name, dateStr, timeStr }) {
  const inner = `
    <div style="padding:32px 28px;">
      <div style="text-align:center;font-size:38px;margin-bottom:6px;">🎉</div>
      <h2 style="color:#111827;font-size:20px;margin:0 0 6px;text-align:center;">Congratulations, ${esc(name)}!</h2>
      <p style="color:#4b5563;font-size:14px;line-height:1.6;margin:0 0 20px;text-align:center;">
        You have been <strong>shortlisted</strong> to participate in the recruitment assessment conducted by
        <strong>${BRAND}</strong> in association with <strong>${HIRING_PARTNER}</strong>.
      </p>
      <table style="width:100%;border-collapse:collapse;background:#f9fafb;border:1px solid #e5e7eb;border-radius:10px;overflow:hidden;font-size:14px;margin-bottom:18px;">
        <tr><td style="padding:12px 16px;color:#6b7280;width:45%;">Assessment Date</td><td style="padding:12px 16px;color:#111827;font-weight:700;">${esc(dateStr)}</td></tr>
        <tr style="border-top:1px solid #e5e7eb;"><td style="padding:12px 16px;color:#6b7280;">Assessment Time</td><td style="padding:12px 16px;color:#111827;font-weight:700;">${esc(timeStr)}</td></tr>
      </table>
      <p style="color:#374151;font-size:13.5px;margin:0 0 8px;font-weight:700;">Please ensure you have:</p>
      <ul style="color:#4b5563;font-size:13px;line-height:1.8;margin:0 0 18px;padding-left:18px;">
        <li>Laptop / Desktop Computer</li><li>Working Webcam</li><li>Stable Internet Connection</li>
        <li>Quiet Environment</li><li>Updated Chrome or Edge Browser</li>
      </ul>
      <div style="background:#fffbeb;border:1px solid #fde68a;border-radius:10px;padding:14px 16px;">
        <p style="color:#92400e;font-size:13px;margin:0;line-height:1.6;">
          <strong>Important:</strong> Your assessment link will be shared separately before the assessment.
          Please make yourself available during the scheduled assessment window.
        </p>
      </div>
    </div>`;
  return shell(inner);
}

// ── Assessment-link email (sent at the configured time) ───────────────────────
function linkReadyHtml({ name, dateStr, timeStr, link }) {
  const safeLink = encodeURI(String(link || ""));
  const inner = `
    <div style="padding:32px 28px;">
      <h2 style="color:#111827;font-size:19px;margin:0 0 10px;">Dear ${esc(name)},</h2>
      <p style="color:#4b5563;font-size:14px;line-height:1.6;margin:0 0 18px;">Your assessment is scheduled as follows:</p>
      <table style="width:100%;border-collapse:collapse;background:#f9fafb;border:1px solid #e5e7eb;border-radius:10px;overflow:hidden;font-size:14px;margin-bottom:20px;">
        <tr><td style="padding:12px 16px;color:#6b7280;width:30%;">Date</td><td style="padding:12px 16px;color:#111827;font-weight:700;">${esc(dateStr)}</td></tr>
        <tr style="border-top:1px solid #e5e7eb;"><td style="padding:12px 16px;color:#6b7280;">Time</td><td style="padding:12px 16px;color:#111827;font-weight:700;">${esc(timeStr)}</td></tr>
      </table>
      <p style="color:#4b5563;font-size:14px;margin:0 0 14px;">You may now access your assessment using the link below:</p>
      <div style="text-align:center;margin:18px 0;">
        <a href="${safeLink}" style="background:${PRIMARY};color:#fff;padding:15px 44px;border-radius:10px;text-decoration:none;font-weight:700;font-size:15px;display:inline-block;">
          Open Assessment →
        </a>
      </div>
      <p style="color:#374151;font-size:13px;font-weight:700;margin:18px 0 6px;">Please ensure:</p>
      <ul style="color:#4b5563;font-size:13px;line-height:1.8;margin:0 0 14px;padding-left:18px;">
        <li>Fullscreen mode is enabled</li><li>Webcam is available</li>
        <li>Stable internet connection</li><li>Assessment is attempted only within the scheduled window</li>
      </ul>
      <p style="color:#9ca3af;font-size:11px;text-align:center;margin:8px 0 0;word-break:break-all;">
        This link is unique to you — do not share it.<br/><span style="color:${PRIMARY};">${esc(safeLink)}</span>
      </p>
    </div>`;
  return shell(inner);
}

// ── Disqualification email ────────────────────────────────────────────────────
function disqualificationHtml({ name }) {
  const inner = `
    <div style="padding:32px 28px;">
      <div style="text-align:center;font-size:38px;margin-bottom:6px;">🚫</div>
      <h2 style="color:#111827;font-size:19px;margin:0 0 12px;text-align:center;">Assessment Session Terminated</h2>
      <p style="color:#4b5563;font-size:14px;line-height:1.6;margin:0 0 14px;">Dear ${esc(name || "Candidate")},</p>
      <p style="color:#4b5563;font-size:14px;line-height:1.6;margin:0 0 14px;">
        We detected multiple violations of the assessment guidelines during your assessment session.
        As a result, your assessment has been automatically terminated.
      </p>
      <p style="color:#4b5563;font-size:14px;line-height:1.6;margin:0 0 14px;">
        You may participate in future recruitment opportunities conducted by ${BRAND} and ${HIRING_PARTNER}.
      </p>
      <p style="color:#4b5563;font-size:14px;line-height:1.6;margin:0;">Thank you for your interest.</p>
    </div>`;
  return shell(inner);
}

function thankYouHtml({ name, assessmentName }) {
  const inner = `
    <div style="padding:32px 28px;">
      <div style="text-align:center;font-size:40px;margin-bottom:8px;">✅</div>
      <h2 style="color:#111827;font-size:19px;margin:0 0 10px;text-align:center;">Thank You, ${esc(name)}!</h2>
      <p style="color:#4b5563;font-size:14px;line-height:1.6;margin:0 0 18px;text-align:center;">
        Your responses for <strong>${esc(assessmentName || "the assessment")}</strong> have been submitted successfully and recorded.
      </p>
      <div style="background:#ecfdf5;border:1px solid #a7f3d0;border-radius:10px;padding:16px;text-align:center;">
        <p style="color:#065f46;font-size:13px;margin:0;line-height:1.6;">
          Assessment completed. Shortlisted candidates will be contacted by <strong>${HIRING_PARTNER}</strong> through official channels.
          We appreciate your time and effort. Best of luck!
        </p>
      </div>
    </div>`;
  return shell(inner);
}

// Assessment-LINK email (this is what the scheduler sends at link-send time).
async function sendLinkEmail(candidate, assessment, link) {
  const dateStr = fmtDateOnly(assessment.assessmentDate || assessment.startAt);
  const timeStr = assessment.startAt ? fmtTimeOnly(assessment.startAt) : "as scheduled";
  return sendMail({
    to: candidate.email,
    subject: `Your Assessment Link Is Ready | ${BRAND}`,
    html: linkReadyHtml({ name: candidate.name, dateStr, timeStr, link }),
    text: `Dear ${candidate.name},\n\nYour assessment is scheduled on ${dateStr} at ${timeStr}.\n\nOpen your assessment: ${link}\n\nEnsure fullscreen, webcam, and a stable connection. Attempt only within the scheduled window.\n\n${BRAND} · ${HIRING_PARTNER}`,
  });
}
// Back-compat alias — older code/imports call sendInvitationEmail.
const sendInvitationEmail = sendLinkEmail;

async function sendShortlistEmail(candidate, assessment) {
  const dateStr = fmtDateOnly(assessment.assessmentDate || assessment.startAt);
  const timeStr = assessment.startAt ? fmtTimeOnly(assessment.startAt) : "to be announced";
  return sendMail({
    to: candidate.email,
    subject: `Congratulations! You Have Been Shortlisted | ${BRAND}`,
    html: shortlistHtml({ name: candidate.name, dateStr, timeStr }),
    text: `Dear ${candidate.name},\n\nCongratulations! You have been shortlisted for the recruitment assessment by ${BRAND} in association with ${HIRING_PARTNER}.\n\nAssessment Date: ${dateStr}\nAssessment Time: ${timeStr}\n\nEnsure you have a laptop/desktop, webcam, stable internet, a quiet room, and updated Chrome/Edge.\n\nYour assessment link will be shared separately before the assessment.\n\n${BRAND} · ${HIRING_PARTNER}`,
  });
}

async function sendDisqualificationEmail(candidate) {
  return sendMail({
    to: candidate.email,
    subject: `Assessment Session Terminated | ${BRAND}`,
    html: disqualificationHtml({ name: candidate.name }),
    text: `Dear ${candidate.name || "Candidate"},\n\nWe detected multiple violations of the assessment guidelines during your assessment session. As a result, your assessment has been automatically terminated.\n\nYou may participate in future recruitment opportunities conducted by ${BRAND} and ${HIRING_PARTNER}.\n\nThank you for your interest.\n\n${BRAND} · ${HIRING_PARTNER}`,
  });
}

async function sendThankYouEmail(candidate, assessment) {
  return sendMail({
    to: candidate.email,
    subject: `Assessment Completed — ${assessment?.name || ""} | ${BRAND}`,
    html: thankYouHtml({ name: candidate.name, assessmentName: assessment?.name }),
    text: `Thank you ${candidate.name}! Your responses for ${assessment?.name || "the assessment"} have been recorded.\n\n${BRAND} · ${HIRING_PARTNER}`,
  });
}

// ── Legacy (kept for backward compatibility — unchanged behaviour) ─────────────
async function sendQuizLink(to, name, quizLink) {
  try {
    await sendMail({
      to,
      subject: "Your Quiz Link — M H Foundation",
      html: `
        <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;background:#fff;border-radius:12px;overflow:hidden;border:1px solid #e5e7eb;">
          <div style="background:linear-gradient(135deg,#1a56db,#1e40af);padding:32px 28px;text-align:center;">
            <h1 style="color:#fff;margin:0;font-size:22px;">M H Foundation</h1>
          </div>
          <div style="padding:32px 28px;">
            <h2 style="color:#111827;font-size:18px;margin:0 0 12px;">Hello, ${name}! 👋</h2>
            <div style="text-align:center;margin:28px 0;">
              <a href="${quizLink}" style="background:#1a56db;color:#fff;padding:14px 36px;border-radius:8px;text-decoration:none;font-weight:700;font-size:15px;display:inline-block;">Start Quiz →</a>
            </div>
          </div>
        </div>`,
    });
    return true;
  } catch (err) {
    console.error("Email send error:", err.message);
    return false;
  }
}

// ── Startup diagnostic (runs once when this module is first required) ───────────
(function logEmailStartup() {
  if (usingApi()) {
    console.log(`[email] startup → mode=brevo-api(https:443) · apiKeySet=true · apiKeyLooksValid=${apiKeyLooksValid()}`);
  } else {
    console.log(`[email] startup → mode=smtp · host=${process.env.EMAIL_HOST || "(default)"} · userSet=${!!process.env.EMAIL_USER} · passSet=${!!process.env.EMAIL_PASS}`);
  }
})();

module.exports = {
  sendMail,
  emailConfigured,
  emailDiag,
  verifyTransport,
  logMailError,
  sendInvitationEmail,
  sendLinkEmail,
  sendShortlistEmail,
  sendDisqualificationEmail,
  sendThankYouEmail,
  sendQuizLink,
  BRAND,
  HIRING_PARTNER,
};
