const mongoose = require("mongoose");

const questionSchema = new mongoose.Schema({
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
  answerText:   { type: String, default: null },
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
