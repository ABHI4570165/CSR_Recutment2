const mongoose = require("mongoose");

/*
 * Assessment = a campus recruitment "drive" / test definition.
 *
 * It is ADDITIVE — it does NOT replace QuizConfig (the legacy singleton used by
 * the public-registration quiz). Questions are still drawn from the shared global
 * Question pool, filtered by the section keys listed here, so existing question
 * management keeps working unchanged.
 */

const sectionSchema = new mongoose.Schema({
  name:          { type: String, required: true, trim: true }, // internal key, must match Question.section
  displayName:   { type: String, required: true, trim: true },
  questionCount: { type: Number, default: 20, min: 1 },
  color:         { type: String, default: "#4F46E5" },
}, { _id: false });

const assessmentSchema = new mongoose.Schema({
  name:             { type: String, required: true, trim: true },          // e.g. "Inference Labs Campus Drive 2026"
  description:      { type: String, trim: true, default: "" },
  durationMinutes:  { type: Number, default: 40, min: 1, max: 600 },
  passingScore:     { type: Number, default: 30 },                         // internal only — never shown to candidates
  sections: {
    type: [sectionSchema],
    default: [
      { name: "aptitude", displayName: "Aptitude",          questionCount: 20, color: "#4F46E5" },
      { name: "logical",  displayName: "Logical Reasoning", questionCount: 20, color: "#7C3AED" },
      { name: "english",  displayName: "English",           questionCount: 20, color: "#0891B2" },
    ],
  },
  randomizeQuestions: { type: Boolean, default: true },
  randomizeOptions:   { type: Boolean, default: true },
  deadline:           { type: Date },                  // legacy link expiry (kept for back-compat)
  isActive:           { type: Boolean, default: true },

  // ── Scheduling window (additive — old drives simply leave these unset) ──────
  assessmentDate: { type: Date },   // calendar date of the drive
  startAt:        { type: Date },   // assessment opens (candidates cannot start before)
  endAt:          { type: Date },   // assessment closes (candidates cannot start after)

  // When the assessment-link email goes out, relative to startAt.
  linkSendOption: {
    type: String,
    enum: ["immediately", "15min", "30min", "1hour", "2hours", "custom"],
    default: "immediately",
  },
  linkSendAt: { type: Date },       // resolved send time (computed from option, or custom value)
}, { timestamps: true });

assessmentSchema.index({ isActive: 1, createdAt: -1 });

module.exports = mongoose.model("Assessment", assessmentSchema);
