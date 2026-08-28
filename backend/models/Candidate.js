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
  // questionId -> answer. MCQ: selected DISPLAY option index (Number). Text: typed string.
  answers:         { type: Map, of: mongoose.Schema.Types.Mixed, default: undefined },
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
  // ── V3.1 forensic counters (all default 0; only incremented when the toggle is on) ──
  refresh:         { type: Number, default: 0 },
  devtools:        { type: Number, default: 0 },
  clipboard:       { type: Number, default: 0 },
  idle:            { type: Number, default: 0 },
  windowResize:    { type: Number, default: 0 },
  location:        { type: Number, default: 0 },
  cameraDisconnect:{ type: Number, default: 0 },
  faceHidden:      { type: Number, default: 0 },
  total:           { type: Number, default: 0 },
}, { _id: false });

// ── ROUND-STATUS / QUALIFICATION vocabulary (new architecture) ────────────────
// Round-level status is SEPARATE from the legacy `status` pipeline below, which
// the live quiz engine still owns. Nothing here replaces or rewrites it.
const ROUND_STATUSES = ["NOT_STARTED", "IN_PROGRESS", "COMPLETED", "QUALIFIED", "REJECTED", "NOT_ATTEMPTED"];
const QUALIFICATIONS = ["PENDING", "QUALIFIED", "REJECTED", "HISTORICAL_NOT_DETERMINED"];

