const Candidate  = require("../models/Candidate");
const Assessment = require("../models/Assessment");
const {
  sendLinkEmail, sendShortlistEmail, sendThankYouEmail, sendDisqualificationEmail,
  emailConfigured, emailDiag, logMailError,
} = require("./email");

const MAX_ATTEMPTS  = parseInt(process.env.EMAIL_MAX_ATTEMPTS) || 3;
const POLL_INTERVAL = parseInt(process.env.EMAIL_POLL_INTERVAL_MS) || 30000; // 30s
const BATCH_SIZE    = parseInt(process.env.EMAIL_BATCH_SIZE) || 25;          // per tick — throttles SMTP
const STALE_SENDING_MS = 5 * 60 * 1000; // re-queue a "sending" row stuck this long (crash recovery)

function buildLink(token) {
  const base = (process.env.FRONTEND_URL || "http://localhost:5173").replace(/\/+$/, "");
  return `${base}/assessment/${token}`;
}

/* ─────────────────────────────────────────────────────────────────────────────
 * LINK email track  (existing emailStatus/* fields)
 * ───────────────────────────────────────────────────────────────────────────── */
async function claimNextLink() {
  return Candidate.findOneAndUpdate(
    { emailStatus: "scheduled", emailScheduledAt: { $lte: new Date() }, emailAttempts: { $lt: MAX_ATTEMPTS } },
    { $set: { emailStatus: "sending" } },
    { new: true, sort: { emailScheduledAt: 1 } }
  );
}

async function deliverLink(candidate) {
  const assessment = await Assessment.findById(candidate.assessmentId).lean();
  if (!assessment) {
    candidate.emailStatus = "failed"; candidate.emailError = "Assessment not found";
    await candidate.save();
    return { ok: false, error: "Assessment not found", email: candidate.email };
  }
  try {
    const link = buildLink(candidate.token);
    const messageId = await sendLinkEmail(candidate, assessment, link);
    candidate.emailStatus = "sent"; candidate.emailSentAt = new Date();
    candidate.emailAttempts = (candidate.emailAttempts || 0) + 1; candidate.emailError = undefined;
    if (candidate.status === "invited") candidate.status = "email-sent";
    await candidate.save();
    console.log(`[emailQueue] ✔ LINK sent to ${candidate.email} (${messageId})`);
    return { ok: true, messageId };
  } catch (err) {
    const attempts = (candidate.emailAttempts || 0) + 1;
    candidate.emailAttempts = attempts; candidate.emailError = err.message;
    if (attempts >= MAX_ATTEMPTS) candidate.emailStatus = "failed";
    else { candidate.emailStatus = "scheduled"; candidate.emailScheduledAt = new Date(Date.now() + attempts * attempts * 60000); }
    await candidate.save();
    console.warn(`[emailQueue] ✖ LINK ${candidate.email} attempt ${attempts}/${MAX_ATTEMPTS} → status=${candidate.emailStatus}`);
    logMailError(`LINK ${candidate.email}`, err);
    return { ok: false, error: err.message, email: candidate.email };
  }
}

/* ─────────────────────────────────────────────────────────────────────────────
 * SHORTLIST email track  (shortlistEmail.* fields)
 * ───────────────────────────────────────────────────────────────────────────── */
async function claimNextShortlist() {
  return Candidate.findOneAndUpdate(
    { "shortlistEmail.status": "scheduled", "shortlistEmail.scheduledAt": { $lte: new Date() }, "shortlistEmail.attempts": { $lt: MAX_ATTEMPTS } },
    { $set: { "shortlistEmail.status": "sending" } },
    { new: true, sort: { "shortlistEmail.scheduledAt": 1 } }
  );
}

async function deliverShortlist(candidate) {
  const assessment = await Assessment.findById(candidate.assessmentId).lean();
  if (!assessment) {
    candidate.shortlistEmail.status = "failed"; candidate.shortlistEmail.error = "Assessment not found";
    await candidate.save();
    return { ok: false, error: "Assessment not found", email: candidate.email };
  }
  try {
    const messageId = await sendShortlistEmail(candidate, assessment);
    candidate.shortlistEmail.status = "sent"; candidate.shortlistEmail.sentAt = new Date();
    candidate.shortlistEmail.attempts = (candidate.shortlistEmail.attempts || 0) + 1; candidate.shortlistEmail.error = undefined;
    await candidate.save();
    console.log(`[emailQueue] ✔ SHORTLIST sent to ${candidate.email} (${messageId})`);
    return { ok: true, messageId };
  } catch (err) {
    const attempts = (candidate.shortlistEmail.attempts || 0) + 1;
    candidate.shortlistEmail.attempts = attempts; candidate.shortlistEmail.error = err.message;
    if (attempts >= MAX_ATTEMPTS) candidate.shortlistEmail.status = "failed";
    else { candidate.shortlistEmail.status = "scheduled"; candidate.shortlistEmail.scheduledAt = new Date(Date.now() + attempts * attempts * 60000); }
    await candidate.save();
    console.warn(`[emailQueue] ✖ SHORTLIST ${candidate.email} attempt ${attempts}/${MAX_ATTEMPTS} → status=${candidate.shortlistEmail.status}`);
    logMailError(`SHORTLIST ${candidate.email}`, err);
    return { ok: false, error: err.message, email: candidate.email };
  }
}

