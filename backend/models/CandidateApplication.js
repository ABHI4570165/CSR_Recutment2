const mongoose = require("mongoose");

/*
 * CandidateApplication = ONE student in ONE drive.
 *
 * This is the row the All Candidates page shows. A candidate who takes five
 * rounds still has exactly ONE application — the round results hang off it as
 * separate participation documents:
 *
 *   Application(Rahul / 2026 Campus Drive)
 *     ├── Round 1 Aptitude    → result
 *     ├── Round 2 Technical   → result
 *     └── Round 3 Coding      → not attempted (no document at all)
 *
 * The unique index below makes a duplicate application physically impossible,
 * which is the database-level fix for candidates appearing more than once.
 */

const OVERALL_STATUSES = [
  "REGISTERED",        // application exists, nothing attempted yet
  "IN_PROGRESS",       // moving through the rounds
  "SHORTLISTED",       // qualified a round, waiting for the next
  "REJECTED",          // failed a round's cutoff
  "FINALLY_SELECTED",  // qualified the LAST configured round
];

const applicationSchema = new mongoose.Schema({
  workspaceId: { type: mongoose.Schema.Types.ObjectId, ref: "Workspace", required: true, index: true },
  driveId:     { type: mongoose.Schema.Types.ObjectId, ref: "Drive",     required: true, index: true },
  studentId:   { type: mongoose.Schema.Types.ObjectId, ref: "Student",   required: true, index: true },

  overallStatus: { type: String, enum: OVERALL_STATUSES, default: "REGISTERED", index: true },

  // The round this candidate is currently sitting at / waiting for. Always an
  // id — the UI resolves the display name from the round document.
  currentRoundId: { type: mongoose.Schema.Types.ObjectId, ref: "Round", default: null },

  // Highest round sequence the candidate has QUALIFIED. 0 = none yet.
  highestQualifiedSequence: { type: Number, default: 0 },

  // Per-drive answers to the registration form (the drive may collect fields
  // the student's master record does not carry).
  registrationData: { type: Map, of: mongoose.Schema.Types.Mixed, default: () => ({}) },

  source: { type: String, enum: ["PRE_REGISTERED", "WALK_IN", "MANUAL", "MIGRATED"], default: "MANUAL" },

  // Final selection snapshot (written when the last round is qualified).
  finalSelection: {
    selected:   { type: Boolean, default: false },
    selectedAt: { type: Date },
    selectedBy: { type: String },
    roleOffered:{ type: String, default: "" },
  },

  needsReview:  { type: Boolean, default: false, index: true },
  reviewReason: { type: String, default: "" },
}, { timestamps: true });

// ONE student = ONE application per drive. Different drives are unaffected, so
// the same student may legitimately apply to any number of drives/companies.
applicationSchema.index({ workspaceId: 1, driveId: 1, studentId: 1 }, { unique: true });
applicationSchema.index({ workspaceId: 1, driveId: 1, overallStatus: 1 });
applicationSchema.index({ driveId: 1, "finalSelection.selected": 1 });
applicationSchema.index({ driveId: 1, createdAt: -1 });

applicationSchema.statics.OVERALL_STATUSES = OVERALL_STATUSES;

module.exports = mongoose.model("CandidateApplication", applicationSchema);