const candidateSchema = new mongoose.Schema({
  // The test this record belongs to.
  //
  // NOTE ON `required`: relaxed from required:true so that a NON-TEST round
  // (interview / GD / HR) can hold a result without a question paper. Meaning is
  // unchanged, every one of the existing records still carries it, and every
  // existing writer still sets it — engine-backed rounds validate it in the
  // controller. This is the ONLY constraint touched by the new architecture.
  assessmentId: { type: mongoose.Schema.Types.ObjectId, ref: "Assessment", required: false, index: true },

  /* ── NEW ARCHITECTURE LINKS (all optional) ────────────────────────────────
   * A record written by the NEW multi-workspace flow is a ROUND PARTICIPATION:
   *   Workspace → Drive → Round → (this document) → Attempt/Result
   * Legacy records simply do not carry these fields and keep working exactly as
   * they always have. No migration is required for them to remain valid.
   */
  workspaceId:   { type: mongoose.Schema.Types.ObjectId, ref: "Workspace", default: undefined, index: true },
  driveId:       { type: mongoose.Schema.Types.ObjectId, ref: "Drive",     default: undefined, index: true },
  roundId:       { type: mongoose.Schema.Types.ObjectId, ref: "Round",     default: undefined, index: true },
  applicationId: { type: mongoose.Schema.Types.ObjectId, ref: "CandidateApplication", default: undefined, index: true },
  studentId:     { type: mongoose.Schema.Types.ObjectId, ref: "Student",   default: undefined, index: true },

  // The candidate's result FOR THIS ROUND. `isPrimary` marks the counted
  // attempt; a re-sit is stored alongside with isPrimary:false and never lost.
  isPrimary:  { type: Boolean, default: undefined },
  repeatOf:   { type: mongoose.Schema.Types.ObjectId, default: null },
  roundStatus:{ type: String, enum: ROUND_STATUSES, default: undefined },

  // Qualification decision — written by the round cutoff, never derived on read.
  qualification:       { type: String, enum: QUALIFICATIONS, default: undefined },
  qualificationSource: { type: String, enum: ["CUTOFF", "MANUAL_OVERRIDE", "NOT_STORED_IN_LEGACY_SYSTEM"], default: undefined },
  cutoffAtDecision:    { type: Number, default: null },
  decidedAt:           { type: Date },

  // Manual override — the automatic decision is preserved in `from`.
  override: {
    from:   { type: String },
    to:     { type: String },
    by:     { type: String },
    at:     { type: Date },
    reason: { type: String },
  },

  // Who let this candidate into the round, and how.
  assignedAt: { type: Date },
  assignedBy: { type: String },

  needsReview:  { type: Boolean, default: undefined },
  reviewReason: { type: String },

  // ── Recruitment round segregation (additive; Round 1 = Aptitude, 2 = Technical) ──
  // `round` is denormalised from the parent Assessment.round so we can filter/aggregate
  // candidates by round across ALL drives without a join. Backfilled by migration.
  round:        { type: Number, default: undefined, index: true },
  // Links the SAME person's separate per-round records into one recruitment journey
  // (Round-1 and Round-2 are separate candidate docs). Set at move-to-technical time
  // and backfilled by a reviewed identity match. Null = not yet linked.
  masterId:     { type: mongoose.Schema.Types.ObjectId, default: null, index: true },
  // True once an Aptitude-SELECTED candidate has been advanced to the Technical round.
  techEligible: { type: Boolean, default: false, index: true },

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
  course:   { type: String, trim: true },
  branch:   { type: String, trim: true },
  // Uploaded resume. Preferred: Cloudinary (url + publicId). Fallback: base64 `data`.
  resume: {
    filename:   { type: String },
    ext:        { type: String },   // file extension (pdf/doc/docx) for correct naming + preview
    mime:       { type: String },
    url:        { type: String },   // Cloudinary secure URL (preferred)
    publicId:   { type: String },   // Cloudinary public_id (for deletion)
    data:       { type: String },   // base64 fallback (only if Cloudinary not configured)
    size:       { type: Number },
    uploadedAt: { type: Date },
  },

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

  // Completion email (thank-you OR disqualification) — queued + retried like the
  // other tracks so transient failures don't lose it. Kind is derived from status.
  completionEmail: {
    status:      { type: String, enum: ["none", "pending", "sending", "sent", "failed"], default: "none" },
    scheduledAt: { type: Date },
    sentAt:      { type: Date },
    attempts:    { type: Number, default: 0 },
    error:       { type: String },
  },

  // One-off email timestamps for tracking
  thankYouEmailSentAt:        { type: Date },
  disqualificationEmailSentAt:{ type: Date },

  // Round-2 set assignment (A/B) — fixed once per candidate so resume shows the same
  // paper and each student gets exactly ONE set (alternating distribution).
  assignedSet: { type: String, default: null },

  // In-flight progress (for accidental-exit recovery / resume)
  progress: { type: progressSchema, default: undefined },

  // Per-question record saved at submission so admins can review every answer.
  // Light on purpose: question text is joined from Question at read time.
  answerSheet: {
    type: [new mongoose.Schema({
      qid:       { type: String },
      section:   { type: String },
      given:     { type: String, default: null },  // student's answer (option text / typed output)
      correct:   { type: String, default: null },  // correct answer at submission time
      isCorrect: { type: Boolean, default: false },
      marks:     { type: Number, default: 0 },     // marks earned on this question
      maxMarks:  { type: Number, default: 1 },     // marks this question was worth

      /* ── AI evaluation (open-ended answers only) ────────────────────────────
       * MCQs and exact-output answers are graded at submit and are COMPLETED
       * immediately. Everything an evaluator has to read is PENDING until the
       * local worker scores it.
       *
       * PENDING IS NOT ZERO. `marks` stays 0 while pending, so the totals must
       * never present a pending paper as a finished score — a cutoff applied to
       * one would reject a candidate on a partial mark.
       */
      evalStatus:   { type: String, enum: ["COMPLETED", "PENDING", "PROCESSING", "FAILED"], default: "COMPLETED", index: true },
      evalReason:   { type: String, default: null },   // why the evaluator awarded this
      matched:      { type: [String], default: undefined },
      missing:      { type: [String], default: undefined },
      confidence:   { type: Number, default: null },
      evaluatedAt:  { type: Date },
      evalAttempts: { type: Number, default: 0 },
      evalError:    { type: String, default: null },
      // Set when a row is leased by a worker; a lease older than the timeout is
      // reclaimed, so a worker that dies mid-question does not strand it.
      leasedAt:     { type: Date },
    }, { _id: false })],
    default: undefined,
  },

  /* ── Paper-level evaluation state ─────────────────────────────────────────
   * `score` counts ONLY what has actually been graded. `pendingMarks` is what
   * is still unmarked, so "18/100 with 80 pending" can never be mistaken for
   * "18/100 final". evaluationStatus is derived from the rows, never set by a
   * client.
   */
  evaluationStatus: { type: String, enum: ["COMPLETED", "PENDING", "PROCESSING", "FAILED"], default: "COMPLETED", index: true },
  pendingMarks:     { type: Number, default: 0 },   // marks still awaiting evaluation
  evaluatedAt:      { type: Date },

  startedAt:   { type: Date },
  completedAt: { type: Date },

  // Results (computed on submit)
  score:            { type: Number, default: null },
  totalMarks:       { type: Number, default: null },
  passed:           { type: Boolean, default: null },
  sectionScores:    { type: Map, of: Number, default: {} },
  timeTakenSeconds: { type: Number, default: null },
  submissionReason: { type: String, enum: ["manual", "timed-out", "auto-malpractice", "disqualified", "manual-terminate"], default: undefined },

  // Anti-malpractice
  violations: { type: violationsSchema, default: () => ({}) },

  // Load-test marker (Phase 4 TEST_MODE) — lets cleanup delete ONLY test data.
  isTestCandidate:   { type: Boolean, default: false, index: true },

  // V3.1 forensics
  refreshCount:      { type: Number, default: 0 },        // browser refreshes during the attempt
  terminationReason: { type: String, default: undefined },// human-readable cause of auto-termination
  geo: {                                                   // captured once before start (Batch B)
    lat:      { type: Number, default: null },
    lng:      { type: Number, default: null },
    accuracy: { type: Number, default: null },
    distance: { type: Number, default: null },            // metres from the drive centre
    inside:   { type: Boolean, default: null },           // within the allowed radius?
    capturedAt: { type: Date },
  },
}, { timestamps: true });

