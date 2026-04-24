const mongoose = require("mongoose");

const attemptSchema = new mongoose.Schema({
  userId:          { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
  answers:         [{ questionId: String, selectedIndex: Number }],
  score:           { type: Number, default: 0 },
  totalMarks:      { type: Number, default: 0 },
  malpracticeCount:{ type: Number, default: 0 },
  timeTakenSeconds:{ type: Number, default: 0 },
  status:          { type: String, enum: ["in-progress","completed","timed-out","auto-submitted"], default: "in-progress" },
  startedAt:       { type: Date, default: Date.now },
  completedAt:     { type: Date },
  passed:          { type: Boolean, default: false },
  sectionScores:   { type: Map, of: Number, default: {} },
}, { timestamps: true });

attemptSchema.index({ userId: 1, status: 1 });
attemptSchema.index({ completedAt: -1 });
attemptSchema.index({ score: -1 });

module.exports = mongoose.model("QuizAttempt", attemptSchema);
