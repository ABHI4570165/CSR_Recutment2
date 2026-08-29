/*
 * Re-score answers the corrected matcher can now settle.
 *
 * "[1,2,3,4]" was marked unmatched against "[1, 2, 3, 4]" purely because the
 * candidate omitted a space after each comma. Those rows are still PENDING, so
 * nothing has to be undone — they are simply graded now instead of being sent to
 * a model that would have had to rediscover they were right.
 *
 * ONLY rows that are still PENDING and that the matcher now settles are touched.
 * Anything already COMPLETED is left exactly as it is: re-marking a graded answer
 * is how a total silently changes under someone.
 *
 *   node scripts/rescoreExactMatches.js [--dry]
 */
require("dotenv").config();
const mongoose = require("mongoose");
const Candidate = require("../models/Candidate");
const Question = require("../models/Question");
const { _recomputeTotals } = require("../controllers/assessmentController");

const loose = s => String(s ?? "").trim().toLowerCase().replace(/\s+/g, " ");
const tight = s => String(s ?? "").toLowerCase().replace(/\s+/g, "");
const matches = (g, e) => loose(g) === loose(e) || tight(g) === tight(e);

(async () => {
  const dry = process.argv.includes("--dry");
  await mongoose.connect(process.env.MONGO_URI, { serverSelectionTimeoutMS: 15000 });

  const cands = await Candidate.find({ "answerSheet.evalStatus": "PENDING" });
  let changed = 0, papers = 0;
  for (const c of cands) {
    let touched = false;
    for (const row of c.answerSheet || []) {
      if (row.evalStatus !== "PENDING" || !row.given) continue;
      const q = await Question.findById(row.qid).select("answerText longAnswer").lean();
      // Prose answers are graded by a reader; only short outputs have a key.
      if (!q || q.longAnswer || !q.answerText) continue;
      if (!matches(row.given, q.answerText)) continue;
      console.log(`  ${c.email}  ${JSON.stringify(row.given)} == ${JSON.stringify(q.answerText)}  -> ${row.maxMarks}/${row.maxMarks}`);
      if (!dry) {
        row.marks = row.maxMarks || 1;
        row.isCorrect = true;
        row.evalStatus = "COMPLETED";
        row.evaluatedAt = new Date();
        row.evalReason = "Exact match once whitespace is ignored.";
      }
      changed++; touched = true;
    }
    if (touched && !dry) {
      Object.assign(c, _recomputeTotals(c));
      await c.save();
      papers++;
      console.log(`     ${c.email}: now ${c.score}/${c.totalMarks}, ${c.pendingMarks} still pending (${c.evaluationStatus})`);
    }
  }
  console.log(`\n${changed} answer(s) re-scored across ${dry ? "(dry run)" : papers + " paper(s)"}`);
  await mongoose.disconnect();
})().catch(e => { console.error(e); process.exit(1); });
