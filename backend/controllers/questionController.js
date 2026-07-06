const Question  = require("../models/Question");
const { refreshCache } = require("./quizController");

// ── List questions (optionally by section / round / set / type) ───────────────
exports.getQuestions = async (req, res) => {
  try {
    const filter = {};
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

// Build a validated question payload for both MCQ and text types.
function buildQuestionDoc(b) {
  const type = b.type === "text" ? "text" : "mcq";
  if (!b.text || !b.section) return { error: "Question text and section are required." };
  if (type === "mcq") {
    if (!Array.isArray(b.options) || b.options.length !== 4 || b.correctIndex == null) {
      return { error: "MCQ needs text, 4 options, correctIndex and section." };
    }
    return { doc: { text: String(b.text).trim(), type, options: b.options, correctIndex: b.correctIndex,
      answerText: null, marks: b.marks || 1, section: b.section,
      ...(b.round != null ? { round: parseInt(b.round) || 1 } : {}), ...(b.set != null ? { set: b.set || null } : {}) } };
  }
  if (!b.answerText || !String(b.answerText).trim()) return { error: "Text questions need an expected answer." };
  return { doc: { text: String(b.text).trim(), type, options: undefined, correctIndex: null,
    answerText: String(b.answerText).trim(), marks: b.marks || 1, section: b.section,
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
