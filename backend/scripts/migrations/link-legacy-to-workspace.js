/*
 * LINK THE EXISTING RECRUITMENT DATA TO ITS WORKSPACE
 * ============================================================================
 *   node scripts/migrations/link-legacy-to-workspace.js              (dry run)
 *   node scripts/migrations/link-legacy-to-workspace.js --commit     (writes)
 *
 * Makes the records that already exist reachable inside
 *   "Inference Labs Private Limited"
 * by ADDING link fields and creating the master/application records the new
 * screens read. It is idempotent: a second run creates and changes nothing.
 *
 * NEVER touched: score, totalMarks, passed, sectionScores, answerSheet,
 * progress, violations, geo, token, tokenExpiresAt, status, email tracking,
 * timestamps. No document is deleted, renamed or dropped. No index is dropped.
 * ============================================================================
 */
require("dotenv").config({ path: require("path").join(__dirname, "..", "..", ".env") });
const mongoose = require("mongoose");
const Workspace = require("../../models/Workspace");
const Drive = require("../../models/Drive");
const Round = require("../../models/Round");
const Student = require("../../models/Student");
const CandidateApplication = require("../../models/CandidateApplication");
const RegistrationField = require("../../models/RegistrationField");
const Assessment = require("../../models/Assessment");
const Candidate = require("../../models/Candidate");
const Question = require("../../models/Question");

const COMMIT = process.argv.includes("--commit");
const WS_NAME = "Inference Labs Private Limited";
const DRIVE_NAME = "Inference Labs Recruitment";

const say = (s = "") => console.log(s);
const head = (s) => { say(""); say("═".repeat(76)); say("  " + s); say("═".repeat(76)); };
const em = (s) => String(s || "").trim().toLowerCase();
const ATTEMPTED = ["started", "in-progress", "completed", "shortlisted", "rejected", "disqualified"];

// The round names already recorded in the codebase for the existing data.
// Nothing is invented: rounds that exist in the data get their known label,
// anything else falls back to a neutral, sequence-derived name.
const KNOWN_ROUND_NAMES = { 1: "Aptitude", 2: "Technical Round" };
const roundName = (n) => KNOWN_ROUND_NAMES[n] || `Round ${n}`;

const counts = async () => ({
  workspaces: await Workspace.countDocuments(),
  drives: await Drive.countDocuments(),
  rounds: await Round.countDocuments(),
  students: await Student.countDocuments(),
  applications: await CandidateApplication.countDocuments(),
  candidates: await Candidate.countDocuments(),
  assessments: await Assessment.countDocuments(),
  questions: await Question.countDocuments(),
});

