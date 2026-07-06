/*
 * One-time import of the two Technical Round DOCX sets into the Question collection
 * (round 2). Questions live in the DB so they are editable in the admin question
 * manager — nothing is hard-coded into app logic.
 *
 * Requires the docx files extracted to <repo>/.docx_tmp/A and /B (word/document.xml).
 *   node scripts/seedTechRound2.js
 */
require("dotenv").config();
const path = require("path");
const mongoose = require("mongoose");
const Question = require("../models/Question");
const { loadSet } = require("./parseTechSets");

(async () => {
  if (!process.env.MONGO_URI) { console.error("MONGO_URI not set"); process.exit(1); }
  await mongoose.connect(process.env.MONGO_URI, { serverSelectionTimeoutMS: 15000 });

  const root = path.join(__dirname, "..", "..");
  const docs = [];
  for (const [set, dir] of [["A", ".docx_tmp/A"], ["B", ".docx_tmp/B"]]) {
    const qs = loadSet(path.join(root, dir), set);
    qs.forEach((q, i) => docs.push({
      text: q.text,
      type: q.type,
      options: q.type === "mcq" ? q.options : undefined,
      correctIndex: q.type === "mcq" ? q.correctIndex : null,
      answerText: q.type === "text" ? q.answerText : null,
      marks: q.marks,
      section: q.section,        // t_sec_a | t_sec_b | t_sec_c
      order: i,                  // preserves paper order within the set
      round: 2,
      set,                       // "A" | "B"
    }));
  }

  // Idempotent: clear any previous round-2 import, then insert fresh.
  const del = await Question.deleteMany({ round: 2 });
  const inserted = await Question.insertMany(docs, { ordered: false });
  console.log(`Removed ${del.deletedCount} old round-2 questions; inserted ${inserted.length}.`);

  // Report
  const agg = await Question.aggregate([
    { $match: { round: 2 } },
    { $group: { _id: { set: "$set", section: "$section", type: "$type" }, n: { $sum: 1 }, marks: { $sum: "$marks" } } },
    { $sort: { "_id.set": 1, "_id.section": 1 } },
  ]);
  agg.forEach((a) => console.log(`  set ${a._id.set} · ${a._id.section} · ${a._id.type}: ${a.n} Qs (${a.marks} marks)`));
  await mongoose.disconnect();
})().catch((e) => { console.error(e); process.exit(1); });
