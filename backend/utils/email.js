const nodemailer = require("nodemailer");
const path = require("path");
const fs = require("fs");

let transporter = null;

// Logo embedded inline in emails via CID (works without any external hosting).
// Drop the academy logo at backend/assets/logo.png to enable it.
const LOGO_PATH = path.join(__dirname, "..", "assets", "logo.png");
const LOGO_CID = "mhacademylogo";
function logoExists() { try { return fs.existsSync(LOGO_PATH); } catch { return false; } }
function logoImgTag() {
  return logoExists()
    ? `<img src="cid:${LOGO_CID}" alt="MH Academy" width="64" height="64" style="display:block;margin:0 auto 10px;border-radius:12px;background:#fff;padding:4px;" />`
    : "";
}
function logoAttachment() {
  return logoExists() ? [{ filename: "logo.png", path: LOGO_PATH, cid: LOGO_CID }] : [];
}

function getTransporter() {
  if (transporter) return transporter;
  transporter = nodemailer.createTransport({
    host:   process.env.EMAIL_HOST || "smtp.gmail.com",
    port:   parseInt(process.env.EMAIL_PORT) || 587,
    secure: String(process.env.EMAIL_SECURE) === "true", // true for 465, false for 587
    auth: {
      user: process.env.EMAIL_USER,
      pass: process.env.EMAIL_PASS,
    },
    pool: true,
    maxConnections: parseInt(process.env.EMAIL_MAX_CONNECTIONS) || 5,
    maxMessages: 100,
    rateDelta: 1000,
    rateLimit: parseInt(process.env.EMAIL_RATE_LIMIT) || 5, // messages/sec — protects SMTP from a 500-burst
  });
  return transporter;
}

function emailConfigured() {
  return !!(process.env.EMAIL_USER && process.env.EMAIL_PASS);
}

// Non-secret diagnostic of which email vars are present (for logging / test endpoint).
function emailDiag() {
  return {
    host: process.env.EMAIL_HOST || "(default smtp.gmail.com)",
    port: process.env.EMAIL_PORT || "587",
    secure: String(process.env.EMAIL_SECURE) === "true",
    userSet: !!process.env.EMAIL_USER,
    passSet: !!process.env.EMAIL_PASS,
    from: process.env.EMAIL_FROM || "(default)",
    configured: !!(process.env.EMAIL_USER && process.env.EMAIL_PASS),
  };
}

// Verify SMTP auth without sending. Returns { ok, error }.
async function verifyTransport() {
  try { await getTransporter().verify(); return { ok: true }; }
  catch (err) { return { ok: false, error: err.message }; }
}

// Generic send. Throws on failure so the queue can record + retry.
async function sendMail({ to, subject, html, text, attachments }) {
  const t = getTransporter();
  const info = await t.sendMail({
    from: process.env.EMAIL_FROM || "MH Academy <noreply@mhacademy.in>",
    to, subject, html, text,
    ...(attachments && attachments.length ? { attachments } : {}),
  });
  return info.messageId;
}

// ── Brand constants ───────────────────────────────────────────────────────────
const BRAND = "MH ACADEMY";
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
    attachments: logoAttachment(),
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
    attachments: logoAttachment(),
  });
}

async function sendDisqualificationEmail(candidate) {
  return sendMail({
    to: candidate.email,
    subject: `Assessment Session Terminated | ${BRAND}`,
    html: disqualificationHtml({ name: candidate.name }),
    text: `Dear ${candidate.name || "Candidate"},\n\nWe detected multiple violations of the assessment guidelines during your assessment session. As a result, your assessment has been automatically terminated.\n\nYou may participate in future recruitment opportunities conducted by ${BRAND} and ${HIRING_PARTNER}.\n\nThank you for your interest.\n\n${BRAND} · ${HIRING_PARTNER}`,
    attachments: logoAttachment(),
  });
}

async function sendThankYouEmail(candidate, assessment) {
  return sendMail({
    to: candidate.email,
    subject: `Assessment Completed — ${assessment?.name || ""} | ${BRAND}`,
    html: thankYouHtml({ name: candidate.name, assessmentName: assessment?.name }),
    text: `Thank you ${candidate.name}! Your responses for ${assessment?.name || "the assessment"} have been recorded.\n\n${BRAND} · ${HIRING_PARTNER}`,
    attachments: logoAttachment(),
  });
}

// ── Legacy (kept for backward compatibility — unchanged behaviour) ─────────────
async function sendQuizLink(to, name, quizLink) {
  try {
    await sendMail({
      to,
      subject: "Your Quiz Link — Mandi Hariyanna Academy",
      html: `
        <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;background:#fff;border-radius:12px;overflow:hidden;border:1px solid #e5e7eb;">
          <div style="background:linear-gradient(135deg,#1a56db,#1e40af);padding:32px 28px;text-align:center;">
            <h1 style="color:#fff;margin:0;font-size:22px;">Mandi Hariyanna Academy</h1>
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

module.exports = {
  sendMail,
  emailConfigured,
  emailDiag,
  verifyTransport,
  sendInvitationEmail,
  sendLinkEmail,
  sendShortlistEmail,
  sendDisqualificationEmail,
  sendThankYouEmail,
  sendQuizLink,
  BRAND,
  HIRING_PARTNER,
};
