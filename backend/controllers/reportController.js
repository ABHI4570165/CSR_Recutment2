const mongoose = require("mongoose");
const Candidate = require("../models/Candidate");
const CandidateApplication = require("../models/CandidateApplication");
const Student = require("../models/Student");
const Round = require("../models/Round");
const Question = require("../models/Question");
const AiReport = require("../models/AiReport");
const ollama = require("../utils/ollama");

/* =====================================================================
 *  AI REPORTS
 *
 *  Division of labour, deliberately strict:
 *    BACKEND  → query · filter · count · calculate   (facts)
 *    OLLAMA   → interpret · explain · recommend      (analysis)
 *
 *  Ollama is never asked for a number the database can answer, which is what
 *  keeps the report honest. Generation is READ-ONLY against every recruitment
 *  collection; the only write is the AiReport document itself.
 * ===================================================================== */

const pct = (n, d) => (d ? Math.round((n / d) * 1000) / 10 : 0);

/*
 * College names are typed by students at registration, so one college arrives
 * in many spellings ("T John Institute of technology", "T. JOHN INSTITUTE OF
 * TECHNOLOGY", …). Normalising for comparison lets us present ONE row per real
 * college and analyse all of its students together — WITHOUT rewriting a single
 * candidate record. The stored values are left exactly as the students typed.
 */
