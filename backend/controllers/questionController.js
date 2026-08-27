const mongoose  = require("mongoose");
const Question  = require("../models/Question");
const Assessment = require("../models/Assessment");
const QuestionPaper = require("../models/QuestionPaper");
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

// Papers now live in the QuestionPaper collection, named by the admin. These are
// used ONLY to seed a workspace that has none yet, so the sets it already holds
// are immediately selectable under a sensible name it can then rename. Nothing
// reads these once a workspace has its own papers.
const DEFAULT_PAPERS = [
  { key: "A",  name: "Version A — Aptitude",                sets: ["A", "B"] },
  { key: "B",  name: "Version B — Advanced Python/SQL/DSA", sets: ["C", "D"] },
  { key: "T1", name: "Trainer (DS/DA) — MCQ Screening",     sets: ["T"], sections: ["tr_sec_a", "tr_sec_b"] },
  { key: "T2", name: "Trainer (DS/DA) — Full Bank A–E",     sets: ["T"] },
];

const prettySection = (k) => SECTION_LABELS[k]
  || String(k).replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());

/*
 * Everything the question bank ACTUALLY holds for this workspace: which rounds
 * exist, which sets, which sections and how many questions in each.
 *
 * The admin screens used to render these filters from hard-coded lists, so one
 * workspace showed another workspace's sections (at count 0) and offered sets it
 * had never seeded. Deriving them here means a workspace shows only its own.
 *
 * Display names come from the workspace's own data first: the name the admin
 * typed for that section when configuring a drive (Assessment.sections[].
 * displayName). Only if a section has never been named does it fall back to the
 * built-in label, then to a prettified key.
 */
async function bankForScope(scope) {
  const rows = await Question.aggregate([
    { $match: scope },
    { $group: {
        _id: { round: { $ifNull: ["$round", 1] }, set: "$set", section: "$section" },
        count: { $sum: 1 },
    } },
    { $sort: { "_id.round": 1, "_id.set": 1, "_id.section": 1 } },
  ]);

  // Admin-typed section names, newest drive wins.
  const named = {};
  const drives = await Assessment.find(scope.workspaceId ? { workspaceId: scope.workspaceId } : { workspaceId: { $exists: false } })
    .select("sections createdAt").sort({ createdAt: 1 }).lean();
  drives.forEach((d) => (d.sections || []).forEach((s) => {
    if (s?.name && s?.displayName) named[s.name] = s.displayName;
  }));
  const label = (k) => named[k] || prettySection(k);

  const byRound = new Map();
  rows.forEach((r) => {
    const rd = r._id.round;
    if (!byRound.has(rd)) byRound.set(rd, { round: rd, total: 0, sets: new Map(), sections: new Map() });
    const b = byRound.get(rd);
    b.total += r.count;
    if (r._id.set) b.sets.set(r._id.set, (b.sets.get(r._id.set) || 0) + r.count);
    b.sections.set(r._id.section, (b.sections.get(r._id.section) || 0) + r.count);
  });

  return [...byRound.values()].map((b) => ({
    round: b.round,
    total: b.total,
    sets: [...b.sets.entries()].map(([name, count]) => ({ name, count })).sort((x, y) => x.name.localeCompare(y.name)),
    sections: [...b.sections.entries()].map(([name, count]) => ({ name, displayName: label(name), count })),
  })).sort((a, b) => a.round - b.round);
}

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

    // Papers are DEFINED IN THE DATABASE and named by the admin. A workspace
    // with none yet is seeded on first read from DEFAULT_PAPERS (only for the
    // sets it actually holds), so a freshly seeded set is selectable at once and
    // can then be renamed — renaming never breaks a drive, which stores `key`.
    const scope = legacyScope(req);
    let defs = await QuestionPaper.find(scope).sort({ order: 1, createdAt: 1 }).lean();
    if (!defs.length && Object.keys(bySet).length) {
      const seed = DEFAULT_PAPERS
        .filter((d) => d.sets.some((st) => bySet[st]?.length))
        .map((d, i) => ({
          ...(scope.workspaceId instanceof mongoose.Types.ObjectId ? { workspaceId: scope.workspaceId } : {}),
          key: d.key, name: d.name, order: i,
          sets: d.sets.filter((st) => bySet[st]?.length),
          sections: d.sections || [],
        }));
      // Any set no default covers still becomes a paper of its own.
      Object.keys(bySet).sort().forEach((st) => {
        if (seed.some((d) => d.sets.includes(st))) return;
        seed.push({
          ...(scope.workspaceId instanceof mongoose.Types.ObjectId ? { workspaceId: scope.workspaceId } : {}),
          key: `SET_${st}`, name: `Set ${st}`, sets: [st], sections: [], order: seed.length,
        });
      });
      if (seed.length) {
        try { await QuestionPaper.insertMany(seed, { ordered: false }); } catch { /* raced with another request */ }
        defs = await QuestionPaper.find(scope).sort({ order: 1, createdAt: 1 }).lean();
      }
    }

    const papers = [];
    defs.forEach((d) => {
      const live = (d.sets || []).filter((st) => bySet[st]?.length);
      if (!live.length) return;                  // its sets have no questions yet
      const only = (d.sections || []).length ? d.sections : null;
      const secs = sectionsFor(live, only);
      if (!secs.length) return;
      papers.push({ id: String(d._id), key: d.key, name: d.name, sets: live, sections: secs });
    });

    // Totals are per-candidate: one set's worth of questions. `name` stays the
    // admin's own text; `label` is name + the derived counts for the dropdown.
    papers.forEach((p) => {
      p.questionCount = p.sections.reduce((a, s) => a + s.questionCount, 0);
      p.marks         = p.sections.reduce((a, s) => a + s.marks, 0);
      p.manualCount   = p.sections.reduce((a, s) => a + s.longAnswer, 0);
      p.label = `${p.name} · Set ${p.sets.join(" & ")} · ${p.questionCount} Q · ${p.marks} marks`
              + (p.manualCount ? ` · ${p.manualCount} marked by hand` : " · auto-scored");
    });

    // What this workspace's bank actually holds — drives the admin filters so a
    // workspace never shows another one's rounds, sets or sections.
    const bank = await bankForScope(legacyScope(req));

    res.json({ success: true, data: { round, papers, sets: Object.keys(bySet).sort(), bank } });
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

