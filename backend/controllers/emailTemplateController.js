const mongoose = require("mongoose");
const EmailTemplate = require("../models/EmailTemplate");
const Round = require("../models/Round");
const Assessment = require("../models/Assessment");
const { legacyScope } = require("../utils/legacyScope");
const { render, build, varsFor, PLACEHOLDERS } = require("../utils/emailTemplates");
const { sendMail } = require("../utils/email");

const BRAND = process.env.BRAND_NAME || "M H Foundation";

// Triggers offered to the admin, with what actually fires each one. The list is
// served rather than hard-coded in the UI so a new trigger needs no frontend change.
const TRIGGER_INFO = [
  { value: "SHORTLIST",       label: "Shortlisted",        fires: "When you upload candidates into this round." },
  { value: "ASSESSMENT_LINK", label: "Assessment link",    fires: "At the drive's scheduled link-send time. Must contain {{link}}." },
  { value: "SUBMITTED",       label: "Test submitted",     fires: "When a candidate finishes the test." },
  { value: "TERMINATED",      label: "Session terminated", fires: "When a session is auto-terminated for violations." },
  { value: "QUALIFIED",       label: "Cleared the round",  fires: "When the round's cutoff is applied and the candidate passes." },
  { value: "REJECTED",        label: "Did not clear",      fires: "When the round's cutoff is applied and the candidate does not pass." },
  { value: "MANUAL",          label: "Manual send only",   fires: "Never fires on its own — you send it on demand." },
];

// Every template query is scoped to the round AND the workspace, so one
// workspace can never read or edit another's mail.
const scopeFor = (req, roundId) => ({ ...legacyScope(req), roundId });

exports.listTriggers = (_req, res) =>
  res.json({ success: true, data: { triggers: TRIGGER_INFO, placeholders: PLACEHOLDERS } });

exports.listTemplates = async (req, res) => {
  try {
    const { roundId } = req.query;
    if (!mongoose.isValidObjectId(roundId)) {
      return res.status(400).json({ success: false, message: "A valid roundId is required." });
    }
    const data = await EmailTemplate.find(scopeFor(req, roundId)).sort({ order: 1, createdAt: 1 }).lean();
    res.json({ success: true, data });
  } catch (err) {
    console.error("listTemplates error:", err);
    res.status(500).json({ success: false, message: "Failed to load the email templates." });
  }
};

function readBody(b) {
  const name    = String(b.name || "").trim();
  const subject = String(b.subject || "").trim();
  const html    = String(b.html || "").trim();
  const trigger = String(b.trigger || "").trim().toUpperCase();
  if (!name)    return { error: "Give this email a name." };
  if (!subject) return { error: "Give this email a subject line." };
  if (!html)    return { error: "The email body cannot be empty." };
  // Trigger is OPTIONAL now — a template can be written before it is wired to any
  // event, and the wiring lives in EmailWorkflow. If one is given it must be real.
  if (trigger && !EmailTemplate.TRIGGERS.includes(trigger)) {
    return { error: "That is not a valid event for this email." };
  }
  // A link email without {{link}} would reach candidates with no way in — worth
  // refusing outright rather than discovering it after a send. Checked again when
  // the template is ASSIGNED to ASSESSMENT_LINK, since it may be edited later.
  if (trigger === "ASSESSMENT_LINK" && !/\{\{\s*link\s*\}\}/.test(html)) {
    return { error: "This email is used for sending the assessment link. It must contain {{link}}." };
  }
  return { doc: { name, subject, html, trigger: trigger || null,
    text: String(b.text || "").trim(),
    enabled: b.enabled !== false } };
}

exports.createTemplate = async (req, res) => {
  try {
    const b = req.body || {};
    if (!mongoose.isValidObjectId(b.roundId)) {
      return res.status(400).json({ success: false, message: "A valid roundId is required." });
    }
    const round = await Round.findOne({ _id: b.roundId, ...legacyScope(req) }).lean();
    if (!round) return res.status(404).json({ success: false, message: "Round not found in this workspace." });

    const { error, doc } = readBody(b);
    if (error) return res.status(400).json({ success: false, message: error });

    const count = await EmailTemplate.countDocuments({ roundId: b.roundId });
    const created = await EmailTemplate.create({
      ...(round.workspaceId ? { workspaceId: round.workspaceId } : {}),
      roundId: round._id, ...doc, order: count,
    });
    res.status(201).json({ success: true, data: created });
  } catch (err) {
    console.error("createTemplate error:", err);
    res.status(500).json({ success: false, message: "Failed to create the email template." });
  }
};

