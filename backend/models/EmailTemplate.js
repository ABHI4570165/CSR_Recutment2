const mongoose = require("mongoose");

/*
 * EmailTemplate = one email THIS ROUND sends, written by the admin.
 *
 * Every email used to be a hard-coded function in utils/email.js, so the wording
 * was identical for every workspace and every round, and the only way to stop one
 * going out was to change code. A round now owns its own list: the admin decides
 * how many emails exist, what each is called, when it fires, and what it says.
 *
 * A round with no templates keeps using the built-in designs, so existing drives
 * are untouched until someone deliberately overrides them.
 *
 * `trigger` is the system event that fires the mail — it cannot be free text,
 * because something in the code has to actually send it. MANUAL is the escape
 * hatch: an email that fires on nothing and is sent on demand to a selection of
 * candidates, which is what makes the list genuinely open-ended.
 */

const TRIGGERS = [
  "SHORTLIST",       // candidate uploaded / shortlisted for this round
  "ASSESSMENT_LINK", // the scheduled link email carrying the assessment URL
  "SUBMITTED",       // candidate finished the test
  "TERMINATED",      // session auto-terminated for violations
  "QUALIFIED",       // candidate cleared this round's cutoff
  "REJECTED",        // candidate did not clear this round's cutoff
  "MANUAL",          // no automatic trigger — sent on demand
];

const emailTemplateSchema = new mongoose.Schema({
  // Scoped like every other record. roundId is what makes it round-wise.
  workspaceId: { type: mongoose.Schema.Types.ObjectId, ref: "Workspace", default: undefined, index: true },
  roundId:     { type: mongoose.Schema.Types.ObjectId, ref: "Round",     required: true, index: true },

  name:    { type: String, required: true, trim: true },   // the admin's label for this email
  // What this email is FOR. A hint only — the actual wiring lives in
  // EmailWorkflow, so one template can serve several events and a template can
  // exist unassigned while it is being written. Kept for display and for the
  // {{link}} validation, which must know whether this is a link email.
  trigger: { type: String, enum: [...TRIGGERS, null], default: null, index: true },

  // Off means this email simply does not go out — which is how "only one email
  // should be sent" is expressed: enable the one, disable the rest.
  enabled: { type: Boolean, default: true },

  subject: { type: String, required: true, trim: true },
  html:    { type: String, required: true },               // full HTML body, placeholders allowed

  // Plain-text alternative. Generated from the HTML when left empty.
  text:    { type: String, default: "" },

  order:   { type: Number, default: 0 },
}, { timestamps: true });

// Ordering within a round, and the lookup the send path performs.
emailTemplateSchema.index({ roundId: 1, order: 1 });
emailTemplateSchema.index({ roundId: 1, trigger: 1, enabled: 1 });

emailTemplateSchema.statics.TRIGGERS = TRIGGERS;

module.exports = mongoose.model("EmailTemplate", emailTemplateSchema);
