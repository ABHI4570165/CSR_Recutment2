const mongoose = require("mongoose");

/*
 * EmailWorkflow = "for THIS round, when EVENT happens, send TEMPLATE (or don't)".
 *
 * The assignment is deliberately a SEPARATE record from the template. When the
 * trigger lived on the template itself, assigning a template to an event moved
 * it off whatever event it previously served, one template could not be reused
 * for two events without duplicating it, and a template could not exist
 * unassigned while it was being written.
 *
 *   EmailTemplate  = the content (name, subject, HTML)   — reusable
 *   EmailWorkflow  = the wiring   (event → template, on/off) — one per event
 *
 * THREE STATES, and they are not interchangeable:
 *   no row for the event      → not configured → the built-in email is used
 *   row with enabled: false   → deliberately off → NOTHING is sent
 *   row with enabled: true    → that template is sent
 *
 * Collapsing "off" into "not configured" would mail candidates the admin
 * explicitly chose to leave alone, which is why the absence of a row and a row
 * that is switched off mean different things.
 */
const emailWorkflowSchema = new mongoose.Schema({
  workspaceId: { type: mongoose.Schema.Types.ObjectId, ref: "Workspace", default: undefined, index: true },
  roundId:     { type: mongoose.Schema.Types.ObjectId, ref: "Round", required: true, index: true },

  // The system event. Validated against EmailTemplate.TRIGGERS by the controller
  // so both models keep one list.
  trigger: { type: String, required: true, trim: true, uppercase: true },

  // Null is meaningful: the admin opened the event, switched it off, and chose no
  // template. That is still "configured" — it just sends nothing.
  templateId: { type: mongoose.Schema.Types.ObjectId, ref: "EmailTemplate", default: null },

  enabled: { type: Boolean, default: true },
}, { timestamps: true });

// One wiring per event per round.
emailWorkflowSchema.index({ roundId: 1, trigger: 1 }, { unique: true });

module.exports = mongoose.model("EmailWorkflow", emailWorkflowSchema);