(async () => {
  await mongoose.connect(process.env.MONGO_URI, { serverSelectionTimeoutMS: 20000 });

  head(COMMIT ? "MIGRATION — COMMIT MODE" : "MIGRATION — DRY RUN (no writes)");
  const before = await counts();
  say("  BEFORE");
  Object.entries(before).forEach(([k, v]) => say(`    ${k.padEnd(16)} ${v}`));

  const stats = {
    workspaceCreated: 0, workspaceReused: 0, fieldsSeeded: 0,
    driveCreated: 0, driveReused: 0, roundsCreated: 0, roundsReused: 0,
    assessmentsLinked: 0, assessmentsAlready: 0,
    studentsCreated: 0, studentsReused: 0,
    applicationsCreated: 0, applicationsReused: 0,
    participationsLinked: 0, participationsAlready: 0,
    questionsLinked: 0, questionsAlready: 0,
    deleted: 0, scoresChanged: 0, tokensChanged: 0,
  };

  /* ── 1 · workspace (find or create — never a second one) ─────────────── */
  head("1 · WORKSPACE");
  let ws = await Workspace.findOne({ name: WS_NAME });
  if (!ws) ws = await Workspace.findOne({ name: /inference\s*labs/i });
  if (ws) {
    stats.workspaceReused = 1;
    say(`  reusing existing workspace: "${ws.name}"  (${ws._id})`);
  } else if (COMMIT) {
    ws = await Workspace.create({
      name: WS_NAME, companyName: WS_NAME, slug: "inference-labs-private-limited",
      isActive: true, createdBy: "migration",
    });
    stats.workspaceCreated = 1;
    say(`  created workspace: "${ws.name}"  (${ws._id})`);
  } else {
    say(`  would create workspace: "${WS_NAME}"`);
  }

  if (ws) {
    const have = await RegistrationField.countDocuments({ workspaceId: ws._id });
    if (!have) {
      if (COMMIT) {
        await RegistrationField.insertMany(
          RegistrationField.SYSTEM_FIELDS.map(f => ({ ...f, workspaceId: ws._id, driveId: null })), { ordered: false });
      }
      stats.fieldsSeeded = RegistrationField.SYSTEM_FIELDS.length;
      say(`  ${COMMIT ? "seeded" : "would seed"} ${stats.fieldsSeeded} default registration fields`);
    } else say(`  registration fields already present (${have})`);
  }

  /* ── 2 · one drive holding the existing rounds ────────────────────────── */
  head("2 · DRIVE");
  let drive = ws ? await Drive.findOne({ workspaceId: ws._id, name: DRIVE_NAME }) : null;
  if (drive) { stats.driveReused = 1; say(`  reusing drive "${drive.name}" (${drive._id})`); }
  else if (COMMIT && ws) {
    drive = await Drive.create({
      workspaceId: ws._id, name: DRIVE_NAME, slug: "inference-labs-recruitment",
      description: "Existing recruitment records.", status: "ACTIVE", isHistorical: true, createdBy: "migration",
    });
    stats.driveCreated = 1; say(`  created drive "${drive.name}" (${drive._id})`);
  } else say(`  would create drive "${DRIVE_NAME}"`);

  /* ── 3 · rounds, derived from the rounds the data actually uses ───────── */
  head("3 · ROUNDS");
  const roundNumbers = (await Assessment.distinct("round")).filter(n => n != null).sort((a, b) => a - b);
  say(`  round numbers found in the existing assessments: ${roundNumbers.join(", ") || "(none)"}`);
  const roundByNumber = {};
  for (const n of roundNumbers) {
    if (!drive) { say(`  would create round ${n} "${roundName(n)}"`); continue; }
    let r = await Round.findOne({ driveId: drive._id, sequence: n });
    if (r) { stats.roundsReused++; }
    else if (COMMIT) {
      r = await Round.create({
        workspaceId: ws._id, driveId: drive._id, name: roundName(n), sequence: n,
        roundType: "TEST", status: "CLOSED",
        cutoff: { method: "NONE", value: null },
        // Historical participants were chosen outside this system, so this round
        // is not gated retroactively.
        requiresPreviousQualification: false,
      });
      stats.roundsCreated++;
    }
    if (r) roundByNumber[n] = r;
    say(`  round ${n} → "${roundName(n)}" ${r ? (stats.roundsCreated ? "created/ok" : "reused") : "(dry run)"}`);
  }

  /* ── 4 · assessments become the tests of those rounds ─────────────────── */
  head("4 · ASSESSMENTS → ROUND TESTS");
  const assessments = await Assessment.find().select("_id round workspaceId driveId roundId").lean();
  for (const a of assessments) {
    if (a.workspaceId && a.driveId && a.roundId) { stats.assessmentsAlready++; continue; }
    const r = roundByNumber[a.round || 1];
    if (!r) continue;
    if (COMMIT) {
      await Assessment.updateOne({ _id: a._id },
        { $set: { workspaceId: ws._id, driveId: drive._id, roundId: r._id } });
    }
    stats.assessmentsLinked++;
  }
  say(`  linked ${stats.assessmentsLinked} · already linked ${stats.assessmentsAlready}`);

  /* ── 5 · master students (one per person, by email) ───────────────────── */
  head("5 · STUDENTS");
  // ONLY records that belong to an assessment this workspace owns. Without this
  // guard the migration would sweep in any unrelated candidate row that happens
  // to exist (for example a record left behind by a test run) and manufacture an
  // application for it in this company's workspace.
  const ownedAssessmentIds = await Assessment.find(
    { workspaceId: ws ? ws._id : null }).distinct("_id");
  const cands = await Candidate.find({ assessmentId: { $in: ownedAssessmentIds } })
    .select("_id name email phone college course branch assessmentId round status score totalMarks " +
            "completedAt createdAt workspaceId applicationId studentId roundId isPrimary")
    .lean();
  say(`  scope: ${ownedAssessmentIds.length} assessments owned by this workspace`);
  const byEmail = {};
  cands.forEach(c => { (byEmail[em(c.email)] ||= []).push(c); });
  say(`  ${cands.length} existing candidate records → ${Object.keys(byEmail).length} distinct people`);

  const studentByEmail = {};
  for (const [mail, rows] of Object.entries(byEmail)) {
    if (!mail) continue;
    let s = await Student.findOne({ $or: [{ email: mail }, { alternateEmails: mail }] });
    if (s) { stats.studentsReused++; }
    else if (COMMIT) {
      // Best available identity from that person's own records — nothing invented.
      const best = (k) => rows.map(r => r[k]).find(v => v && String(v).trim() && String(v).trim() !== "—") || "";
      s = await Student.create({
        email: mail, name: best("name") || "Candidate", phone: best("phone"),
        college: best("college"), course: best("course"), branch: best("branch"),
      });
      stats.studentsCreated++;
    }
    if (s) studentByEmail[mail] = s;
  }
  say(`  ${COMMIT ? "created" : "would create"} ${COMMIT ? stats.studentsCreated : Object.keys(byEmail).length - stats.studentsReused} · reused ${stats.studentsReused}`);

  /* ── 6 · one application per person for this drive ────────────────────── */
  head("6 · CANDIDATE APPLICATIONS");
  const appByEmail = {};
  if (drive) {
    for (const mail of Object.keys(byEmail)) {
      const s = studentByEmail[mail];
      if (!s) continue;
      let app = await CandidateApplication.findOne({ workspaceId: ws._id, driveId: drive._id, studentId: s._id });
      if (app) { stats.applicationsReused++; }
      else if (COMMIT) {
        app = await CandidateApplication.create({
          workspaceId: ws._id, driveId: drive._id, studentId: s._id,
          source: "MIGRATED", overallStatus: "REGISTERED",
        });
        stats.applicationsCreated++;
      }
      if (app) appByEmail[mail] = app;
    }
  }
  say(`  ${COMMIT ? "created" : "would create"} ${COMMIT ? stats.applicationsCreated : Object.keys(byEmail).length - stats.applicationsReused} · reused ${stats.applicationsReused}`);

  /* ── 7 · existing candidate rows become round participations ──────────── */
  head("7 · CANDIDATE RECORDS → ROUND PARTICIPATIONS");
  const roundStatusOf = (s) => {
    switch (s) {
      case "invited": case "email-sent": return "NOT_STARTED";
      case "started": case "in-progress": return "IN_PROGRESS";
      case "completed": return "COMPLETED";
      case "shortlisted": return "QUALIFIED";
      case "rejected": case "disqualified": return "REJECTED";
      default: return "NOT_STARTED";
    }
  };
  const pickPrimary = (rows) => {
    const tried = rows.filter(r => ATTEMPTED.includes(r.status));
    const pool = tried.length ? tried : rows;
    return [...pool].sort((a, b) => {
      const sa = a.score == null ? -1 : a.score, sb = b.score == null ? -1 : b.score;
      if (sb !== sa) return sb - sa;
      return new Date(b.completedAt || b.createdAt) - new Date(a.completedAt || a.createdAt);
    })[0];
  };

  for (const [mail, rows] of Object.entries(byEmail)) {
    const app = appByEmail[mail];
    if (!app) continue;
    const byRound = {};
    rows.forEach(c => { (byRound[c.round || 1] ||= []).push(c); });

    for (const [num, group] of Object.entries(byRound)) {
      const r = roundByNumber[num];
      if (!r) continue;
      const primary = pickPrimary(group);
      for (const c of group) {
        if (c.applicationId && c.workspaceId && c.roundId) { stats.participationsAlready++; continue; }
        if (COMMIT) {
          await Candidate.updateOne({ _id: c._id }, { $set: {
            // ADDED link fields only — the allowlist below is the entire write.
            workspaceId: ws._id, driveId: drive._id, roundId: r._id,
            applicationId: app._id, studentId: studentByEmail[mail]._id,
            isPrimary: String(c._id) === String(primary._id),
            roundStatus: roundStatusOf(c.status),
            qualification: "HISTORICAL_NOT_DETERMINED",
            qualificationSource: "NOT_STORED_IN_LEGACY_SYSTEM",
          }});
        }
        stats.participationsLinked++;
      }
    }
  }
  say(`  ${COMMIT ? "linked" : "would link"} ${stats.participationsLinked} · already linked ${stats.participationsAlready}`);

  /* ── 8 · questions belong to the workspace ────────────────────────────── */
  head("8 · QUESTIONS");
  const qUnlinked = await Question.countDocuments({ workspaceId: { $exists: false } });
  if (COMMIT && ws && qUnlinked) {
    const r = await Question.updateMany({ workspaceId: { $exists: false } }, { $set: { workspaceId: ws._id } });
    stats.questionsLinked = r.modifiedCount;
  } else stats.questionsLinked = qUnlinked;
  stats.questionsAlready = await Question.countDocuments({ workspaceId: { $exists: true } });
  say(`  ${COMMIT ? "linked" : "would link"} ${stats.questionsLinked} · already linked ${stats.questionsAlready}`);

  /* ── summary ──────────────────────────────────────────────────────────── */
  head("SUMMARY");
  Object.entries(stats).forEach(([k, v]) => say(`  ${k.padEnd(24)} ${v}`));

  const after = await counts();
  say("");
  say("  AFTER");
  Object.entries(after).forEach(([k, v]) => {
    const delta = v - before[k];
    say(`    ${k.padEnd(16)} ${String(v).padStart(6)}   ${delta === 0 ? "" : `(${delta > 0 ? "+" : ""}${delta})`}`);
  });
  say("");
  say(`  documents deleted ........ 0`);
  say(`  scores modified .......... 0`);
  say(`  tokens modified .......... 0`);
  say(`  indexes dropped .......... 0`);
  say(`  collections renamed ...... 0`);
  say("");
  say(COMMIT ? "  STATUS: COMMITTED." : "  STATUS: DRY RUN — nothing was written. Re-run with --commit to apply.");

  await mongoose.disconnect();
})().catch(e => { console.error("MIGRATION FAILED:", e); process.exit(1); });