/* ── Question papers (named, admin-editable) ──────────────────────────────────
 * A paper's NAME is the admin's own text and is what every dropdown shows.
 * `key` is the stable id an Assessment stores, so renaming a paper never
 * detaches a drive that already points at it — which is exactly why rename does
 * not touch the key.
 */
exports.listPapers = async (req, res) => {
  try {
    const papers = await QuestionPaper.find(legacyScope(req)).sort({ order: 1, createdAt: 1 }).lean();
    res.json({ success: true, data: papers });
  } catch (err) {
    console.error("listPapers error:", err);
    res.status(500).json({ success: false, message: "Failed to load question papers." });
  }
};

exports.createPaper = async (req, res) => {
  try {
    const b = req.body || {};
    const name = String(b.name || "").trim();
    const sets = Array.isArray(b.sets) ? b.sets.map((s) => String(s).trim().toUpperCase()).filter(Boolean) : [];
    if (!name)       return res.status(400).json({ success: false, message: "Give the paper a name." });
    if (!sets.length) return res.status(400).json({ success: false, message: "Choose at least one question set." });

    const scope = legacyScope(req);
    const wsId = scope.workspaceId instanceof mongoose.Types.ObjectId ? scope.workspaceId : null;
    // A key the admin never sees; derived from the name, kept unique per workspace.
    const base = (String(b.key || name).toUpperCase().replace(/[^A-Z0-9]+/g, "_").replace(/^_|_$/g, "") || "PAPER").slice(0, 32);
    let key = base;
    for (let i = 2; await QuestionPaper.exists({ ...scope, key }); i++) key = `${base}_${i}`;

    const count = await QuestionPaper.countDocuments(scope);
    const doc = await QuestionPaper.create({
      ...(wsId ? { workspaceId: wsId } : {}),
      key, name, sets,
      sections: Array.isArray(b.sections) ? b.sections.map((x) => String(x).trim()).filter(Boolean) : [],
      order: count,
    });
    res.status(201).json({ success: true, data: doc });
  } catch (err) {
    console.error("createPaper error:", err);
    res.status(500).json({ success: false, message: "Failed to create the question paper." });
  }
};

exports.updatePaper = async (req, res) => {
  try {
    const b = req.body || {};
    const update = {};
    if (b.name != null) {
      const name = String(b.name).trim();
      if (!name) return res.status(400).json({ success: false, message: "Give the paper a name." });
      update.name = name;
    }
    if (Array.isArray(b.sets)) {
      const sets = b.sets.map((s) => String(s).trim().toUpperCase()).filter(Boolean);
      if (!sets.length) return res.status(400).json({ success: false, message: "Choose at least one question set." });
      update.sets = sets;
    }
    if (Array.isArray(b.sections)) update.sections = b.sections.map((x) => String(x).trim()).filter(Boolean);
    if (b.order != null) update.order = Number(b.order) || 0;
    // `key` is deliberately NOT updatable: drives store it.

    const doc = await QuestionPaper.findOneAndUpdate(
      { _id: req.params.id, ...legacyScope(req) }, { $set: update }, { new: true, runValidators: true });
    if (!doc) return res.status(404).json({ success: false, message: "Question paper not found." });
    res.json({ success: true, data: doc });
  } catch (err) {
    console.error("updatePaper error:", err);
    res.status(500).json({ success: false, message: "Failed to update the question paper." });
  }
};

exports.deletePaper = async (req, res) => {
  try {
    const doc = await QuestionPaper.findOneAndDelete({ _id: req.params.id, ...legacyScope(req) });
    if (!doc) return res.status(404).json({ success: false, message: "Question paper not found." });
    // Questions are untouched — a paper is only a named view over them.
    res.json({ success: true, data: { deleted: doc.key } });
  } catch (err) {
    console.error("deletePaper error:", err);
    res.status(500).json({ success: false, message: "Failed to delete the question paper." });
  }
};
