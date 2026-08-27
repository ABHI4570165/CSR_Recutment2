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
  if (!EmailTemplate.TRIGGERS.includes(trigger)) return { error: "Choose when this email should be sent." };
  // A link email without {{link}} would reach candidates with no way in — worth
  // refusing outright rather than discovering it after a send.
  if (trigger === "ASSESSMENT_LINK" && !/\{\{\s*link\s*\}\}/.test(html)) {
    return { error: "An assessment-link email must include {{link}} somewhere in the body." };
  }
  return { doc: { name, subject, html, trigger,
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
