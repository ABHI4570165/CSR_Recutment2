const mongoose = require("mongoose");

/*
 * A generated AI report. The ONLY collection this feature writes to —
 * recruitment data (candidates, students, answers, scores, questions) is read
 * only. One current report per scope: regenerating replaces it rather than
 * piling up duplicates.
 */
const aiReportSchema = new mongoose.Schema({
  workspaceId: { type: mongoose.Schema.Types.ObjectId, ref: "Workspace", required: true, index: true },
  reportType:  { type: String, enum: ["COMPANY", "COLLEGE"], required: true },
  college:     { type: String, default: null },      // null for COMPANY
  model:       { type: String },
  stats:       { type: mongoose.Schema.Types.Mixed },  // the deterministic figures
  content:     { type: String, default: "" },          // the AI narrative (markdown)
  generatedBy: { type: String, default: "" },
  generatedAt: { type: Date },
  durationMs:  { type: Number },
  status:      { type: String, enum: ["OK", "FAILED"], default: "OK" },
  error:       { type: String },
}, { timestamps: true });

aiReportSchema.index({ workspaceId: 1, reportType: 1, college: 1 }, { unique: true });

module.exports = mongoose.model("AiReport", aiReportSchema);
