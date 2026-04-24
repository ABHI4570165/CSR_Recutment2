const Question  = require("../models/Question");
const { refreshCache } = require("./quizController");

// ── List questions (optionally by section) ────────────────────────────────────
exports.getQuestions = async (req, res) => {
  try {
    const filter = {};
    if (req.query.section) filter.section = req.query.section;
    const questions = await Question.find(filter).sort({ section: 1, order: 1 }).lean();
    res.json({ success: true, data: questions, total: questions.length });
  } catch (err) {
    console.error("getQuestions error:", err);
    res.status(500).json({ success: false, message: "Failed to load questions." });
  }
};

// ── Add question ──────────────────────────────────────────────────────────────
exports.addQuestion = async (req, res) => {
  try {
    const { text, options, correctIndex, marks, section } = req.body;
    if (!text || !options || options.length !== 4 || correctIndex == null || !section) {
      return res.status(400).json({ success: false, message: "text, 4 options, correctIndex and section are required." });
    }
    const q = await Question.create({ text: text.trim(), options, correctIndex, marks: marks || 1, section });
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
    const { text, options, correctIndex, marks, section } = req.body;
    const q = await Question.findByIdAndUpdate(
      req.params.id,
      { $set: { text, options, correctIndex, marks, section } },
      { new: true, runValidators: true }
    );
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
