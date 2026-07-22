/*
 * Seed ALL round-2 technical sets into the Question collection (editable in admin).
 *   Sets A, B  → parseTechSets   (answers inline via ✔ / "Answer:")
 *   Sets C, D  → parseTechSetsCD (separate answer-key file + SQL reference tables)
 *
 * Requires the docx extracted under <repo>/.docx_tmp/:
 *   A, B                       (word/document.xml)
 *   C_q, C_a, D_q, D_a         (question paper + answer key)
 *
 *   node scripts/seedTechRound2All.js
 */
require("dotenv").config();
const path = require("path");
const mongoose = require("mongoose");
const Question = require("../models/Question");
const { loadSet } = require("./parseTechSets");
const { loadSetCD } = require("./parseTechSetsCD");

(async () => {
  if (!process.env.MONGO_URI) { console.error("MONGO_URI not set"); process.exit(1); }
  await mongoose.connect(process.env.MONGO_URI, { serverSelectionTimeoutMS: 15000 });
  const root = path.join(__dirname, "..", "..");

  const toDoc = (q, i) => ({
    text: q.text,
    type: q.type,
    options: q.type === "mcq" ? q.options : undefined,
    correctIndex: q.type === "mcq" ? q.correctIndex : null,
    answerText: q.type === "text" ? q.answerText : null,
    reference: q.reference || null,
    marks: q.marks,
    section: q.section,          // t_sec_a | t_sec_b | t_sec_c | t_sec_d
    order: i,
    round: 2,
    set: q.set,                  // "A" | "B" | "C" | "D"
  });

  const docs = [];
  for (const set of ["A", "B"]) loadSet(path.join(root, `.docx_tmp/${set}`), set).forEach((q, i) => docs.push(toDoc(q, i)));
  for (const set of ["C", "D"]) loadSetCD(root, set).forEach((q, i) => docs.push(toDoc(q, i)));

  const del = await Question.deleteMany({ round: 2 });
  const inserted = await Question.insertMany(docs, { ordered: false });
  console.log(`Removed ${del.deletedCount} old round-2 questions; inserted ${inserted.length}.`);

  const agg = await Question.aggregate([
    { $match: { round: 2 } },
    { $group: { _id: { set: "$set", section: "$section", type: "$type" }, n: { $sum: 1 }, ref: { $sum: { $cond: [{ $ne: ["$reference", null] }, 1, 0] } } } },
    { $sort: { "_id.set": 1, "_id.section": 1 } },
  ]);
  agg.forEach((a) => console.log(`  set ${a._id.set} · ${a._id.section} · ${a._id.type}: ${a.n} Qs${a.ref ? ` (${a.ref} with ref-table)` : ""}`));
  await mongoose.disconnect();
})().catch((e) => { console.error(e); process.exit(1); });
