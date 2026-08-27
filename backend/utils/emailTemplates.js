/*
 * Rendering and resolution for round-owned email templates.
 *
 * The send path asks: "does THIS round define an enabled email for THIS event?"
 *   yes → render the admin's HTML with the candidate's values
 *   no  → fall back to the built-in design, so a round nobody has configured
 *         behaves exactly as it always did
 *
 * A template that exists but is DISABLED is not a miss — it means the admin
 * deliberately turned that email off, so nothing is sent and the built-in must
 * NOT step in. That distinction is the whole point of the toggle, and it is why
 * resolve() reports "off" separately from "no template".
 */
const EmailTemplate = require("../models/EmailTemplate");
const EmailWorkflow = require("../models/EmailWorkflow");

// Values a template may reference. Anything not listed renders as an empty
// string rather than leaving a raw {{token}} visible to the candidate.
const PLACEHOLDERS = [
  ["name",       "Candidate's full name"],
  ["email",      "Candidate's email address"],
  ["college",    "Candidate's college"],
  ["link",       "The assessment URL (only meaningful for the link email)"],
  ["driveName",  "Name of the drive"],
  ["roundName",  "Name of this round"],
  ["date",       "Assessment date, e.g. 10 September 2026"],
  ["startTime",  "Portal opening time"],
  ["endTime",    "Portal closing time"],
  ["score",      "Candidate's score, where known"],
  ["brand",      "Your organisation name"],
];

const esc = (s) => String(s ?? "")
  .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
  .replace(/"/g, "&quot;").replace(/'/g, "&#39;");

/*
 * Substitute {{token}} values. Everything is HTML-escaped EXCEPT `link`, which
 * is a URL the admin puts inside href="" — escaping its ampersands there would
 * break query strings. Escaping matters: a candidate named O'Brien or "A & B
 * College" would otherwise corrupt the surrounding markup.
 */
function render(tpl, vars) {
  return String(tpl || "").replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (_m, key) => {
    if (!(key in vars)) return "";
    return key === "link" ? String(vars[key] ?? "") : esc(vars[key]);
  });
}

// Readable plain-text fallback when the admin has not written one.
function htmlToText(html) {
  return String(html || "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|tr|h[1-6]|li)>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/gi, " ").replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<").replace(/&gt;/gi, ">").replace(/&quot;/gi, '"').replace(/&#39;/gi, "'")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/*
 * Look up the template for a round + trigger.
 * Returns { status: "send", template } | { status: "off" } | { status: "none" }
 *   send → use it
 *   off  → the admin turned this email off; send NOTHING
 *   none → the round defines no such email; the caller uses its built-in
 */
async function resolve(roundId, trigger) {
  if (!roundId) return { status: "none" };
  const wf = await EmailWorkflow.findOne({ roundId, trigger }).lean();
  if (!wf) return { status: "none" };              // never configured → built-in
  if (!wf.enabled || !wf.templateId) return { status: "off" };  // switched off → send nothing
  const template = await EmailTemplate.findById(wf.templateId).lean();
  // A template deleted out from under a live assignment must not silently
  // resurrect the built-in email: the admin configured this event on purpose.
  if (!template) {
    console.warn(`[email] ${trigger} on round ${roundId} points at a deleted template — nothing sent`);
    return { status: "off" };
  }
  if (!template.enabled) return { status: "off" };
  return { status: "send", template };
}

// Build the {{...}} values from the records the send path already has.
// Times are stored in UTC. Formatting them without an explicit zone uses the
// SERVER's zone, which is UTC on Render — so a 10:00 am start rendered as
// "4:30 am" and a date stored at 18:30 UTC rendered as the PREVIOUS DAY. The
// built-in emails always pinned this zone; the template renderer did not.
const TZ = process.env.DISPLAY_TIMEZONE || "Asia/Kolkata";

function varsFor({ candidate = {}, assessment = {}, round = {}, link = "", brand = "" } = {}) {
  const fmtDate = (d) => (d ? new Date(d).toLocaleDateString("en-IN", { day: "numeric", month: "long", year: "numeric", timeZone: TZ }) : "");
  const fmtTime = (d) => (d ? new Date(d).toLocaleTimeString("en-IN", { hour: "numeric", minute: "2-digit", hour12: true, timeZone: TZ }) : "");
  return {
    name:      candidate.name || "Candidate",
    email:     candidate.email || "",
    college:   candidate.college || "",
    link:      link || "",
    driveName: assessment.name || "",
    roundName: round.name || "",
    date:      fmtDate(assessment.assessmentDate || assessment.startAt),
    startTime: fmtTime(assessment.startAt),
    endTime:   fmtTime(assessment.endAt || assessment.deadline),
    score:     candidate.score != null ? String(candidate.score) : "",
    brand,
  };
}

// Render a resolved template into the shape sendMail() expects.
function build(template, vars, to) {
  const html = render(template.html, vars);
  return {
    to,
    subject: render(template.subject, vars),
    html,
    text: template.text ? render(template.text, vars) : htmlToText(html),
  };
}

module.exports = { resolve, render, build, varsFor, htmlToText, PLACEHOLDERS, esc };
