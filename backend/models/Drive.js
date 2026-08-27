const mongoose = require("mongoose");

/*
 * Drive = one recruitment campaign inside a workspace.
 *
 *   Inference Labs Pvt Ltd
 *     ├── 2026 Campus Recruitment      ← a Drive
 *     ├── 2026 Off-Campus Recruitment  ← a Drive
 *     └── 2027 Campus Recruitment      ← a Drive
 *
 * A drive owns its rounds (see models/Round.js). A drive is created ONCE — a
 * second round NEVER means a second drive. Each drive is independent: its
 * candidates, rounds, tests, cutoffs and final selection belong to it alone.
 */

const driveSchema = new mongoose.Schema({
  workspaceId: { type: mongoose.Schema.Types.ObjectId, ref: "Workspace", required: true, index: true },

  name:        { type: String, required: true, trim: true },   // "2026 Campus Recruitment"
  description: { type: String, trim: true, default: "" },
  role:        { type: String, trim: true, default: "" },      // job role, shown on the final page
  slug:        { type: String, trim: true, index: true },      // public final-selection page key

  status: { type: String, enum: ["DRAFT", "ACTIVE", "COMPLETED", "ARCHIVED"], default: "DRAFT", index: true },

  // Drive-level window (informational; each round carries its own test schedule).
  startDate: { type: Date },
  endDate:   { type: Date },

  // Publishes the decorated final-selection page at /selection/:slug.
  publishSelection: { type: Boolean, default: false },

  // Historical compatibility ONLY. Legacy drives created before the workspace
  // architecture keep their own structure; this flags a drive that represents
  // them. New drives always leave it false.
  isHistorical: { type: Boolean, default: false },

  createdBy: { type: String, default: "" },
}, { timestamps: true });

driveSchema.index({ workspaceId: 1, status: 1, createdAt: -1 });
driveSchema.index({ workspaceId: 1, name: 1 }, { unique: true });

module.exports = mongoose.model("Drive", driveSchema);
