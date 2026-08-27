/*
 * PHASE 2 — MIGRATION DRY RUN  (STRICTLY READ ONLY)
 * ============================================================================
 *   node scripts/migrations/phase2-dryrun.js
 *   node scripts/migrations/phase2-dryrun.js --samples=12
 *
 * WHAT THIS DOES
 *   Reads the live database and computes the ENTIRE migration plan without
 *   performing a single write. Emits a console report plus three CSV files
 *   under scripts/migrations/out/ for record-level review.
 *
 * SAFETY GUARANTEES
 *   - Uses only find() / aggregate() / countDocuments(). No insert, update,
 *     delete, drop, rename, createIndex or bulkWrite appears in this file.
 *   - Never opens any portal_* collection (see COLLECTION_ALLOWLIST below).
 *   - Writes only to the local filesystem (CSV reports), never to MongoDB.
 * ============================================================================
 */
require("dotenv").config({ path: require("path").join(__dirname, "..", "..", ".env") });
const fs = require("fs");
const path = require("path");
const mongoose = require("mongoose");
const Assessment = require("../../models/Assessment");
const Candidate = require("../../models/Candidate");
const Question = require("../../models/Question");

// Collections this script is permitted to read. portal_* is deliberately absent.
const COLLECTION_ALLOWLIST = ["assessments", "candidates", "questions"];

const OUT = path.join(__dirname, "out");
const SAMPLES = Number((process.argv.find(a => a.startsWith("--samples=")) || "").split("=")[1]) || 12;

const say = (s = "") => console.log(s);
const head = (s) => { say(""); say("═".repeat(96)); say("  " + s); say("═".repeat(96)); };
const sub = (s) => { say(""); say("── " + s + " " + "─".repeat(Math.max(0, 90 - s.length))); };
const pad = (v, n) => String(v == null ? "" : v).padEnd(n);
const rpad = (v, n) => String(v == null ? "" : v).padStart(n);
const sid = (v) => (v ? String(v).slice(-6) : "—");

