const Question  = require("../models/Question");
const { refreshCache } = require("./quizController");
const { legacyScope } = require("../utils/legacyScope");

// ── List questions (optionally by section / round / set / type) ───────────────
exports.getQuestions = async (req, res) => {
  try {
    // The question bank belongs to the open workspace — another workspace's
    // questions never match this filter.
    const filter = { ...legacyScope(req) };
    if (req.query.section) filter.section = req.query.section;
    if (req.query.round)   filter.round = parseInt(req.query.round);
    if (req.query.set)     filter.set = req.query.set;
    if (req.query.type)    filter.type = req.query.type;
    const questions = await Question.find(filter).sort({ round: 1, set: 1, section: 1, order: 1 }).lean();
    res.json({ success: true, data: questions, total: questions.length });
  } catch (err) {
    console.error("getQuestions error:", err);
    res.status(500).json({ success: false, message: "Failed to load questions." });
  }
};

/* ── Round-2 paper catalogue ──────────────────────────────────────────────────
 * The drive-creation screen used to hard-code which question sets exist, so
 * seeding a new set was invisible until the frontend was rebuilt and re-uploaded.
 * This endpoint derives the catalogue from the Question collection instead:
 * sections, counts, marks and question types are all COUNTED FROM THE DB.
 *
 * Only the grouping of sets into a single paper (sets that alternate between
 * candidates) and the display labels live here — that cannot be inferred from
 * the questions themselves. Any set NOT named in PAPER_GROUPS is still returned,
 * as a paper of its own, so a newly seeded set appears in the dropdown with no
 * code change at all.
 */
const SECTION_LABELS = {
  t_sec_a: "Section A — MCQs",
  t_sec_b: "Section B — Python / Output",
  t_sec_c: "Section C — Advanced / SQL",
  t_sec_d: "Section D — DSA",
  tr_sec_a: "Section A — Data Analytics MCQs (SQL, Statistics, BI)",
  tr_sec_b: "Section B — Data Science / Machine Learning MCQs",
  tr_sec_c: "Section C — Application-Level Questions",
  tr_sec_d: "Section D — Output Prediction (Python / Pandas / SQL)",
  tr_sec_e: "Section E — Scenario-Based Questions",
};
const SECTION_COLORS = ["#4F46E5", "#7C3AED", "#0891B2", "#059669", "#D97706", "#DB2777"];

// A paper = the sets a candidate is drawn from (alternating) + optionally a
// subset of that set's sections. `key` is what the Assessment stores.
const PAPER_GROUPS = [
  { key: "A",  label: "Version A — Aptitude",                    sets: ["A", "B"] },
  { key: "B",  label: "Version B — Advanced Python/SQL/DSA",     sets: ["C", "D"] },
  { key: "T1", label: "Trainer (DS/DA) — MCQ Screening",         sets: ["T"], only: ["tr_sec_a", "tr_sec_b"] },
  { key: "T2", label: "Trainer (DS/DA) — Full Bank A–E",         sets: ["T"] },
];

const prettySection = (k) => SECTION_LABELS[k]
  || String(k).replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());

