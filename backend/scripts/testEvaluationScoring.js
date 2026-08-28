/*
 * Scoring rules for the trainer paper, exercised directly against the real
 * questions in the database. Focused on the one rule everything else depends
 * on: PENDING IS NOT ZERO.
 *
 *   node scripts/testEvaluationScoring.js
 */
require("dotenv").config();
const mongoose = require("mongoose");
const { _scoreAttempt, _recomputeTotals } = require("../controllers/assessmentController");

const WS = "6a9003330c14d3b176c2dfdb";
let pass = 0, fail = 0;
const ok = (name, cond, detail = "") => {
  if (cond) { pass++; console.log(`  PASS  ${name}`); }
  else { fail++; console.log(`  FAIL  ${name}  ${detail}`); }
};

(async () => {
  await mongoose.connect(process.env.MONGO_URI, { serverSelectionTimeoutMS: 15000 });
  const Question = require("../models/Question");
  const all = await Question.find({ round: 2, set: "T", workspaceId: WS }).lean();
  const qmap = {}; all.forEach(q => { qmap[String(q._id)] = q; });
  const bySec = s => all.filter(q => q.section === s);
  const sections = ["tr_sec_a","tr_sec_b","tr_sec_c","tr_sec_d","tr_sec_e"].map(name => ({ name }));

  const a1 = bySec("tr_sec_a")[0], b1 = bySec("tr_sec_b")[0];
  const c1 = bySec("tr_sec_c")[0], e1 = bySec("tr_sec_e")[0];
  const dShort = bySec("tr_sec_d").find(q => !q.longAnswer);
  const dLong  = bySec("tr_sec_d").find(q =>  q.longAnswer);

  console.log("\n— marks —");
  ok("A question worth 1", a1.marks === 1, `got ${a1.marks}`);
  ok("C question worth 3", c1.marks === 3, `got ${c1.marks}`);
  ok("D question worth 2", dShort.marks === 2, `got ${dShort.marks}`);
  ok("E question worth 3", e1.marks === 3, `got ${e1.marks}`);
  ok("paper totals 100", all.reduce((n,q)=>n+(q.marks||1),0) === 100);

  const idOf = q => String(q._id);
  const run = (qs, answers, optionOrder = {}) =>
    _scoreAttempt(qs.map(idOf), qmap, answers, optionOrder, sections);

  console.log("\n— MCQ (tests 1-3) —");
  // optionOrder maps display index -> original index; identity keeps it simple.
  const idOrder = { [idOf(a1)]: a1.options.map((_, i) => i) };
  let r = run([a1], { [idOf(a1)]: a1.correctIndex }, idOrder);
  ok("correct MCQ scores 1", r.score === 1 && r.answerSheet[0].evalStatus === "COMPLETED");
  r = run([a1], { [idOf(a1)]: (a1.correctIndex + 1) % 4 }, idOrder);
  ok("incorrect MCQ scores 0", r.score === 0 && r.answerSheet[0].evalStatus === "COMPLETED");
  r = run([a1], {}, idOrder);
  ok("unanswered MCQ scores 0", r.score === 0 && r.pendingMarks === 0);

  console.log("\n— Section D hybrid (tests 7-9) —");
  r = run([dShort], { [idOf(dShort)]: dShort.answerText });
  ok("exact output -> 2/2 with no AI", r.score === 2 && r.answerSheet[0].evalStatus === "COMPLETED");
  r = run([dShort], { [idOf(dShort)]: "  " + String(dShort.answerText).toUpperCase() + " " });
  ok("case/space differences still match", r.score === 2);
  r = run([dShort], { [idOf(dShort)]: "totally wrong" });
  ok("non-matching output -> PENDING, not 0", r.answerSheet[0].evalStatus === "PENDING" && r.pendingMarks === 2);
  r = run([dLong], { [idOf(dLong)]: "some reasoning" });
  ok("descriptive D answer -> PENDING", r.answerSheet[0].evalStatus === "PENDING");

  console.log("\n— open sections (tests 4-6, 10-11) —");
  r = run([c1], { [idOf(c1)]: "a long considered answer" });
  ok("answered C -> PENDING worth 3", r.answerSheet[0].evalStatus === "PENDING" && r.pendingMarks === 3);
  r = run([c1], {});
  ok("unanswered C -> 0, nothing to evaluate", r.answerSheet[0].evalStatus === "COMPLETED" && r.pendingMarks === 0);
  r = run([e1], { [idOf(e1)]: "scenario answer" });
  ok("answered E -> PENDING worth 3", r.answerSheet[0].evalStatus === "PENDING" && r.pendingMarks === 3);

  console.log("\n— whole paper (tests 20-21) —");
  const paper = [...bySec("tr_sec_a"), ...bySec("tr_sec_b"), ...bySec("tr_sec_c"), ...bySec("tr_sec_d"), ...bySec("tr_sec_e")];
  const answers = {}; const order = {};
  bySec("tr_sec_a").forEach((q,i) => { order[idOf(q)] = q.options.map((_,k)=>k); answers[idOf(q)] = i < 8 ? q.correctIndex : (q.correctIndex+1)%4; });
  bySec("tr_sec_b").forEach((q,i) => { order[idOf(q)] = q.options.map((_,k)=>k); answers[idOf(q)] = i < 9 ? q.correctIndex : (q.correctIndex+1)%4; });
  [...bySec("tr_sec_c"), ...bySec("tr_sec_d"), ...bySec("tr_sec_e")].forEach(q => { answers[idOf(q)] = "written answer"; });
  r = run(paper, answers, order);
  ok("total marks are 100", r.totalMarks === 100, `got ${r.totalMarks}`);
  ok("objective score is 17 (8+9)", r.score === 17, `got ${r.score}`);
  ok("paper is PENDING, not complete", r.evaluationStatus === "PENDING");
  // 3 MCQs were answered WRONG on purpose. Those are genuinely 0 and must NOT be
  // pending — only unread answers are. So 17 scored + 80 pending + 3 wrong = 100.
  ok("80 marks pending, not zero", r.pendingMarks === 80, `got ${r.pendingMarks}`);
  ok("wrong answers are 0, not pending", r.score + r.pendingMarks === 97);
  const wrongMarks = r.answerSheet.filter(x => x.evalStatus === "COMPLETED" && !x.marks && x.given != null)
    .reduce((n, x) => n + x.maxMarks, 0);
  ok("scored + pending + wrong = 100", r.score + r.pendingMarks + wrongMarks === 100, `${r.score}+${r.pendingMarks}+${wrongMarks}`);

  console.log("\n— recompute after evaluation (test 19: no double marks) —");
  const cand = { answerSheet: r.answerSheet.map(x => ({ ...x })) };
  cand.answerSheet.filter(x => x.evalStatus === "PENDING").forEach(x => { x.marks = x.maxMarks; x.evalStatus = "COMPLETED"; });
  let t = _recomputeTotals(cand);
  // Full marks on every OPEN answer still leaves the 3 wrong MCQs at 0 -> 97.
  ok("all evaluated -> 97/100 COMPLETED", t.score === 97 && t.evaluationStatus === "COMPLETED", `got ${t.score}`);
  ok("total stays 100", t.totalMarks === 100, `got ${t.totalMarks}`);
  ok("nothing pending once evaluated", t.pendingMarks === 0, `got ${t.pendingMarks}`);
  const t2 = _recomputeTotals(cand);
  ok("recomputing again gives the same total", t2.score === t.score, `${t.score} vs ${t2.score}`);
  cand.answerSheet[0].evalStatus = "FAILED";
  ok("a FAILED row surfaces as FAILED", _recomputeTotals(cand).evaluationStatus === "FAILED");

  console.log(`\n${pass} passed, ${fail} failed`);
  await mongoose.disconnect();
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