exports.updateTemplate = async (req, res) => {
  try {
    const b = req.body || {};
    // A toggle-only request must not have to resend the whole body.
    const onlyToggle = Object.keys(b).length === 1 && typeof b.enabled === "boolean";
    let update;
    if (onlyToggle) {
      update = { enabled: b.enabled };
    } else {
      const { error, doc } = readBody(b);
      if (error) return res.status(400).json({ success: false, message: error });
      update = doc;
      if (b.order != null) update.order = Number(b.order) || 0;
    }
    const doc = await EmailTemplate.findOneAndUpdate(
      { _id: req.params.id, ...legacyScope(req) }, { $set: update }, { new: true, runValidators: true });
    if (!doc) return res.status(404).json({ success: false, message: "Email template not found." });
    res.json({ success: true, data: doc });
  } catch (err) {
    console.error("updateTemplate error:", err);
    res.status(500).json({ success: false, message: "Failed to update the email template." });
  }
};

exports.deleteTemplate = async (req, res) => {
  try {
    const doc = await EmailTemplate.findOneAndDelete({ _id: req.params.id, ...legacyScope(req) });
    if (!doc) return res.status(404).json({ success: false, message: "Email template not found." });
    res.json({ success: true, data: { deleted: doc.name } });
  } catch (err) {
    console.error("deleteTemplate error:", err);
    res.status(500).json({ success: false, message: "Failed to delete the email template." });
  }
};

// Sample values so a preview shows a realistic email rather than empty gaps.
async function previewVars(req, roundId) {
  const round = roundId ? await Round.findOne({ _id: roundId, ...legacyScope(req) }).lean() : null;
  const assessment = round?.assessmentId ? await Assessment.findById(round.assessmentId).lean() : null;
  return varsFor({
    candidate: { name: "Priya Sharma", email: "priya.sharma@example.com", college: "RV College of Engineering", score: 42 },
    assessment: assessment || { name: "Sample Drive", startAt: new Date(), endAt: new Date(Date.now() + 3 * 3600e3), assessmentDate: new Date() },
    round: round || { name: "Sample Round" },
    link: `${process.env.PUBLIC_APP_URL || "https://example.com"}/assessment/SAMPLE-TOKEN`,
    brand: BRAND,
  });
}

// Render with sample values — what the candidate would actually receive.
exports.previewTemplate = async (req, res) => {
  try {
    const b = req.body || {};
    const vars = await previewVars(req, b.roundId);
    res.json({ success: true, data: {
      subject: render(b.subject || "", vars),
      html:    render(b.html || "", vars),
    } });
  } catch (err) {
    console.error("previewTemplate error:", err);
    res.status(500).json({ success: false, message: "Failed to render the preview." });
  }
};

// Send the rendered sample to one address, so the admin sees it in a real inbox
// before any candidate does.
exports.testSendTemplate = async (req, res) => {
  try {
    const b = req.body || {};
    const to = String(b.to || "").trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to)) {
      return res.status(400).json({ success: false, message: "Enter a valid address to send the test to." });
    }
    const { error, doc } = readBody(b);
    if (error) return res.status(400).json({ success: false, message: error });
    const vars = await previewVars(req, b.roundId);
    await sendMail(build(doc, vars, to));
    res.json({ success: true, data: { sentTo: to } });
  } catch (err) {
    console.error("testSendTemplate error:", err);
    res.status(500).json({ success: false, message: err.message || "Failed to send the test email." });
  }
};

/* ── Email workflow: which template fires on which event ──────────────────────
 * The assignment is separate from the template, so one template can serve
 * several events and assigning never moves or duplicates anything.
 *
 * Three states are returned for every event, and they are NOT interchangeable:
 *   configured:false            → nothing wired; the built-in email is used
 *   configured:true, enabled:false → deliberately off; NOTHING is sent
 *   configured:true, enabled:true  → that template is sent
 */
const EmailWorkflow = require("../models/EmailWorkflow");

exports.getWorkflow = async (req, res) => {
  try {
    const { roundId } = req.query;
    if (!mongoose.isValidObjectId(roundId)) {
      return res.status(400).json({ success: false, message: "A valid roundId is required." });
    }
    const round = await Round.findOne({ _id: roundId, ...legacyScope(req) }).lean();
    if (!round) return res.status(404).json({ success: false, message: "Round not found in this workspace." });

    const rows = await EmailWorkflow.find({ roundId }).lean();
    const byTrigger = {};
    rows.forEach((r) => { byTrigger[r.trigger] = r; });

    // MANUAL is not part of the automatic workflow — it has no event to fire on.
    const data = TRIGGER_INFO.filter((t) => t.value !== "MANUAL").map((t) => {
      const wf = byTrigger[t.value];
      return {
        ...t,
        configured: !!wf,
        enabled:    wf ? wf.enabled : false,
        templateId: wf?.templateId ? String(wf.templateId) : null,
        state: !wf ? "not_configured" : (wf.enabled && wf.templateId ? "on" : "off"),
      };
    });
    res.json({ success: true, data });
  } catch (err) {
    console.error("getWorkflow error:", err);
    res.status(500).json({ success: false, message: "Failed to load the email workflow." });
  }
};

