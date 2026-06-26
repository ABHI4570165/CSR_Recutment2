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

  // ── V3: drive type, lifecycle status, walk-in capacity (all additive) ───────
  driveType: { type: String, enum: ["PRE_REGISTERED", "WALK_IN"], default: "PRE_REGISTERED", index: true },
  status:    { type: String, enum: ["DRAFT", "ACTIVE", "COMPLETED", "ARCHIVED"], default: "ACTIVE", index: true },
  college:   { type: String, trim: true, default: "" },          // optional drive-level college label
  cutoff:    { type: Number, default: null },                    // selection cutoff (derived "selected" = score >= cutoff)

  // Walk-in only
  testCode:      { type: String, unique: true, sparse: true, index: true }, // e.g. "MH001" (global, never reused)
  maxCandidates: { type: Number, default: null },               // capacity; null = unlimited
  walkInCount:   { type: Number, default: 0 },                   // atomic registration counter (capacity guard)

  // Capacity planning hint (Phase 20)
  expectedCandidates: { type: Number, default: null },

  // Per-drive security toggles (Phase 8 + V3.1) — all on by default.
  security: {
    // ── Original 7 ──
    desktopOnly:           { type: Boolean, default: true },
    fullscreenEnforcement: { type: Boolean, default: true },
    cameraMonitoring:      { type: Boolean, default: true },
    faceVerification:      { type: Boolean, default: true },
    multipleFaceDetection: { type: Boolean, default: true },
    tabSwitchDetection:    { type: Boolean, default: true },
    violationTracking:     { type: Boolean, default: true },
    // ── Batch A: client-side enforcement (V3.1) ──
    refreshProtection:        { type: Boolean, default: true },
    rightClickProtection:     { type: Boolean, default: true },
    keyboardBlocking:         { type: Boolean, default: true },
    devToolsDetection:        { type: Boolean, default: true },
    clipboardMonitoring:      { type: Boolean, default: true },
    idleDetection:            { type: Boolean, default: true },
    windowResizeDetection:    { type: Boolean, default: true },
    screenResolutionCheck:    { type: Boolean, default: true },
    browserCompatibility:     { type: Boolean, default: true },
    incognitoDetection:       { type: Boolean, default: true },
    cameraDisconnectDetection:{ type: Boolean, default: true },
    faceVisibilityDetection:  { type: Boolean, default: true },
    // ── Batch B: geolocation ──
    locationRestriction:      { type: Boolean, default: false }, // off unless admin sets a location
  },

  // Numeric / structured security configuration (not toggles).
  securityConfig: {
    maxViolations:   { type: Number, default: 3 },   // warnings before auto-terminate
    idleSeconds:     { type: Number, default: 120 },  // inactivity before idle termination
    clipboardLimit:  { type: Number, default: 3 },    // copy/paste attempts before terminate
    minScreenWidth:  { type: Number, default: 1024 },
    minScreenHeight: { type: Number, default: 600 },
    cameraGraceSeconds: { type: Number, default: 10 },// camera disconnect / face-not-visible grace
    // Geolocation center + allowed radius (Batch B). Admin sets this on the drive.
    location: {
      lat:          { type: Number, default: null },
      lng:          { type: Number, default: null },
      radiusMeters: { type: Number, default: 200 },
      label:        { type: String, default: "" },
    },
  },
}, { timestamps: true });

assessmentSchema.index({ isActive: 1, createdAt: -1 });
assessmentSchema.index({ status: 1, driveType: 1, createdAt: -1 });

module.exports = mongoose.model("Assessment", assessmentSchema);
