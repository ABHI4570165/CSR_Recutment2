const mongoose = require("mongoose");

/*
 * Round = one dynamically configured stage of a drive.
 *
 * THERE IS NO HARD-CODED ROUND ANYWHERE. The name is typed by the admin, the
 * order comes from `sequence`, and a drive may hold any number of rounds:
 *
 *   Drive A: Aptitude → Technical Round
 *   Drive B: Screening → Technical → Managerial → HR
 *   Drive C: Coding → Technical → GD → HR → Final Interview
 *
 * Progression is pure sequence arithmetic — the "next round" is the round with
 * the next-higher sequence in the SAME drive, resolved by id. No logic reads a
 * round's name or assumes a round count.
 */

const ROUND_TYPES = [
  "TEST",              // uses the existing quiz engine
  "CODING",            // uses the existing quiz engine (typed-answer questions)
  "INTERVIEW",
  "GROUP_DISCUSSION",
  "HR_INTERVIEW",
  "MANUAL_EVALUATION",
  "CUSTOM",
];

// Round types whose result comes from an actual online test paper. Everything
// else is scored by an evaluator through the manual-result endpoint.
const ENGINE_TYPES = ["TEST", "CODING"];

const CUTOFF_METHODS = [
  "NONE",        // no automatic decision — evaluator qualifies manually
  "PERCENTAGE",  // score / totalMarks >= value%
  "MARKS",       // score >= value
  "TOP_N",       // highest `value` scorers qualify
  "MANUAL",      // admin picks the qualified set explicitly
];

const roundSchema = new mongoose.Schema({
  workspaceId: { type: mongoose.Schema.Types.ObjectId, ref: "Workspace", required: true, index: true },
  driveId:     { type: mongoose.Schema.Types.ObjectId, ref: "Drive",     required: true, index: true },

  name:     { type: String, required: true, trim: true },   // admin-typed. NEVER assumed.
  sequence: { type: Number, required: true, min: 1 },       // 1,2,3…N — the ONLY ordering
  roundType:{ type: String, enum: ROUND_TYPES, default: "TEST" },
  status:   { type: String, enum: ["DRAFT", "ACTIVE", "CLOSED"], default: "DRAFT", index: true },
  description: { type: String, trim: true, default: "" },

  // The test this round runs. Points at an Assessment document, so the entire
  // existing quiz engine (paper builder, timer, autosave, scoring, proctoring)
  // works unchanged. Null for non-test rounds (interview, GD, HR…).
  assessmentId: { type: mongoose.Schema.Types.ObjectId, ref: "Assessment", default: null, index: true },

  // Per-round cutoff. NEVER a drive-wide value.
  cutoff: {
    method:    { type: String, enum: CUTOFF_METHODS, default: "NONE" },
    value:     { type: Number, default: null },
    appliedAt: { type: Date },
    appliedBy: { type: String },
  },

  // Gate into this round. The first round of a drive is created with false;
  // every later round defaults to true, so only qualified candidates proceed.
  requiresPreviousQualification: { type: Boolean, default: true },

  // Admin may also hand-assign who is allowed into this round (instruction 16).
  // Enforcement is still server-side: assignment never bypasses qualification.
  assignmentMode: { type: String, enum: ["AUTO_QUALIFIED", "MANUAL_ASSIGN"], default: "AUTO_QUALIFIED" },
}, { timestamps: true });

// One round per position per drive.
roundSchema.index({ driveId: 1, sequence: 1 }, { unique: true });
roundSchema.index({ workspaceId: 1, driveId: 1, sequence: 1 });

roundSchema.statics.ROUND_TYPES    = ROUND_TYPES;
roundSchema.statics.ENGINE_TYPES   = ENGINE_TYPES;
roundSchema.statics.CUTOFF_METHODS = CUTOFF_METHODS;
roundSchema.statics.usesEngine = (t) => ENGINE_TYPES.includes(t);

module.exports = mongoose.model("Round", roundSchema);