exports.setWorkflow = async (req, res) => {
  try {
    const b = req.body || {};
    const trigger = String(b.trigger || "").trim().toUpperCase();
    if (!mongoose.isValidObjectId(b.roundId)) {
      return res.status(400).json({ success: false, message: "A valid roundId is required." });
    }
    if (!EmailTemplate.TRIGGERS.includes(trigger) || trigger === "MANUAL") {
      return res.status(400).json({ success: false, message: "Choose a valid automatic event." });
    }
    const round = await Round.findOne({ _id: b.roundId, ...legacyScope(req) }).lean();
    if (!round) return res.status(404).json({ success: false, message: "Round not found in this workspace." });

    let templateId = null;
    if (b.templateId) {
      if (!mongoose.isValidObjectId(b.templateId)) {
        return res.status(400).json({ success: false, message: "That email template is not valid." });
      }
      // Templates belong to a round; assigning another round's template would
      // leak content across rounds and is refused outright.
      const t = await EmailTemplate.findOne({ _id: b.templateId, roundId: round._id }).lean();
      if (!t) return res.status(404).json({ success: false, message: "That template does not belong to this round." });
      // The link email is the candidate's only way in — enforced here too, not
      // just at template save, because the template may have been edited since.
      if (trigger === "ASSESSMENT_LINK" && !/\{\{\s*link\s*\}\}/.test(t.html || "")) {
        return res.status(400).json({ success: false,
          message: "This email is used for sending the assessment link. It must contain {{link}}." });
      }
      templateId = t._id;
    }

    const wf = await EmailWorkflow.findOneAndUpdate(
      { roundId: round._id, trigger },
      { $set: {
          ...(round.workspaceId ? { workspaceId: round.workspaceId } : {}),
          templateId,
          enabled: b.enabled !== false,
        } },
      { new: true, upsert: true, setDefaultsOnInsert: true });
    res.json({ success: true, data: wf });
  } catch (err) {
    console.error("setWorkflow error:", err);
    res.status(500).json({ success: false, message: "Failed to save the email configuration." });
  }
};

// Clearing an event returns it to "not configured" — the built-in email resumes.
// This is deliberately distinct from switching it off, which sends nothing.
exports.clearWorkflow = async (req, res) => {
  try {
    const wf = await EmailWorkflow.findOneAndDelete({ _id: req.params.id, ...legacyScope(req) });
    if (!wf) return res.status(404).json({ success: false, message: "Configuration not found." });
    res.json({ success: true, data: { cleared: wf.trigger } });
  } catch (err) {
    console.error("clearWorkflow error:", err);
    res.status(500).json({ success: false, message: "Failed to clear the configuration." });
  }
};

/* ── Manual send ──────────────────────────────────────────────────────────────
 * Sends a template to real candidates on demand. Queued through the existing
 * email path so the transport, retries and logging are the ones already in use.
 */
exports.sendManual = async (req, res) => {
  try {
    const b = req.body || {};
    if (!mongoose.isValidObjectId(b.templateId)) {
      return res.status(400).json({ success: false, message: "Choose an email template to send." });
    }
    if (!mongoose.isValidObjectId(b.roundId)) {
      return res.status(400).json({ success: false, message: "A valid roundId is required." });
    }
    const round = await Round.findOne({ _id: b.roundId, ...legacyScope(req) }).lean();
    if (!round) return res.status(404).json({ success: false, message: "Round not found in this workspace." });

    const template = await EmailTemplate.findOne({ _id: b.templateId, roundId: round._id }).lean();
    if (!template) return res.status(404).json({ success: false, message: "That template does not belong to this round." });

    const ids = Array.isArray(b.candidateIds) ? b.candidateIds.filter((x) => mongoose.isValidObjectId(x)) : [];
    if (!ids.length) return res.status(400).json({ success: false, message: "Select at least one candidate." });

    const Candidate = require("../models/Candidate");
    // Scoped so a candidate from another workspace can never be mailed from here.
    const candidates = await Candidate.find({ _id: { $in: ids }, ...legacyScope(req) })
      .select("name email college score assessmentId").lean();
    if (!candidates.length) return res.status(404).json({ success: false, message: "No matching candidates found." });

    const assessment = round.assessmentId ? await Assessment.findById(round.assessmentId).lean() : null;
    const sent = [];
    const failed = [];
    for (const c of candidates) {
      if (!c.email) { failed.push({ email: "(none)", reason: "no email address" }); continue; }
      try {
        const vars = varsFor({ candidate: c, assessment: assessment || {}, round, link: "", brand: BRAND });
        await sendMail(build(template, vars, c.email));
        sent.push(c.email);
      } catch (e) {
        failed.push({ email: c.email, reason: e.message });
      }
    }
    res.json({ success: true, data: { sentCount: sent.length, failedCount: failed.length, sent, failed } });
  } catch (err) {
    console.error("sendManual error:", err);
    res.status(500).json({ success: false, message: err.message || "Failed to send the emails." });
  }
};