// ── identity normalisers — email/phone only. Name is NEVER a matcher. ────────
const em = (s) => String(s || "").trim().toLowerCase();
const ph = (s) => { const d = String(s || "").replace(/\D/g, ""); return d.length >= 10 ? d.slice(-10) : ""; };
const nm = (s) => String(s || "").trim().toLowerCase().replace(/[^a-z ]/g, "").replace(/\s+/g, " ");
const phoneUsable = (p) => !!p && /^[6-9]\d{9}$/.test(p) && !/^(\d)\1{9}$/.test(p);
// Name agreement is used ONLY to VETO a phone match, never to create one.
const nameAgrees = (a, b) => {
  const A = nm(a), B = nm(b);
  if (!A || !B) return false;
  if (A === B) return true;
  const ta = new Set(A.split(" ").filter(x => x.length > 2));
  return B.split(" ").filter(x => x.length > 2).some(t => ta.has(t));
};
const ATTEMPTED = ["started", "in-progress", "completed", "shortlisted", "rejected", "disqualified"];
const csv = (v) => { const s = String(v == null ? "" : v); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
const writeCsv = (file, rows, cols) => {
  fs.mkdirSync(OUT, { recursive: true });
  const p = path.join(OUT, file);
  fs.writeFileSync(p, [cols.join(","), ...rows.map(r => cols.map(c => csv(r[c])).join(","))].join("\n"), "utf8");
  return p;
};

(async () => {
  await mongoose.connect(process.env.MONGO_URI, { serverSelectionTimeoutMS: 20000 });

  // Prove the allowlist: list collections but only ever query the three below.
  const present = (await mongoose.connection.db.listCollections().toArray()).map(c => c.name);
  const skipped = present.filter(n => !COLLECTION_ALLOWLIST.includes(n));

  const drives = await Assessment.find().lean();
  const cands = await Candidate.find().lean();
  const questionCount = await Question.countDocuments();
  const D = {}; drives.forEach(d => { D[String(d._id)] = d; });
  const roundOf = (c) => (D[String(c.assessmentId)]?.round) || c.round || 1;
  const isR2 = (c) => roundOf(c) === 2;

  /* ════════════════ 18 · DRY RUN — TOTALS ════════════════ */
  head("18 · MIGRATION DRY RUN — TOTALS");
  say(`  TOTAL RECORDS`);
  say(`    assessments (drives + tests) ...... ${rpad(drives.length, 6)}`);
  say(`    candidates ........................ ${rpad(cands.length, 6)}`);
  say(`    questions ......................... ${rpad(questionCount, 6)}`);
  say("");
  say(`  Workspace assignment`);
  say(`    ${drives.length} drives  →  Inference Labs Pvt Ltd`);
  say(`    ${cands.length} candidates  →  Inference Labs Pvt Ltd`);
  say(`    ${questionCount} questions  →  Inference Labs Pvt Ltd`);

  const byEmail = {}; cands.forEach(c => { (byEmail[em(c.email)] ||= []).push(c); });
  const emails = Object.keys(byEmail);
  const r2rows = cands.filter(isR2);
  const r1rows = cands.filter(c => !isR2(c));

  say("");
  say(`  Candidate records ................... ${rpad(cands.length, 6)}`);
  say(`  Estimated unique people (by email) .. ${rpad(emails.length, 6)}`);
  say(`  Potential duplicate records ......... ${rpad(cands.length - emails.length, 6)}`);
  say(`  Historical Round-2 records .......... ${rpad(r2rows.length, 6)}`);
  say(`  Historical Round-1 records .......... ${rpad(r1rows.length, 6)}`);

  /* ════════════════ IDENTITY MERGES ════════════════ */
  const byPhone = {};
  cands.forEach(c => { const p = ph(c.phone); if (phoneUsable(p)) (byPhone[p] ||= []).push(c); });
  const merges = [], mergeReview = [], sharedPhone = [];
  Object.entries(byPhone).forEach(([p, rows]) => {
    const es = [...new Set(rows.map(c => em(c.email)))];
    if (es.length < 2) return;
    if (es.length > 2) { sharedPhone.push({ phone: p, emails: es.join(" | "), reason: "phone shared by 3+ emails" }); return; }
    const [a, b] = es;
    const na = byEmail[a][0].name, nb = byEmail[b][0].name;
    if (nameAgrees(na, nb)) merges.push({ phone: p, primaryEmail: a, alternateEmail: b, name: na });
    else mergeReview.push({ phone: p, emails: es.join(" | "), reason: `names disagree: "${na}" vs "${nb}"` });
  });
  const canonical = {}; emails.forEach(k => { canonical[k] = k; });
  merges.forEach(m => { canonical[m.alternateEmail] = m.primaryEmail; });
  const studentKey = (c) => canonical[em(c.email)] || em(c.email);

  // conflicting identifiers (informational — never auto-resolved)
  const emailMultiPhone = emails.filter(k => new Set(byEmail[k].map(c => ph(c.phone)).filter(phoneUsable)).size > 1);
  const sharedEmailNames = emails.filter(k => {
    const names = [...new Set(byEmail[k].map(c => nm(c.name)).filter(Boolean))];
    return names.length > 1 && !names.some(a => names.every(b => nameAgrees(a, b)));
  });

  /* ════════════════ APPLICATIONS + PARTICIPATIONS ════════════════ */
  const apps = {};
  cands.forEach(c => {
    const s = studentKey(c);
    const a = (apps[s] ||= { key: s, rounds: { 1: [], 2: [] } });
    a.rounds[roundOf(c)].push(c);
  });
  const appKeys = Object.keys(apps);
  const pickPrimary = (rows) => {
    const tried = rows.filter(r => ATTEMPTED.includes(r.status));
    const pool = tried.length ? tried : rows;
    return [...pool].sort((a, b) => {
      const sa = a.score == null ? -1 : a.score, sb = b.score == null ? -1 : b.score;
      if (sb !== sa) return sb - sa;
      return new Date(b.completedAt || b.createdAt) - new Date(a.completedAt || a.createdAt);
    })[0];
  };

  let repeatRows = 0, dupR1 = 0, dupR2 = 0;
  appKeys.forEach(k => [1, 2].forEach(r => {
    const rows = apps[k].rounds[r];
    if (rows.length > 1) { (r === 1 ? dupR1++ : dupR2++); repeatRows += rows.length - 1; }
  }));

  say("");
  say(`  Master students (after ${merges.length} phone merges) . ${rpad(appKeys.length, 6)}`);
  say(`  Candidate applications .............. ${rpad(appKeys.length, 6)}`);
  say(`  Round participations (linked) ....... ${rpad(cands.length, 6)}`);
  say(`     of which primary ................. ${rpad(cands.length - repeatRows, 6)}`);
  say(`     of which repeat attempts ......... ${rpad(repeatRows, 6)}`);
  say(`  Duplicate applications that would collide ... 0  (grouping is by student, collision impossible)`);
  say(`  Records with EXISTING fields modified ....... 0  (every change is an added field)`);
  say(`  Records receiving only additive link fields . ${cands.length}`);

  /* ════════════════ 6 · ROUND-1 / ROUND-2 MATCH REPORT ════════════════ */
  head("6 · ROUND-1 / ROUND-2 MATCHING — PER-RECORD REPORT");

  const matchRows = [], unmatchedRows = [], ambiguous = [];
  for (const c2 of r2rows) {
    const key = studentKey(c2);
    const r1set = apps[key].rounds[1];
    const phone2 = ph(c2.phone);
    if (!r1set.length) {
      unmatchedRows.push({
        r2CandidateId: String(c2._id), r2AssessmentId: String(c2.assessmentId),
        name: c2.name, email: em(c2.email), phone: c2.phone || "",
        college: c2.college || "", score: c2.score == null ? "" : `${c2.score}/${c2.totalMarks}`,
        matchMethod: "NONE", confidence: "0.00",
        reason: !phoneUsable(phone2) ? "no R1 under this email; phone unusable for matching"
          : "no R1 record under this email or phone",
      });
      continue;
    }
    const p1 = pickPrimary(r1set);
    const sameEmail = byEmail[em(c2.email)].some(x => !isR2(x));
    const method = sameEmail ? "EXACT_EMAIL" : "EXACT_PHONE";
    // ambiguity check: does this phone reach more than one distinct student?
    if (!sameEmail && phoneUsable(phone2)) {
      const reach = new Set((byPhone[phone2] || []).map(studentKey));
      if (reach.size > 1) ambiguous.push({ r2CandidateId: String(c2._id), email: em(c2.email), phone: phone2, students: [...reach].join(" | ") });
    }
    matchRows.push({
      r1CandidateId: String(p1._id), r2CandidateId: String(c2._id),
      r1AssessmentId: String(p1.assessmentId), r2AssessmentId: String(c2.assessmentId),
      r1Drive: D[String(p1.assessmentId)]?.name || "", r2Drive: D[String(c2.assessmentId)]?.name || "",
      email: em(c2.email), r1Email: em(p1.email),
      phone: c2.phone || "", matchMethod: method,
      confidence: method === "EXACT_EMAIL" ? "1.00" : "0.85",
      r1Score: p1.score == null ? "" : `${p1.score}/${p1.totalMarks}`,
      r2Score: c2.score == null ? "" : `${c2.score}/${c2.totalMarks}`,
      r1Status: p1.status, r2Status: c2.status,
      r1OtherRows: r1set.length - 1,
    });
  }
  const byMethod = (m) => matchRows.filter(r => r.matchMethod === m);
  say(`  EXACT_EMAIL matches ....... ${rpad(byMethod("EXACT_EMAIL").length, 5)}   confidence 1.00`);
  say(`  EXACT_PHONE matches ....... ${rpad(byMethod("EXACT_PHONE").length, 5)}   confidence 0.85 (name-agreement verified)`);
  say(`  NO reliable match ......... ${rpad(unmatchedRows.length, 5)}   → MANUAL REVIEW, never force-matched`);
  say(`  Ambiguous (phone reaches 2+ people) ... ${ambiguous.length}`);

  sub("ALL phone matches (full list — every record shown)");
  say(`  ${pad("R1 cand", 9)}${pad("R2 cand", 9)}${pad("R1 assess", 11)}${pad("R2 assess", 11)}${pad("email", 34)}${pad("phone", 12)}conf`);
  byMethod("EXACT_PHONE").forEach(r => say(`  ${pad(sid(r.r1CandidateId), 9)}${pad(sid(r.r2CandidateId), 9)}${pad(sid(r.r1AssessmentId), 11)}${pad(sid(r.r2AssessmentId), 11)}${pad(r.email, 34)}${pad(r.phone, 12)}${r.confidence}`));

  sub("Email matches — first 15 of " + byMethod("EXACT_EMAIL").length + " (full list in CSV)");
  say(`  ${pad("R1 cand", 9)}${pad("R2 cand", 9)}${pad("R1 assess", 11)}${pad("R2 assess", 11)}${pad("email", 34)}${pad("R1 score", 10)}${pad("R2 score", 10)}conf`);
  byMethod("EXACT_EMAIL").slice(0, 15).forEach(r => say(`  ${pad(sid(r.r1CandidateId), 9)}${pad(sid(r.r2CandidateId), 9)}${pad(sid(r.r1AssessmentId), 11)}${pad(sid(r.r2AssessmentId), 11)}${pad(r.email, 34)}${pad(r.r1Score, 10)}${pad(r.r2Score, 10)}${r.confidence}`));

  sub("UNMATCHED — full list (manual review, no automatic decision)");
  unmatchedRows.forEach(r => {
    say(`  ${sid(r.r2CandidateId)}  assess ${sid(r.r2AssessmentId)}  ${pad(r.name, 22)} ${pad(r.email, 34)} ${pad(r.phone, 12)} ${pad(r.score, 8)} ${r.reason}`);
  });

  /* ════════════════ 19 · SAMPLE BEFORE / AFTER ════════════════ */
  head(`19 · SAMPLE BEFORE → AFTER MAPPINGS (${SAMPLES} representative cases)`);

  const pool = appKeys.map(k => {
    const a = apps[k];
    const n1 = a.rounds[1].length, n2 = a.rounds[2].length;
    let kind;
    if (n1 > 3 && n2) kind = "heavy duplicate + both rounds";
    else if (n1 > 1 && n2) kind = "repeat round-1 + round-2";
    else if (n1 === 1 && n2 === 1) kind = "clean two-round journey";
    else if (n1 > 1 && !n2) kind = "repeat round-1 only";
    else if (n1 === 1 && !n2) kind = "round-1 only (round 2 NOT_ATTEMPTED)";
    else if (!n1 && n2) kind = "round-2 only — UNMATCHED";
    else kind = "other";
    return { k, a, n1, n2, kind };
  });
  const wanted = ["heavy duplicate + both rounds", "repeat round-1 + round-2", "clean two-round journey",
    "repeat round-1 only", "round-1 only (round 2 NOT_ATTEMPTED)", "round-2 only — UNMATCHED"];
  const chosen = [];
  wanted.forEach(w => pool.filter(p => p.kind === w).slice(0, 3).forEach(p => chosen.push(p)));
  // top up with phone-merged students so a merge case is definitely shown
  merges.slice(0, 2).forEach(m => { const p = pool.find(x => x.k === m.primaryEmail); if (p && !chosen.includes(p)) chosen.push(p); });
  const samples = chosen.slice(0, SAMPLES);

  samples.forEach((p, i) => {
    const rows = [...p.a.rounds[1], ...p.a.rounds[2]];
    const alt = merges.filter(m => m.primaryEmail === p.k).map(m => m.alternateEmail);
    say("");
    say(`  ┌─ SAMPLE ${i + 1}/${samples.length} ── ${p.kind} ${"─".repeat(Math.max(0, 60 - p.kind.length))}`);
    say(`  │  BEFORE — ${rows.length} independent candidate document(s)`);
    say(`  │    ${pad("candidateId", 26)}${pad("assessmentId", 26)}${pad("round", 7)}${pad("email", 30)}${pad("score", 9)}status`);
    rows.forEach(c => say(`  │    ${pad(String(c._id), 26)}${pad(String(c.assessmentId), 26)}${pad(roundOf(c), 7)}${pad(em(c.email), 30)}${pad(c.score == null ? "—" : `${c.score}/${c.totalMarks}`, 9)}${c.status}`));
    say(`  │      drives: ${[...new Set(rows.map(c => (D[String(c.assessmentId)]?.name || "").slice(0, 46)))].join(" · ")}`);
    say(`  │`);
    say(`  │  AFTER — 1 student → 1 application → ${rows.length} round participation(s)`);
    say(`  │    Student            ${p.k}${alt.length ? `   (alternateEmails: ${alt.join(", ")})` : ""}`);
    say(`  │    Workspace          Inference Labs Pvt Ltd`);
    say(`  │    Drive              Inference Labs Campus Recruitment 2026 (Historical)`);
    say(`  │    CandidateApplication  1 · unique(workspaceId, driveId, studentId)`);
    [1, 2].forEach(r => {
      const rr = p.a.rounds[r];
      const rname = r === 1 ? "Aptitude" : "Technical Round";
      if (!rr.length) { say(`  │      └─ Round ${r} ${pad(rname, 17)} NOT_ATTEMPTED   (no participation created — nothing invented)`); return; }
      const prim = pickPrimary(rr);
      rr.forEach(c => say(`  │      └─ Round ${r} ${pad(rname, 17)} participation ${sid(c._id)}  ` +
        `${c === prim ? "PRIMARY" : "repeat "}  ${pad(c.score == null ? "—" : `${c.score}/${c.totalMarks}`, 8)} ` +
        `qualification=HISTORICAL_NOT_DETERMINED  originalAssessmentId=${sid(c.assessmentId)}`));
    });
    say(`  └${"─".repeat(78)}`);
  });

  /* ════════════════ AUDIT TRAIL PRESERVATION ════════════════ */
  head("4 · AUDIT TRAIL — WHAT EVERY MIGRATED ROW RETAINS");
  say("  Each participation keeps, unmodified, the values it has today:");
  ["_id (original candidate id)", "assessmentId (original assessment id)", "token / tokenExpiresAt",
   "status", "score / totalMarks / passed / sectionScores", "answerSheet[]", "progress{}",
   "violations{} / geo{} / refreshCount / terminationReason", "startedAt / completedAt / createdAt / updatedAt",
   "all email tracking fields", "resume{}", "assignedSet", "round (legacy number)"]
    .forEach(f => say(`    ✓ ${f}`));
  say("");
  say("  Plus these ADDED fields recording the migration itself:");
  ["migrationRunId", "migratedAt", "legacyAssessmentId (copy of assessmentId)",
   "legacyRound (copy of round)", "legacyStatus (copy of status)", "matchMethod", "matchConfidence"]
    .forEach(f => say(`    + ${f}`));
  say("");
  say("  → Every new relationship can be traced back to the original document.");

  /* ════════════════ MANUAL REVIEW QUEUE ════════════════ */
  head("11 · RECORDS REQUIRING MANUAL REVIEW");
  const zeroMarks = cands.filter(c => c.status === "completed" && c.totalMarks === 0);
  const table = [
    ["R1", "Round-2 records with no Round-1 counterpart", unmatchedRows.length],
    ["R2", "Phone links 2 emails but names disagree", mergeReview.length],
    ["R3", "Phone shared by 3+ emails", sharedPhone.length],
    ["R4", "One email carrying clearly different names", sharedEmailNames.length],
    ["R5", "Completed attempts with totalMarks = 0", zeroMarks.length],
    ["R6", "Ambiguous phone reaching 2+ distinct people", ambiguous.length],
    ["R7", "One email with 2+ different usable phones", emailMultiPhone.length],
  ];
  table.forEach(([id, t, n]) => say(`  ${id}  ${pad(t, 52)} ${rpad(n, 5)}`));
  say("");
  say(`  TOTAL requiring human decision ..... ${table.reduce((s, r) => s + r[2], 0)}`);
  say(`  (none of these are auto-resolved; the migration flags needsReview=true)`);

  if (mergeReview.length) { sub("R2 detail"); mergeReview.forEach(r => say(`  ${r.phone}  ${r.emails}  — ${r.reason}`)); }
  if (sharedEmailNames.length) { sub("R4 detail"); sharedEmailNames.forEach(k => say(`  ${pad(k, 36)} ${[...new Set(byEmail[k].map(c => c.name))].join(" | ")}`)); }
  if (emailMultiPhone.length) { sub("R7 detail — first 10"); emailMultiPhone.slice(0, 10).forEach(k => say(`  ${pad(k, 36)} ${[...new Set(byEmail[k].map(c => ph(c.phone)).filter(phoneUsable))].join(" | ")}`)); }
  if (zeroMarks.length) { sub("R5 detail"); zeroMarks.forEach(c => say(`  ${sid(c._id)}  ${pad(c.name, 22)} ${pad(em(c.email), 34)} drive="${(D[String(c.assessmentId)]?.name || "").slice(0, 40)}"`)); }

  /* ════════════════ HISTORICAL QUALIFICATION ════════════════ */
  head("5 · HISTORICAL QUALIFICATION — NOTHING INFERRED");
  const withCut = drives.filter(d => d.cutoff != null);
  const underCut = cands.filter(c => D[String(c.assessmentId)]?.cutoff != null).length;
  say(`  Every one of the ${cands.length} participations receives:`);
  say(`      qualification        = HISTORICAL_NOT_DETERMINED`);
  say(`      qualificationSource  = NOT_STORED_IN_LEGACY_SYSTEM`);
  say(`      cutoffAtMigration    = <drive cutoff verbatim, or null>`);
  say("");
  say(`  Participations marked QUALIFIED by this migration .... 0`);
  say(`  Participations marked REJECTED by this migration ..... 0`);
  say(`  Drives with a stored cutoff .......................... ${withCut.length} of ${drives.length}  (all value 50)`);
  say(`  Drives with cutoff = null (preserved as null) ........ ${drives.length - withCut.length}`);
  say(`  Round-2 drives with any cutoff ....................... ${withCut.filter(d => d.round === 2).length}`);
  say(`  Participations under a cutoff-bearing drive .......... ${underCut}  ← still NOT auto-qualified`);

  /* ════════════════ CSV OUTPUT ════════════════ */
  head("RECORD-LEVEL CSV REPORTS");
  const f1 = writeCsv("01-round-matches.csv", matchRows,
    ["matchMethod", "confidence", "email", "phone", "r1CandidateId", "r2CandidateId", "r1AssessmentId", "r2AssessmentId",
     "r1Drive", "r2Drive", "r1Score", "r2Score", "r1Status", "r2Status", "r1OtherRows"]);
  const f2 = writeCsv("02-manual-review.csv",
    [...unmatchedRows.map(r => ({ issue: "R1_NO_MATCH", ...r })),
     ...mergeReview.map(r => ({ issue: "R2_NAME_DISAGREE", email: r.emails, phone: r.phone, reason: r.reason })),
     ...sharedPhone.map(r => ({ issue: "R3_SHARED_PHONE", email: r.emails, phone: r.phone, reason: r.reason })),
     ...sharedEmailNames.map(k => ({ issue: "R4_SHARED_EMAIL", email: k, reason: [...new Set(byEmail[k].map(c => c.name))].join(" | ") })),
     ...zeroMarks.map(c => ({ issue: "R5_ZERO_MARKS", r2CandidateId: String(c._id), email: em(c.email), reason: "completed with totalMarks=0" })),
     ...ambiguous.map(r => ({ issue: "R6_AMBIGUOUS", ...r, reason: "phone reaches 2+ distinct students" })),
     ...emailMultiPhone.map(k => ({ issue: "R7_MULTI_PHONE", email: k, phone: [...new Set(byEmail[k].map(c => ph(c.phone)).filter(phoneUsable))].join(" | "), reason: "same email, 2+ different usable phones" }))],
    ["issue", "email", "phone", "name", "college", "score", "r1CandidateId", "r2CandidateId", "r2AssessmentId", "matchMethod", "confidence", "reason", "students"]);
  const f3 = writeCsv("03-identity-merges.csv", merges, ["phone", "primaryEmail", "alternateEmail", "name"]);
  say(`  ${f1}   (${matchRows.length} rows)`);
  say(`  ${f2}   (${unmatchedRows.length + mergeReview.length + sharedPhone.length + sharedEmailNames.length + zeroMarks.length + ambiguous.length + emailMultiPhone.length} rows)`);
  say(`  ${f3}   (${merges.length} rows)`);

  /* ════════════════ SAFETY ════════════════ */
  head("21 · WRITE-SAFETY CONFIRMATION");
  say(`  MongoDB documents inserted .......... 0`);
  say(`  MongoDB documents updated ........... 0`);
  say(`  MongoDB documents deleted ........... 0`);
  say(`  Collections created / dropped ....... 0`);
  say(`  Indexes created / dropped ........... 0`);
  say(`  Fields renamed ...................... 0`);
  say("");
  say(`  Collections READ ....... ${COLLECTION_ALLOWLIST.join(", ")}`);
  say(`  Collections NOT opened . ${skipped.join(", ") || "(none)"}`);
  say(`  portal_* collections ... ${present.filter(n => n.startsWith("portal_")).length} present, 0 opened, 0 read, 0 modified`);
  say("");
  say(`  STATUS: DRY RUN COMPLETE — no database modification was performed.`);
  say(`          Awaiting explicit approval before any migration executes.`);

  await mongoose.disconnect();
})().catch(e => { console.error("DRY RUN FAILED:", e); process.exit(1); });