// Compound indexes for the admin drive dashboard (college + assessment + status filters)
candidateSchema.index({ assessmentId: 1, createdAt: -1 }); // list/export sort (avoids 32MB in-memory sort)
candidateSchema.index({ createdAt: -1 });                  // global candidate list sort
candidateSchema.index({ assessmentId: 1, college: 1, status: 1 });
candidateSchema.index({ assessmentId: 1, status: 1 });
candidateSchema.index({ assessmentId: 1, score: -1 });
candidateSchema.index({ emailStatus: 1, emailScheduledAt: 1 }); // link-email scheduler poll
candidateSchema.index({ "shortlistEmail.status": 1, "shortlistEmail.scheduledAt": 1 }); // shortlist poll
candidateSchema.index({ "completionEmail.status": 1, "completionEmail.scheduledAt": 1 }); // completion poll
candidateSchema.index({ assessmentId: 1, email: 1 }, { unique: true }); // one invite per email per drive
// Round-wise dashboards / summaries across ALL drives of a round.
candidateSchema.index({ round: 1, status: 1 });
candidateSchema.index({ round: 1, college: 1, status: 1 });
candidateSchema.index({ round: 1, score: -1 });

/* ── NEW ARCHITECTURE INDEXES ────────────────────────────────────────────────
 * ONE participation per (application, round). The partial filter means the
 * constraint applies ONLY to records written by the new flow (legacy records
 * carry no isPrimary field and are therefore excluded), and a legitimate re-sit
 * stored with isPrimary:false is never blocked.
 */
candidateSchema.index({ applicationId: 1, roundId: 1 },
  { unique: true, partialFilterExpression: { isPrimary: true } });
candidateSchema.index({ roundId: 1, roundStatus: 1 });
candidateSchema.index({ roundId: 1, qualification: 1 });
candidateSchema.index({ roundId: 1, score: -1 });
candidateSchema.index({ workspaceId: 1, driveId: 1, createdAt: -1 });

candidateSchema.statics.STATUSES = STATUSES;
candidateSchema.statics.EMAIL_STATUSES = EMAIL_STATUSES;
candidateSchema.statics.ROUND_STATUSES = ROUND_STATUSES;
candidateSchema.statics.QUALIFICATIONS = QUALIFICATIONS;

// ── Round metadata (Round 1 = Aptitude, Round 2 = Technical). Data model stays
// numeric so more rounds can be added later; the UI shows these names. ─────────
const ROUND_NAMES = { 1: "Aptitude", 2: "Technical Round" };
candidateSchema.statics.ROUND_NAMES = ROUND_NAMES;
candidateSchema.statics.roundName = (n) => ROUND_NAMES[Number(n)] || (n ? `Round ${n}` : "—");

// Map the existing per-record `status` to the segregated round-status + overall-status
// vocabulary the admin UI uses — WITHOUT changing the stored enum (backward safe).
candidateSchema.statics.roundStatusOf = (status) => {
  switch (status) {
    case "invited": case "email-sent":            return "NOT_STARTED";
    case "started": case "in-progress":           return "IN_PROGRESS";
    case "completed":                             return "COMPLETED";
    case "shortlisted":                           return "SELECTED";
    case "rejected": case "disqualified":         return "REJECTED";
    default:                                      return "NOT_STARTED";
  }
};

module.exports = mongoose.model("Candidate", candidateSchema);
