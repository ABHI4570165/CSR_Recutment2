const mongoose = require("mongoose");

/*
 * Candidate = one invited person for one Assessment, owning one secure link.
 *
 * Self-contained: it does NOT write into the legacy User / QuizAttempt
 * collections, so existing analytics, cutoff logic and dashboard data stay
 * pristine. Campus-drive reporting is served from this collection alone.
 *
 * Status pipeline:
 *   invited -> email-sent -> started -> in-progress -> completed
 *   (completed candidates can additionally be marked shortlisted / rejected)
 */

const STATUSES = [
  "invited", "email-sent", "started", "in-progress",
  "completed", "shortlisted", "rejected", "disqualified",
];

const EMAIL_STATUSES = ["pending", "scheduled", "sending", "sent", "failed"];

// Separate delivery track for the immediate "shortlist" email (the existing
// emailStatus/* fields are the assessment-LINK track, kept for back-compat).
const shortlistEmailSchema = new mongoose.Schema({
  status:      { type: String, enum: EMAIL_STATUSES, default: "pending" },
  scheduledAt: { type: Date },
  sentAt:      { type: Date },
  attempts:    { type: Number, default: 0 },
  error:       { type: String },
}, { _id: false });

// Progress snapshot — persisted so a refresh / crash / disconnect can resume.
const progressSchema = new mongoose.Schema({
  // Fixed per-candidate question order (so resume restores the SAME paper)
  questionOrder:   { type: [String], default: undefined },          // question _id strings, shuffled
  // questionId -> array of original option indexes in shuffled display order
  optionOrder:     { type: Map, of: [Number], default: undefined },
  // questionId -> selected DISPLAY option index (mapped to original at scoring time)
  answers:         { type: Map, of: Number, default: undefined },
  review:          { type: [String], default: undefined },  // qids marked for review
  visited:         { type: [String], default: undefined },  // qids the candidate has opened
  remainingSeconds:{ type: Number },
  currentQuestion: { type: Number, default: 0 },
  lastSavedAt:     { type: Date },
}, { _id: false });

const violationsSchema = new mongoose.Schema({
  fullscreenExits: { type: Number, default: 0 },
  tabSwitches:     { type: Number, default: 0 },
  focusLoss:       { type: Number, default: 0 },
  multipleFaces:   { type: Number, default: 0 },  // extra person(s) detected in camera
  total:           { type: Number, default: 0 },
}, { _id: false });

const candidateSchema = new mongoose.Schema({
  assessmentId: { type: mongoose.Schema.Types.ObjectId, ref: "Assessment", required: true, index: true },

  // Identity (from CSV / Excel / manual entry, or walk-in registration form)
  name:    { type: String, required: true, trim: true },
  email:   { type: String, required: true, lowercase: true, trim: true, index: true },
  college: { type: String, required: true, trim: true, index: true },

  // Where this candidate came from (Phase 12)
  candidateSource: { type: String, enum: ["PRE_REGISTERED", "WALK_IN"], default: "PRE_REGISTERED", index: true },

  // Walk-in demographics (optional — only collected at the /test portal)
  usn:      { type: String, trim: true },
  phone:    { type: String, trim: true },
  gender:   { type: String, trim: true },
  dob:      { type: String, trim: true },
  aadhaar:  { type: String, trim: true },
  location: { type: String, trim: true },

  // Secure access
  token:          { type: String, required: true, unique: true, index: true }, // non-guessable URL token
  tokenExpiresAt: { type: Date },                                              // per-candidate expiry

  status: { type: String, enum: STATUSES, default: "invited", index: true },

  // Assessment-LINK email scheduling / delivery tracking (the existing track)
  emailStatus:    { type: String, enum: EMAIL_STATUSES, default: "pending", index: true },
  emailScheduledAt: { type: Date },
  emailSentAt:      { type: Date },
  emailAttempts:    { type: Number, default: 0 },
  emailError:       { type: String },

  // Shortlist email (sent immediately on upload) — separate track
  shortlistEmail: { type: shortlistEmailSchema, default: () => ({}) },

  // One-off email timestamps for tracking
  thankYouEmailSentAt:        { type: Date },
  disqualificationEmailSentAt:{ type: Date },

  // In-flight progress (for accidental-exit recovery / resume)
  progress: { type: progressSchema, default: undefined },

  startedAt:   { type: Date },
  completedAt: { type: Date },

  // Results (computed on submit)
  score:            { type: Number, default: null },
  totalMarks:       { type: Number, default: null },
  passed:           { type: Boolean, default: null },
  sectionScores:    { type: Map, of: Number, default: {} },
  timeTakenSeconds: { type: Number, default: null },
  submissionReason: { type: String, enum: ["manual", "timed-out", "auto-malpractice", "disqualified"], default: undefined },

  // Anti-malpractice
  violations: { type: violationsSchema, default: () => ({}) },
}, { timestamps: true });

// Compound indexes for the admin drive dashboard (college + assessment + status filters)
candidateSchema.index({ assessmentId: 1, college: 1, status: 1 });
candidateSchema.index({ assessmentId: 1, status: 1 });
candidateSchema.index({ assessmentId: 1, score: -1 });
candidateSchema.index({ emailStatus: 1, emailScheduledAt: 1 }); // link-email scheduler poll
candidateSchema.index({ "shortlistEmail.status": 1, "shortlistEmail.scheduledAt": 1 }); // shortlist poll
candidateSchema.index({ assessmentId: 1, email: 1 }, { unique: true }); // one invite per email per drive

candidateSchema.statics.STATUSES = STATUSES;
candidateSchema.statics.EMAIL_STATUSES = EMAIL_STATUSES;

module.exports = mongoose.model("Candidate", candidateSchema);
