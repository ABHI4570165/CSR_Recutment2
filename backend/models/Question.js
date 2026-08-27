const mongoose = require("mongoose");

const questionSchema = new mongoose.Schema({
  // Owning workspace (added with the multi-company architecture). Optional, so
  // any question not yet linked keeps behaving exactly as before.
  workspaceId:  { type: mongoose.Schema.Types.ObjectId, ref: "Workspace", default: undefined, index: true },

  text:         { type: String, required: true, trim: true },
  // Question type: "mcq" (4 options, one correct) or "text" (typed exact-output answer).
  type:         { type: String, enum: ["mcq", "text"], default: "mcq", index: true },
  // MCQ fields — required only for mcq.
  options:      { type: [String], default: undefined,
                  validate: { validator: function (v) { return this.type !== "mcq" || (Array.isArray(v) && v.length === 4); },
                              message: "MCQ questions need exactly 4 options." } },
  correctIndex: { type: Number, min: 0, max: 3, default: null,
                  required: function () { return this.type === "mcq"; } },
  // Text-answer field — the expected exact typed answer (used when type === "text").
  // For open-ended questions this holds the model answer / evaluator rubric: it is
  // never sent to the candidate, and shows up beside the typed answer on review.
  answerText:   { type: String, default: null },
  // Typed-answer questions only. false = short exact output (single-line input,
  // auto-scored by exact match). true = essay/open-ended, so the exam renders a
  // textarea and the answer is expected to be marked by hand.
  longAnswer:   { type: Boolean, default: false },
  // Optional HTML shown ABOVE the question (e.g. SQL reference tables that every
  // question in a section shares). Rendered as-is in the exam UI.
  reference:    { type: String, default: null },
  marks:        { type: Number, default: 1, min: 1 },
  section:      { type: String, required: true, trim: true, index: true }, // no enum — supports custom sections
  order:        { type: Number, default: 0 },
  // Round + set (round 2 uses fed technical sets A/B). Round-1 pool leaves these default.
  round:        { type: Number, default: 1, index: true },
  set:          { type: String, default: null },   // "A" | "B" for round-2 sets; null otherwise
}, { timestamps: true });

questionSchema.index({ section: 1, order: 1 });
questionSchema.index({ round: 1, set: 1, section: 1 }); // round-2 paper builder

module.exports = mongoose.model("Question", questionSchema);
