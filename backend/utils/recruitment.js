const Round = require("../models/Round");
const Assessment = require("../models/Assessment");
const Drive = require("../models/Drive");
const Candidate = require("../models/Candidate");
const CandidateApplication = require("../models/CandidateApplication");
const Student = require("../models/Student");
const RegistrationField = require("../models/RegistrationField");
const { generateUniqueToken } = require("./tokens");

/*
 * RECRUITMENT ENGINE — the dynamic-round logic, in one place.
 *
 * Every function here resolves rounds BY ID, ordered by `sequence`. Nothing
 * reads a round's NAME, assumes a round NUMBER, or knows how many rounds a
 * drive has. A drive with 2 rounds and a drive with 10 rounds run identical
 * code paths, and renaming a round changes nothing but the label.
 */

class RuleError extends Error {
  constructor(status, message, extra = {}) { super(message); this.status = status; Object.assign(this, extra); }
}

// ── Round navigation (the ONLY way progression is decided) ───────────────────

const roundsOf = (driveId) => Round.find({ driveId }).sort({ sequence: 1 }).lean();

const nextRound = (round) =>
  Round.findOne({ driveId: round.driveId, sequence: { $gt: round.sequence } }).sort({ sequence: 1 });

const previousRound = (round) =>
  Round.findOne({ driveId: round.driveId, sequence: { $lt: round.sequence } }).sort({ sequence: -1 });

const finalRound = (driveId) => Round.findOne({ driveId }).sort({ sequence: -1 });

async function isFinalRound(round) {
  const last = await finalRound(round.driveId);
  return !!last && String(last._id) === String(round._id);
}

// ── Eligibility — enforced server-side before a candidate can enter a round ──

/*
 * Throws RuleError unless the application may take `round`.
 * The rule, expressed without any round name or number:
 *   "the participation for the round with the next-lower sequence in THIS drive
 *    must have qualification === QUALIFIED"
 */
async function assertEligible(application, round, { ignoreRoundStatus = false } = {}) {
  if (String(application.driveId) !== String(round.driveId)) {
    throw new RuleError(404, "Round not found.");
  }
  if (application.overallStatus === "REJECTED") {
    throw new RuleError(403, "This candidate has been rejected in an earlier round.");
  }
  if (!ignoreRoundStatus && round.status !== "ACTIVE") {
    throw new RuleError(403, "This round is not currently open.");
  }
  if (!round.requiresPreviousQualification) return true;

  const prev = await previousRound(round);
  if (!prev) return true;   // lowest sequence — nothing to clear

  const prevPart = await Candidate.findOne({
    applicationId: application._id, roundId: prev._id, isPrimary: true,
  }).select("qualification roundStatus").lean();

  if (!prevPart || prevPart.qualification !== "QUALIFIED") {
    throw new RuleError(403, `You have not qualified ${prev.name}.`, {
      state: "not-qualified", requiredRound: prev.name,
    });
  }
  return true;
}

// ── Registration completeness (mandatory fields before a test may start) ─────

async function missingRequiredFields(application, student) {
  const fields = await RegistrationField.find({
    workspaceId: application.workspaceId,
    driveId: { $in: [application.driveId, null] },
    isActive: true, required: true,
  }).lean();

  // A drive-specific field overrides the workspace default with the same key.
  const byKey = {};
  fields.forEach(f => {
    const cur = byKey[f.fieldKey];
    if (!cur || (f.driveId && !cur.driveId)) byKey[f.fieldKey] = f;
  });

  const data = application.registrationData instanceof Map
    ? Object.fromEntries(application.registrationData) : (application.registrationData || {});
  const custom = student?.customFields instanceof Map
    ? Object.fromEntries(student.customFields) : (student?.customFields || {});

  const missing = [];
  for (const f of Object.values(byKey)) {
    const v = f.mapsTo ? student?.[f.mapsTo] : (data[f.fieldKey] ?? custom[f.fieldKey]);
    if (v === undefined || v === null || String(v).trim() === "" || String(v).trim() === "—") {
      missing.push({ fieldKey: f.fieldKey, fieldName: f.fieldName });
    }
  }
  return missing;
}

