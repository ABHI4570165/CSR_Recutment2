const mongoose = require("mongoose");

/*
 * QuestionPaper = a NAMED, selectable paper built from the question bank.
 *
 * Questions themselves live in the Question collection, tagged with a `set`
 * ("A", "B", "T"…). A paper says which of those sets a drive draws from and what
 * the admin wants that choice CALLED. Both used to be hard-coded on the server,
 * so every workspace saw the same invented names ("Version A — Aptitude") and
 * naming a paper meant editing source and redeploying.
 *
 *   Question(set:"T") ─┐
 *                      ├─ QuestionPaper { name:"Trainer Screening", sets:["T"] }
 *   Question(set:"T") ─┘
 *
 * `key` is the stable identifier an Assessment stores, so renaming a paper never
 * breaks a drive that already points at it. A workspace with no papers defined
 * still works: the catalogue derives one paper per set it finds, so a freshly
 * seeded set is selectable immediately and can be named afterwards.
 */
const questionPaperSchema = new mongoose.Schema({
  // Scoped like every other question-bank record: a workspace only ever sees
  // its own papers. Unset = the legacy pre-workspace scope.
  workspaceId: { type: mongoose.Schema.Types.ObjectId, ref: "Workspace", default: undefined, index: true },

  // Stable id stored on the Assessment. Never shown to the admin.
  key:  { type: String, required: true, trim: true },
  // What the admin types. This is what every dropdown shows.
  name: { type: String, required: true, trim: true },

  // The question sets a candidate is drawn from. More than one alternates
  // between candidates in round-robin order (the anti-copying arrangement).
  sets: { type: [String], required: true, validate: {
    validator: (v) => Array.isArray(v) && v.length > 0,
    message: "A paper must draw from at least one question set.",
  } },

  // Optional: restrict the paper to these sections. Empty = every section the
  // sets contain, which is what most papers want.
  sections: { type: [String], default: [] },

  order: { type: Number, default: 0 },
}, { timestamps: true });

// One key per workspace.
questionPaperSchema.index({ workspaceId: 1, key: 1 }, { unique: true });
questionPaperSchema.index({ workspaceId: 1, order: 1 });

module.exports = mongoose.model("QuestionPaper", questionPaperSchema);