exports.getQuestionCatalog = async (req, res) => {
  try {
    const round = parseInt(req.query.round) || 2;
    const rows = await Question.aggregate([
      { $match: { ...legacyScope(req), round, set: { $ne: null } } },
      { $group: {
          _id: { set: "$set", section: "$section" },
          count:      { $sum: 1 },
          marks:      { $sum: { $ifNull: ["$marks", 1] } },
          mcq:        { $sum: { $cond: [{ $eq: ["$type", "mcq"] }, 1, 0] } },
          longAnswer: { $sum: { $cond: [{ $eq: ["$longAnswer", true] }, 1, 0] } },
      } },
      { $sort: { "_id.set": 1, "_id.section": 1 } },
    ]);

    // set -> ordered section stats
    const bySet = {};
    rows.forEach((r) => { (bySet[r._id.set] ||= []).push({
      name: r._id.section, count: r.count, marks: r.marks, mcq: r.mcq, longAnswer: r.longAnswer }); });

    const sectionsFor = (sets, only) => {
      // Union of the sections across the paper's sets, in first-seen order. Each
      // candidate sits ONE set, so the count is that set's own, not the sum.
      const seen = new Map();
      sets.forEach((st) => (bySet[st] || []).forEach((sec) => {
        if (only && !only.includes(sec.name)) return;
        const prev = seen.get(sec.name);
        // Sets in one paper mirror each other; keep the largest so a short set
        // never truncates the paper for the other one.
        if (!prev || sec.count > prev.count) seen.set(sec.name, sec);
      }));
      return [...seen.values()].map((sec, i) => ({
        name: sec.name,
        displayName: prettySection(sec.name),
        questionCount: sec.count,
        color: SECTION_COLORS[i % SECTION_COLORS.length],
        marks: sec.marks,
        autoScored: sec.mcq + (sec.count - sec.mcq - sec.longAnswer),
        longAnswer: sec.longAnswer,
      }));
    };

    const papers = [];
    const grouped = new Set();
    PAPER_GROUPS.forEach((g) => {
      const live = g.sets.filter((st) => bySet[st]?.length);
      if (!live.length) return;                   // nothing seeded for this paper yet
      live.forEach((st) => grouped.add(st));
      papers.push({ key: g.key, label: g.label, sets: live, sections: sectionsFor(live, g.only) });
    });
    // Sets nobody grouped — surfaced automatically so seeding is enough.
    Object.keys(bySet).sort().forEach((st) => {
      if (grouped.has(st)) return;
      papers.push({ key: `SET_${st}`, label: `Set ${st}`, sets: [st], sections: sectionsFor([st]) });
    });

    // Totals are per-candidate: one set's worth of questions.
    papers.forEach((p) => {
      p.questionCount = p.sections.reduce((a, s) => a + s.questionCount, 0);
      p.marks         = p.sections.reduce((a, s) => a + s.marks, 0);
      p.manualCount   = p.sections.reduce((a, s) => a + s.longAnswer, 0);
      p.label = `${p.label} · Set ${p.sets.join(" & ")} · ${p.questionCount} Q · ${p.marks} marks`
              + (p.manualCount ? ` · ${p.manualCount} marked by hand` : " · auto-scored");
    });

    res.json({ success: true, data: { round, papers, sets: Object.keys(bySet).sort() } });
  } catch (err) {
    console.error("getQuestionCatalog error:", err);
    res.status(500).json({ success: false, message: "Failed to load the question catalogue." });
  }
};

// Build a validated question payload for both MCQ and text types.
function buildQuestionDoc(b) {
  const type = b.type === "text" ? "text" : "mcq";
  if (!b.text || !b.section) return { error: "Question text and section are required." };
  if (type === "mcq") {
    if (!Array.isArray(b.options) || b.options.length !== 4 || b.correctIndex == null) {
      return { error: "MCQ needs text, 4 options, correctIndex and section." };
    }
    return { doc: { text: String(b.text).trim(), type, options: b.options, correctIndex: b.correctIndex,
      answerText: null, longAnswer: false, marks: b.marks || 1, section: b.section,
      ...(b.round != null ? { round: parseInt(b.round) || 1 } : {}), ...(b.set != null ? { set: b.set || null } : {}) } };
  }
  if (!b.answerText || !String(b.answerText).trim()) return { error: "Text questions need an expected answer." };
  return { doc: { text: String(b.text).trim(), type, options: undefined, correctIndex: null,
    answerText: String(b.answerText).trim(), longAnswer: !!b.longAnswer, marks: b.marks || 1, section: b.section,
    ...(b.reference !== undefined ? { reference: b.reference || null } : {}),
    ...(b.round != null ? { round: parseInt(b.round) || 1 } : {}), ...(b.set != null ? { set: b.set || null } : {}) } };
}

// ── Add question ──────────────────────────────────────────────────────────────
exports.addQuestion = async (req, res) => {
  try {
    const { error, doc } = buildQuestionDoc(req.body || {});
    if (error) return res.status(400).json({ success: false, message: error });
    const q = await Question.create(doc);
    await refreshCache();
    res.status(201).json({ success: true, data: q });
  } catch (err) {
    console.error("addQuestion error:", err);
    res.status(500).json({ success: false, message: "Failed to add question." });
  }
};

// ── Update question ───────────────────────────────────────────────────────────
exports.updateQuestion = async (req, res) => {
  try {
    const { error, doc } = buildQuestionDoc(req.body || {});
    if (error) return res.status(400).json({ success: false, message: error });
    const q = await Question.findByIdAndUpdate(req.params.id, { $set: doc }, { new: true, runValidators: true });
    if (!q) return res.status(404).json({ success: false, message: "Question not found." });
    await refreshCache();
    res.json({ success: true, data: q });
  } catch (err) {
    console.error("updateQuestion error:", err);
    res.status(500).json({ success: false, message: "Failed to update question." });
  }
};

// ── Delete question ───────────────────────────────────────────────────────────
exports.deleteQuestion = async (req, res) => {
  try {
    const q = await Question.findByIdAndDelete(req.params.id);
    if (!q) return res.status(404).json({ success: false, message: "Question not found." });
    await refreshCache();
    res.json({ success: true, message: "Question deleted." });
  } catch (err) {
    console.error("deleteQuestion error:", err);
    res.status(500).json({ success: false, message: "Failed to delete question." });
  }
};