// ── Every round owns exactly one Assessment (its "test") ─────────────────────

/*
 * Guarantees round.assessmentId. For TEST/CODING rounds this is the paper the
 * admin configures; for interview-style rounds it is an empty container that
 * never builds a paper and never appears in the drive list (isTest:true).
 *
 * WHY EVERY ROUND NEEDS ONE: the Candidate collection carries a long-standing
 * unique index on { assessmentId, email }. Participations in different rounds
 * of the same drive belong to the same person, so without a distinct
 * assessmentId per round the SECOND round would collide on that index and a
 * legitimate multi-round candidate could not be created. Giving each round its
 * own assessment keeps that index meaningful ("one row per person per round")
 * and leaves it completely untouched — no index is dropped or rebuilt.
 */
async function ensureRoundAssessment(round, drive = null) {
  if (round.assessmentId) return round.assessmentId;
  const d = drive || await Drive.findById(round.driveId).select("name").lean();
  const a = await Assessment.create({
    workspaceId: round.workspaceId,
    driveId: round.driveId,
    roundId: round._id,
    isTest: true,
    name: `${d?.name || "Drive"} — ${round.name}`,
    status: "ACTIVE",
    isActive: true,
  });
  await Round.updateOne({ _id: round._id }, { $set: { assessmentId: a._id } });
  round.assessmentId = a._id;
  return a._id;
}

// ── Participation (the round result row) ─────────────────────────────────────

/*
 * Returns the candidate's participation for a round, creating it if needed.
 * NEVER creates a second candidate/application — a participation always hangs
 * off the application that already exists.
 */
async function ensureParticipation(application, round, { assignedBy = "system", student = null } = {}) {
  const existing = await Candidate.findOne({
    applicationId: application._id, roundId: round._id, isPrimary: true,
  });
  if (existing) return existing;

  const s = student || await Student.findById(application.studentId).lean();
  if (!s) throw new RuleError(404, "Student not found.");

  const token = await generateUniqueToken(Candidate);
  const assessment = await ensureRoundAssessment(round);

  return Candidate.create({
    // new-architecture links
    workspaceId: application.workspaceId,
    driveId:     application.driveId,
    roundId:     round._id,
    applicationId: application._id,
    studentId:   s._id,
    isPrimary:   true,
    roundStatus: "NOT_STARTED",
    qualification: "PENDING",
    assignedAt: new Date(), assignedBy,
    // engine fields (unchanged semantics)
    assessmentId: assessment,
    name: s.name, email: s.email, college: s.college || "—",
    phone: s.phone, course: s.course, branch: s.branch,
    token, status: "invited", emailStatus: "pending",
    candidateSource: application.source === "WALK_IN" ? "WALK_IN" : "PRE_REGISTERED",
  });
}

// ── Cutoff ───────────────────────────────────────────────────────────────────

/*
 * Decides who qualifies, per the round's own cutoff configuration.
 * Returns { qualified:Set<id>, considered, method, value } WITHOUT writing.
 */
