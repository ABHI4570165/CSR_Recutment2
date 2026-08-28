/*
 * Set the trainer paper's marking scheme so the existing `q.marks` arithmetic
 * adds up to 100 with no change to the scoring formula:
 *
 *   A  10 MCQ x 1 =  10
 *   B  10 MCQ x 1 =  10
 *   C  10 x 3     =  30
 *   D  10 x 2     =  20
 *   E  10 x 3     =  30
 *                 = 100
 *
 * Scoped to ONE workspace, because the same set exists in more than one and only
 * the trainer screening uses this scheme. Pass --workspace=<id> for another.
 *
 *   node scripts/setTrainerMarks.js [--workspace=<id>] [--dry]
 */
require("dotenv").config();
const mongoose = require("mongoose");
const Question = require("../models/Question");

const DEFAULT_WS = "6a9003330c14d3b176c2dfdb";   // Trainers Recutment
const MARKS = { tr_sec_a: 1, tr_sec_b: 1, tr_sec_c: 3, tr_sec_d: 2, tr_sec_e: 3 };

(async () => {
  if (!process.env.MONGO_URI) { console.error("MONGO_URI not set"); process.exit(1); }
  const dry = process.argv.includes("--dry");
  const arg = process.argv.find((a) => a.startsWith("--workspace="));
  const ws = arg ? arg.split("=")[1] : DEFAULT_WS;
  if (!mongoose.isValidObjectId(ws)) { console.error(`Invalid workspace id: ${ws}`); process.exit(1); }

  await mongoose.connect(process.env.MONGO_URI, { serverSelectionTimeoutMS: 15000 });
  const scope = { round: 2, set: "T", workspaceId: new mongoose.Types.ObjectId(ws) };

  let total = 0;
  for (const [section, marks] of Object.entries(MARKS)) {
    const n = await Question.countDocuments({ ...scope, section });
    if (!dry && n) await Question.updateMany({ ...scope, section }, { $set: { marks } });
    total += n * marks;
    console.log(`  ${section}  ${String(n).padStart(2)} questions x ${marks} = ${String(n * marks).padStart(3)} marks`);
  }
  console.log(`  ${"".padEnd(10)} TOTAL ${total} marks${dry ? "   (dry run — nothing written)" : ""}`);
  if (total !== 100) console.warn(`  WARNING: expected 100, got ${total} — check the question counts.`);

  await mongoose.disconnect();
})().catch((e) => { console.error(e); process.exit(1); });