const normCollege = (s) => String(s || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

/*
 * Some participations carry no college — the walk-in Technical Round did not ask
 * for it. The SAME person almost always supplied their college in an earlier
 * round, so we recover it by matching their email (then phone) against a
 * participation that does have one.
 *
 * Read-time only: nothing is written back, so the stored records stay exactly as
 * the students submitted them.
 */
const emKey = (s) => String(s || "").trim().toLowerCase();
const phKey = (s) => { const d = String(s || "").replace(/\D/g, ""); return d.length >= 10 ? d.slice(-10) : ""; };
const blankCollege = (c) => !c || !String(c).trim() || String(c).trim() === "—";

// Fills in missing colleges on a list of participations, in place on copies.
async function withResolvedColleges(workspaceId, parts) {
  if (!parts.some(p => blankCollege(p.college))) return parts;
  const donors = await Candidate.find({ workspaceId, college: { $nin: [null, "", "—"] } })
    .select("email phone college").lean();
  const byEmail = {}, byPhone = {};
  for (const d of donors) {
    const e = emKey(d.email); if (e && !byEmail[e]) byEmail[e] = d.college;
    const q = phKey(d.phone); if (q && !byPhone[q]) byPhone[q] = d.college;
  }
  return parts.map(p => {
    if (!blankCollege(p.college)) return p;
    const found = byEmail[emKey(p.email)] || byPhone[phKey(p.phone)];
    return found ? { ...p, college: found, collegeResolved: true } : p;
  });
}

// Every stored spelling of the chosen college, within this workspace only.
async function collegeVariants(workspaceId, college) {
  const all = await Candidate.distinct("college", { workspaceId });
  const key = normCollege(college);
  const hits = all.filter(c => normCollege(c) === key);
  return hits.length ? hits : [college];
}

/* ── Deterministic evidence pack ──────────────────────────────────────── */
async function buildStats(workspaceId, college = null) {
  const scope = { workspaceId };
  if (college) scope.college = college;

  const rounds = await Round.find({ workspaceId }).sort({ sequence: 1 }).lean();

  // Unique students: counted from the APPLICATION, so a person who sat five
  // rounds is one student — while every round result stays separate below.
  const variants = college ? await collegeVariants(workspaceId, college) : null;

  const partFilter = { workspaceId, isPrimary: true };
  if (variants) partFilter.college = { $in: variants };

  let parts = await Candidate.find(variants ? { workspaceId, isPrimary: true } : partFilter)
    .select("roundId roundStatus qualification score totalMarks college email phone applicationId answerSheet")
    .lean();
  parts = await withResolvedColleges(workspaceId, parts);
  if (variants) {
    const keys = new Set(variants.map(normCollege));
    parts = parts.filter(p => keys.has(normCollege(p.college)));
  }

  const appFilter = { workspaceId };
  if (variants) appFilter._id = { $in: [...new Set(parts.map(p => String(p.applicationId)))] };
  const applications = await CandidateApplication.find(appFilter).select("_id overallStatus").lean();

  const attempted = parts.filter(p => ["IN_PROGRESS", "COMPLETED", "QUALIFIED", "REJECTED"].includes(p.roundStatus));
  const completed = parts.filter(p => ["COMPLETED", "QUALIFIED", "REJECTED"].includes(p.roundStatus));

  // ── Round-wise funnel ──
  const byRound = rounds.map(r => {
    const rp = parts.filter(p => String(p.roundId) === String(r._id));
    const rc = rp.filter(p => ["COMPLETED", "QUALIFIED", "REJECTED"].includes(p.roundStatus));
    const scored = rc.filter(p => p.score != null && p.totalMarks);
    const avg = scored.length ? scored.reduce((t, p) => t + (p.score / p.totalMarks) * 100, 0) / scored.length : null;
    return {
      round: r.name, sequence: r.sequence, roundType: r.roundType,
      eligible: rp.length,
      attended: rp.filter(p => ["IN_PROGRESS", "COMPLETED", "QUALIFIED", "REJECTED"].includes(p.roundStatus)).length,
      completed: rc.length,
      qualified: rp.filter(p => p.qualification === "QUALIFIED").length,
      rejected: rp.filter(p => p.qualification === "REJECTED").length,
      notAttempted: rp.filter(p => ["NOT_STARTED", "NOT_ATTEMPTED"].includes(p.roundStatus)).length,
      averageScorePct: avg == null ? null : Math.round(avg * 10) / 10,
    };
  });

  // ── Answer-level analysis (the part that makes this more than a marks sheet) ──
  const qAgg = {};      // qid → { attempts, correct, wrong: {answer: count} }
  const secAgg = {};    // section → { attempts, correct }
  let answerRows = 0, correctRows = 0;

  for (const p of parts) {
    for (const a of (p.answerSheet || [])) {
      answerRows++;
      const q = (qAgg[a.qid] ||= { attempts: 0, correct: 0, wrong: {}, section: a.section, correctAnswer: a.correct });
      q.attempts++;
      const s = (secAgg[a.section || "unknown"] ||= { attempts: 0, correct: 0 });
      s.attempts++;
      if (a.isCorrect) { q.correct++; s.correct++; correctRows++; }
      else if (a.given != null && String(a.given).trim() !== "") {
        const key = String(a.given).slice(0, 160);
        q.wrong[key] = (q.wrong[key] || 0) + 1;
      }
    }
  }

  // Per-round section + question analysis. A round's strengths and weaknesses
  // are only meaningful against that round's own answers.
  const byRoundDetail = rounds.map(r => {
    const rp = parts.filter(p => String(p.roundId) === String(r._id));
    const sec = {}; const qs = {};
    let rows = 0, corr = 0;
    for (const p of rp) for (const a of (p.answerSheet || [])) {
      rows++;
      const S = (sec[a.section || "unknown"] ||= { attempts: 0, correct: 0 });
      S.attempts++;
      const Q = (qs[a.qid] ||= { attempts: 0, correct: 0, wrong: {}, section: a.section, correctAnswer: a.correct });
      Q.attempts++;
      if (a.isCorrect) { S.correct++; Q.correct++; corr++; }
      else if (a.given != null && String(a.given).trim() !== "") {
        const k = String(a.given).slice(0, 160); Q.wrong[k] = (Q.wrong[k] || 0) + 1;
      }
    }
    const secList = Object.entries(sec)
      .map(([section, x]) => ({ section, attempts: x.attempts, accuracyPct: pct(x.correct, x.attempts),
        studentsContributing: rp.filter(p => (p.answerSheet || []).some(a => a.section === section)).length }))
      .sort((a, b) => b.accuracyPct - a.accuracyPct);
    const scored = rp.filter(p => p.score != null && p.totalMarks);
    return {
      round: r.name, sequence: r.sequence,
      averageMarks: scored.length ? Math.round((scored.reduce((t, p) => t + p.score, 0) / scored.length) * 10) / 10 : null,
      averagePercent: scored.length ? Math.round((scored.reduce((t, p) => t + (p.score / p.totalMarks) * 100, 0) / scored.length) * 10) / 10 : null,
      answersAnalysed: rows,
      accuracyPct: pct(corr, rows),
      strongestSections: secList.slice(0, 3),
      weakestSections: secList.slice(-3).reverse(),
      allSections: secList,
      lowestAccuracyQuestions: Object.entries(qs).filter(([, q]) => q.attempts >= 5)
        .sort((a, b) => pct(a[1].correct, a[1].attempts) - pct(b[1].correct, b[1].attempts)).slice(0, 8)
        .map(([qid, q]) => {
          const w = Object.entries(q.wrong).sort((a, b) => b[1] - a[1])[0];
          return { qid, section: q.section, attempts: q.attempts, accuracyPct: pct(q.correct, q.attempts),
            correctAnswer: String(q.correctAnswer || "").slice(0, 140),
            commonestWrongAnswer: w ? w[0] : null, chosenByPct: w ? pct(w[1], q.attempts) : 0 };
        }),
    };
  });

  const sections = Object.entries(secAgg).map(([section, s]) => ({
    section, attempts: s.attempts, correct: s.correct, accuracyPct: pct(s.correct, s.attempts),
  })).sort((a, b) => a.accuracyPct - b.accuracyPct);

  // Question text is joined at read time — only for the questions we report on.
  const hardIds = Object.entries(qAgg)
    .filter(([, q]) => q.attempts >= 5)
    .sort((a, b) => pct(a[1].correct, a[1].attempts) - pct(b[1].correct, b[1].attempts))
    .slice(0, 20);
  const qDocs = await Question.find({ _id: { $in: hardIds.map(([id]) => id).filter(mongoose.isValidObjectId) } })
    .select("text section").lean();
  const qText = {}; qDocs.forEach(q => { qText[String(q._id)] = q.text; });

  const hardestQuestions = hardIds.map(([qid, q]) => {
    const topWrong = Object.entries(q.wrong).sort((a, b) => b[1] - a[1])[0];
    return {
      question: (qText[qid] || "(question text unavailable)").slice(0, 220),
      section: q.section,
      attempts: q.attempts,
      accuracyPct: pct(q.correct, q.attempts),
      correctAnswer: String(q.correctAnswer || "").slice(0, 160),
      commonestWrongAnswer: topWrong ? topWrong[0] : null,
      chosenBy: topWrong ? topWrong[1] : 0,
      chosenByPct: topWrong ? pct(topWrong[1], q.attempts) : 0,
    };
  });

  // ── College comparison (company report only — a SUMMARY, never full reports) ──
  let collegeSummary = [];
  if (!college) {
    const m = {};
    parts.forEach(p => {
      const c = (p.college || "—").trim() || "—";
      const e = (m[c] ||= { college: c, participations: 0, qualified: 0, scored: 0, sum: 0 });
      e.participations++;
      if (p.qualification === "QUALIFIED") e.qualified++;
      if (p.score != null && p.totalMarks) { e.scored++; e.sum += (p.score / p.totalMarks) * 100; }
    });
    collegeSummary = Object.values(m)
      .map(e => ({ college: e.college, participations: e.participations, qualified: e.qualified,
        averageScorePct: e.scored ? Math.round((e.sum / e.scored) * 10) / 10 : null }))
      .sort((a, b) => b.participations - a.participations).slice(0, 15);
  }

  const statuses = {};
  applications.forEach(a => { statuses[a.overallStatus] = (statuses[a.overallStatus] || 0) + 1; });

  const allQids = byRoundDetail.flatMap(r => r.lowestAccuracyQuestions.map(q => q.qid))
    .filter(mongoose.isValidObjectId);
  const moreQ = await Question.find({ _id: { $in: allQids } }).select("text").lean();
  const qMap = {}; moreQ.forEach(q => { qMap[String(q._id)] = q.text; });
  byRoundDetail.forEach(r => r.lowestAccuracyQuestions.forEach(q => {
    q.question = (qMap[q.qid] || "(question text unavailable)").slice(0, 200); delete q.qid;
  }));

  return {
    scope: college ? { type: "COLLEGE", college } : { type: "COMPANY" },
    roundAnalysis: byRoundDetail,
    uniqueStudents: applications.length,
    participations: parts.length,
    attempted: attempted.length,
    completed: completed.length,
    notAttempted: parts.length - attempted.length,
    qualified: parts.filter(p => p.qualification === "QUALIFIED").length,
    rejected: parts.filter(p => p.qualification === "REJECTED").length,
    overallStatusBreakdown: statuses,
    roundsConfigured: rounds.length,
    byRound,
    answers: {
      rowsAnalysed: answerRows,
      correct: correctRows,
      incorrect: answerRows - correctRows,
      accuracyPct: pct(correctRows, answerRows),
      questionsSeen: Object.keys(qAgg).length,
    },
    sections,
    hardestQuestions,
    collegeSummary,
    limitations: [
      "Questions carry no topic/tag field in this database; 'section' is the only concept grouping available.",
      answerRows === 0 ? "No answer-level data exists for this scope — question analysis is not possible." : null,
    ].filter(Boolean),
  };
}

/* ── Prompt ───────────────────────────────────────────────────────────── */
function buildPrompt(stats, workspaceName, college) {
  const scopeLine = college
    ? `College: ${college}\nCompany/Workspace: ${workspaceName}`
    : `Company/Workspace: ${workspaceName}`;
  const sections = college
    ? ["Executive Summary", "Student Participation", "Round-wise Performance", "Qualification Funnel",
       "Section-wise Performance", "Question Analysis", "Common Wrong Answers", "Strong Areas",
       "Weak Areas", "Student Performance Patterns", "Round Progression", "Key Findings", "Recommendations"]
    : ["Executive Summary", "Overall Performance", "Round-wise Performance (every round)",
       "Section-wise Performance per Round", "Answer Analysis", "Common Incorrect Answers",
       "Strong Areas", "Areas Requiring Improvement", "Candidate Performance Patterns",
       "College Participation Summary", "Key Findings", "Final Management Summary"];

  return `You are an assessment analyst writing a professional recruitment report for a company.

${scopeLine}

Below is VERIFIED data computed directly from the assessment database. Every number in it is already correct.

RULES — follow strictly:
- NEVER mention drives, batches, test sittings, drive names, drive counts or drive-wise statistics. This report is about STUDENTS, ROUNDS, SECTIONS and ANSWERS only. The word "drive" must not appear.
- Give ROUND-BY-ROUND analysis for EVERY round in the data: average marks, average percentage, attempted, completed, qualified, rejected, and what the numbers mean.
- For every round, name its STRONGEST and WEAKEST sections with their accuracy figures.
- Include a clear "Areas Requiring Improvement" section and a clear "Strong Areas" section, both justified by the section and answer evidence.
- Do NOT recalculate or contradict the numbers. Quote them as given.
- Do NOT invent questions, topics, colleges, candidate names or statistics that are not present below.
- Where the data does not support a conclusion, say so plainly instead of guessing.
- If a round has no participants, no answers or null averages, state only that this cohort did not take that round. Do NOT speculate about difficulty, preparation or reasons — there is no evidence for any cause.
- Separate what the data SHOWS from what you INFER. Mark inferences as such.
- Analyse the answer evidence: which questions were missed, which wrong answers were popular, and what that suggests about understanding. This must not read like a marks summary.
- Questions have no topic labels in this dataset; use the section names and question text as the only grouping. State this limitation once.
- Write in clear professional English, suitable to share with the company. Use markdown headings.

Produce exactly these sections, in this order:
${sections.map((s, i) => `${i + 1}. ${s}`).join("\n")}

VERIFIED DATA (JSON):
${JSON.stringify(stats, null, 1)}

DEPTH REQUIREMENTS — the report must be management-grade, not a summary:
- Write several substantial paragraphs per section, not one line.
- For EVERY round, state average marks, average percentage, attempted, completed, qualified, rejected and not-attempted, then INTERPRET what those figures mean for candidate quality.
- For EVERY round, list its strong sections and weak sections with their accuracy figures, and explain what each suggests about preparation.
- In Answer Analysis, work through the lowest-accuracy questions individually: quote the question, the correct answer, the wrong answer most students chose and the percentage who chose it, then explain the likely misconception that distractor reveals.
- "Areas Requiring Improvement" must name specific sections and specific question patterns, and say what training would address them.
- Finish with a Final Recommendations section a hiring manager could act on.
- Aim for a thorough report. Brevity is a failure here.

Write the full report now.`;
}

/* ── Endpoints ────────────────────────────────────────────────────────── */
exports.ollamaStatus = async (_req, res) => {
  res.json({ success: true, data: await ollama.isAvailable() });
};

exports.listReports = async (req, res) => {
  try {
    const rows = await AiReport.find({ workspaceId: req.workspaceId })
      .select("reportType college model generatedAt generatedBy durationMs status stats.uniqueStudents")
      .sort({ generatedAt: -1 }).lean();
    res.json({ success: true, data: rows });
  } catch (err) {
    console.error("listReports:", err.message);
    res.status(500).json({ success: false, message: "Failed to load reports." });
  }
};

// Colleges present in THIS workspace, with the counts the picker shows.
exports.listColleges = async (req, res) => {
  try {
    let rowsRaw = await Candidate.find({ workspaceId: req.workspaceId, isPrimary: true })
      .select("college email phone applicationId qualification roundStatus").lean();
    rowsRaw = await withResolvedColleges(req.workspaceId, rowsRaw);

    const agg = Object.values(rowsRaw.reduce((m, p) => {
      const label = blankCollege(p.college) ? "— not specified" : p.college;
      const e = (m[label] ||= { college: label, participations: 0, qualified: 0, attended: 0, apps: new Set() });
      e.participations++;
      e.apps.add(String(p.applicationId));
      if (p.qualification === "QUALIFIED") e.qualified++;
      if (["IN_PROGRESS", "COMPLETED", "QUALIFIED", "REJECTED"].includes(p.roundStatus)) e.attended++;
      return m;
    }, {})).map(e => ({ ...e, students: e.apps.size, apps: undefined }));

    const saved = await AiReport.find({ workspaceId: req.workspaceId, reportType: "COLLEGE" })
      .select("college generatedAt").lean();
    const gen = {}; saved.forEach(s => { gen[normCollege(s.college)] = s.generatedAt; });

    // Merge the spelling variants of the same college into a single row. The
    // label shown is the spelling the most students used.
    const merged = {};
    agg.forEach(c => {
      const key = normCollege(c.college);
      const e = (merged[key] ||= { college: c.college, participations: 0, qualified: 0, attended: 0, students: 0, _top: 0, variants: 0 });
      e.participations += c.participations; e.qualified += c.qualified;
      e.attended += c.attended; e.students += c.students; e.variants++;
      if (c.participations > e._top) { e._top = c.participations; e.college = c.college; }
    });
    const rows = Object.entries(merged)
      .map(([key, e]) => ({ ...e, _top: undefined, lastGenerated: gen[key] || null }))
      .sort((a, b) => b.students - a.students);
    res.json({ success: true, data: rows });
  } catch (err) {
    console.error("listColleges:", err.message);
    res.status(500).json({ success: false, message: "Failed to load colleges." });
  }
};

async function generate(req, res, college) {
  const started = Date.now();
  try {
    const status = await ollama.isAvailable();
    if (!status.ok) return res.status(503).json({ success: false, message: status.message });

    const stats = await buildStats(req.workspaceId, college);
    if (!stats.uniqueStudents) {
      return res.status(400).json({ success: false,
        message: college ? `No students from “${college}” in this workspace.` : "This workspace has no candidates to analyse yet." });
    }

    const content = await ollama.generate(buildPrompt(stats, req.workspace.name, college));
    const doc = await AiReport.findOneAndUpdate(
      { workspaceId: req.workspaceId, reportType: college ? "COLLEGE" : "COMPANY", college: college || null },
      { $set: {
        model: ollama.OLLAMA_MODEL, stats, content,
        generatedBy: req.admin?.username || "admin", generatedAt: new Date(),
        durationMs: Date.now() - started, status: "OK", error: undefined,
      } },
      { new: true, upsert: true }
    );
    res.json({ success: true, data: doc });
  } catch (err) {
    console.error("generateReport:", err.message);
    res.status(500).json({ success: false, message: `Report generation failed: ${err.message}` });
  }
}

exports.generateCompanyReport = (req, res) => generate(req, res, null);

exports.generateCollegeReport = async (req, res) => {
  const college = String(req.body?.college || "").trim();
  if (!college) return res.status(400).json({ success: false, message: "Select a college first." });
  // The college must exist INSIDE this workspace — a college name belonging to
  // another company cannot be used to reach that company's data.
  const variants = await collegeVariants(req.workspaceId, college);
  const exists = await Candidate.exists({ workspaceId: req.workspaceId, college: { $in: variants } });
  if (!exists) return res.status(404).json({ success: false, message: "That college has no candidates in this workspace." });
  return generate(req, res, college);
};

exports.getReport = async (req, res) => {
  try {
    const doc = await AiReport.findOne({
      workspaceId: req.workspaceId,
      reportType: req.query.type === "COLLEGE" ? "COLLEGE" : "COMPANY",
      college: req.query.college || null,
    }).lean();
    res.json({ success: true, data: doc || null });
  } catch (err) {
    res.status(500).json({ success: false, message: "Failed to load report." });
  }
};

exports.buildStats = buildStats;   // exported for tests