function decideQualified(round, participations, manualIds = null) {
  const method = round.cutoff?.method || "NONE";
  const value = round.cutoff?.value;
  const qualified = new Set();

  // Only genuinely completed attempts can qualify. Never-attempted and
  // disqualified records are never auto-qualified.
  const completed = participations.filter(p =>
    ["COMPLETED", "QUALIFIED", "REJECTED"].includes(p.roundStatus) && p.score != null);

  if (method === "MANUAL") {
    // The caller may pass either participation ids or application ids — the UI
    // works in candidates (applications), the storage works in participations.
    const picked = new Set((manualIds || []).map(String));
    participations.forEach(p => {
      if (picked.has(String(p._id)) || picked.has(String(p.applicationId))) qualified.add(String(p._id));
    });
  } else if (method === "PERCENTAGE" && value != null) {
    completed.forEach(p => {
      if (p.totalMarks > 0 && (p.score / p.totalMarks) * 100 >= value) qualified.add(String(p._id));
    });
  } else if (method === "MARKS" && value != null) {
    completed.forEach(p => { if (p.score >= value) qualified.add(String(p._id)); });
  } else if (method === "TOP_N" && value != null) {
    [...completed].sort((a, b) => (b.score - a.score) || (a.timeTakenSeconds || 0) - (b.timeTakenSeconds || 0))
      .slice(0, value).forEach(p => qualified.add(String(p._id)));
  }
  return { qualified, considered: completed.length, method, value };
}

// ── Application roll-up ──────────────────────────────────────────────────────

/*
 * Recomputes an application's overall status from its participations.
 * Final selection = qualified the LAST configured round, whatever it is called
 * and however many rounds there are.
 */
async function recomputeApplication(applicationId) {
  const app = await CandidateApplication.findById(applicationId);
  if (!app) return null;

  const [rounds, parts] = await Promise.all([
    roundsOf(app.driveId),
    Candidate.find({ applicationId: app._id, isPrimary: true })
      .select("roundId qualification roundStatus").lean(),
  ]);
  const byRound = {}; parts.forEach(p => { byRound[String(p.roundId)] = p; });

  let highest = 0, rejected = false, lastQualified = null;
  for (const r of rounds) {
    const p = byRound[String(r._id)];
    if (!p) continue;
    if (p.qualification === "QUALIFIED") { highest = Math.max(highest, r.sequence); lastQualified = r; }
    if (p.qualification === "REJECTED") rejected = true;
  }

  const last = rounds.length ? rounds[rounds.length - 1] : null;
  const clearedFinal = !!(last && lastQualified && String(lastQualified._id) === String(last._id));

  let overall;
  if (clearedFinal) overall = "FINALLY_SELECTED";
  else if (rejected) overall = "REJECTED";
  else if (highest > 0) overall = "SHORTLISTED";
  else if (parts.some(p => ["IN_PROGRESS", "COMPLETED"].includes(p.roundStatus))) overall = "IN_PROGRESS";
  else overall = "REGISTERED";

  // Current stage = the next round after the highest qualified one; if the
  // candidate has cleared everything, they are at final selection.
  let currentRoundId = null;
  if (!rejected) {
    const upcoming = rounds.find(r => r.sequence > highest);
    currentRoundId = upcoming ? upcoming._id : null;
  }

  app.overallStatus = overall;
  app.highestQualifiedSequence = highest;
  app.currentRoundId = currentRoundId;
  if (clearedFinal && !app.finalSelection?.selected) {
    app.finalSelection = { ...(app.finalSelection || {}), selected: true, selectedAt: new Date() };
  }
  if (!clearedFinal && app.finalSelection?.selected) {
    app.finalSelection.selected = false;   // an override took them back out
  }
  await app.save();
  return app;
}

// Map the engine's legacy `status` onto the round vocabulary. The legacy value
// is never modified — this only derives the round-level view of it.
function roundStatusFromLegacy(status) {
  switch (status) {
    case "invited": case "email-sent":   return "NOT_STARTED";
    case "started": case "in-progress":  return "IN_PROGRESS";
    case "completed":                    return "COMPLETED";
    case "shortlisted":                  return "QUALIFIED";
    case "rejected": case "disqualified":return "REJECTED";
    default:                             return "NOT_STARTED";
  }
}

module.exports = {
  RuleError,
  roundsOf, nextRound, previousRound, finalRound, isFinalRound,
  assertEligible, missingRequiredFields, ensureRoundAssessment,
  ensureParticipation, decideQualified, recomputeApplication, roundStatusFromLegacy,
};