/* Recover both tracks from orphaned "sending" (crash mid-send). */
async function recoverStaleSending() {
  const cutoff = new Date(Date.now() - STALE_SENDING_MS);
  const [a, b] = await Promise.all([
    Candidate.updateMany({ emailStatus: "sending", updatedAt: { $lt: cutoff } },
      { $set: { emailStatus: "scheduled", emailScheduledAt: new Date() } }),
    Candidate.updateMany({ "shortlistEmail.status": "sending", updatedAt: { $lt: cutoff } },
      { $set: { "shortlistEmail.status": "scheduled", "shortlistEmail.scheduledAt": new Date() } }),
  ]);
  const n = (a.modifiedCount || 0) + (b.modifiedCount || 0);
  if (n) console.log(`[emailQueue] recovered ${n} stale 'sending' row(s)`);
}

// Generic drain over a claim+deliver pair. Returns { processed, sent, failed, errors }.
async function drainTrack(claim, deliver, limit, label) {
  const result = { processed: 0, sent: 0, failed: 0, errors: [] };
  while (result.processed < limit) {
    const cand = await claim();
    if (!cand) break;
    const r = await deliver(cand);
    result.processed++;
    if (r.ok) result.sent++;
    else { result.failed++; result.errors.push({ track: label, email: r.email, error: r.error }); }
  }
  return result;
}

let running = false;
async function processQueue() {
  if (running) return { skipped: true };
  running = true;
  try {
    if (!emailConfigured()) {
      console.warn(`[emailQueue] tick skipped — emailConfigured()=false. Diag: ${JSON.stringify(emailDiag())}`);
      return { processed: 0, sent: 0, failed: 0, errors: [], notConfigured: true };
    }
    await recoverStaleSending();
    const half = Math.max(1, Math.floor(BATCH_SIZE / 2));
    const sl = await drainTrack(claimNextShortlist, deliverShortlist, half, "shortlist"); // shortlist first (time-sensitive)
    const ln = await drainTrack(claimNextLink, deliverLink, BATCH_SIZE - sl.processed, "link");
    const total = sl.processed + ln.processed;
    if (total) console.log(`[emailQueue] tick done: shortlist ${sl.sent}/${sl.processed}, link ${ln.sent}/${ln.processed}`);
    return { processed: total, sent: sl.sent + ln.sent, failed: sl.failed + ln.failed, errors: [...sl.errors, ...ln.errors] };
  } catch (err) {
    console.error("[emailQueue] tick error:", err.message);
    return { processed: 0, sent: 0, failed: 0, errors: [{ error: err.message }] };
  } finally {
    running = false;
  }
}

// Synchronous send (used by "Send Pending Invites") — returns real counts.
async function flushNow(limit = 200) {
  if (!emailConfigured()) return { processed: 0, sent: 0, failed: 0, errors: [], notConfigured: true, diag: emailDiag() };
  await recoverStaleSending();
  const sl = await drainTrack(claimNextShortlist, deliverShortlist, limit, "shortlist");
  const ln = await drainTrack(claimNextLink, deliverLink, limit, "link");
  return { processed: sl.processed + ln.processed, sent: sl.sent + ln.sent, failed: sl.failed + ln.failed, errors: [...sl.errors, ...ln.errors] };
}

let timer = null;
function startScheduler() {
  if (timer) return;
  console.log(`📧  Email config at boot: emailConfigured()=${emailConfigured()} ${JSON.stringify(emailDiag())}`);
  if (!emailConfigured()) console.warn("⚠️  Email scheduler idle — EMAIL_USER/EMAIL_PASS not set. Emails will queue but not send.");
  timer = setInterval(processQueue, POLL_INTERVAL);
  timer.unref?.();
  console.log(`📧  Email scheduler started (every ${POLL_INTERVAL / 1000}s, batch ${BATCH_SIZE}, max ${MAX_ATTEMPTS} attempts)`);
}

// Fire-and-forget completion emails (best effort) with timestamp tracking.
async function queueThankYou(candidate, assessment) {
  if (!emailConfigured()) return;
  try {
    await sendThankYouEmail(candidate, assessment);
    await Candidate.updateOne({ _id: candidate._id }, { $set: { thankYouEmailSentAt: new Date() } });
    console.log(`[emailQueue] ✔ thank-you sent to ${candidate.email}`);
  } catch (err) { logMailError(`thank-you ${candidate.email}`, err); }
}

async function queueDisqualification(candidate) {
  if (!emailConfigured()) return;
  try {
    await sendDisqualificationEmail(candidate);
    await Candidate.updateOne({ _id: candidate._id }, { $set: { disqualificationEmailSentAt: new Date() } });
    console.log(`[emailQueue] ✔ disqualification email sent to ${candidate.email}`);
  } catch (err) { logMailError(`disqualification ${candidate.email}`, err); }
}

module.exports = { startScheduler, processQueue, flushNow, buildLink, queueThankYou, queueDisqualification, MAX_ATTEMPTS };
