const mongoose = require("mongoose");
const Candidate = require("../models/Candidate");
const Question = require("../models/Question");
const Round = require("../models/Round");
const { _recomputeTotals } = require("./assessmentController");

/*
 * The production side of the local evaluation worker.
 *
 * Production never calls the worker — localhost on a Render container is that
 * container, not anyone's laptop. The worker PULLS instead: it leases pending
 * answers, evaluates them against a local model, and posts scores back.
 *
 * Everything a client sends is treated as untrusted. The worker supplies a score
 * for ONE answer; the server decides whether that score is allowed, writes it to
 * that row alone, and RECOMPUTES the paper total from the rows. A worker can
 * never set a candidate's total, and a replayed or malicious call cannot inflate
 * one.
 */

// A lease older than this is assumed dead and the row is offered again. Long
// enough that a slow model is not interrupted, short enough that a crashed
// worker does not strand answers for an afternoon.
const LEASE_TIMEOUT_MS = parseInt(process.env.EVAL_LEASE_TIMEOUT_MS) || 10 * 60 * 1000;
const MAX_ATTEMPTS = parseInt(process.env.EVAL_MAX_ATTEMPTS) || 3;

/*
 * Shared-secret auth for the worker.
 *
 * Deliberately NOT the admin JWT: this credential lives in a file on a laptop,
 * so it must be rotatable on its own and must not grant admin access if it
 * leaks. Without EVALUATOR_API_KEY set, the endpoints stay closed rather than
 * defaulting to open — an unauthenticated write here could rewrite marks.
 */
function authEvaluator(req, res, next) {
  const expected = process.env.EVALUATOR_API_KEY;
  if (!expected) {
    return res.status(503).json({ success: false, message: "Evaluation API is not enabled on this server." });
  }
  const given = req.get("X-Evaluator-Key") || "";
  // Length-independent compare avoids leaking the key length through timing.
  const a = Buffer.from(String(given));
  const b = Buffer.from(String(expected));
  const ok = a.length === b.length && require("crypto").timingSafeEqual(a, b);
  if (!ok) return res.status(401).json({ success: false, message: "Invalid evaluator key." });
  next();
}

// Sections whose marks come from a reader rather than a key.
const isPending = (r) => r.evalStatus === "PENDING"
  || (r.evalStatus === "PROCESSING" && (!r.leasedAt || Date.now() - new Date(r.leasedAt).getTime() > LEASE_TIMEOUT_MS));

/*
 * GET /api/evaluation/jobs?limit=n
 * Leases pending answers and returns everything needed to grade them: the
 * question, the candidate's answer, the rubric and the maximum.
 */
exports.leaseJobs = async (req, res) => {
  try {
    const limit = Math.min(50, Math.max(1, parseInt(req.query.limit) || 10));
    const cands = await Candidate.find({ evaluationStatus: { $in: ["PENDING", "PROCESSING"] } })
      .sort({ completedAt: 1 }).limit(25);

    const jobs = [];
    for (const c of cands) {
      let touched = false;
      for (const row of c.answerSheet || []) {
        if (jobs.length >= limit) break;
        if (!isPending(row)) continue;
        if ((row.evalAttempts || 0) >= MAX_ATTEMPTS) {
          // Out of retries: park it for a human rather than scoring it zero.
          if (row.evalStatus !== "FAILED") { row.evalStatus = "FAILED"; touched = true; }
          continue;
        }
        const q = await Question.findById(row.qid)
          .select("text section type answerText longAnswer marks reference").lean();
        if (!q) continue;                       // question deleted — leave the row alone

        row.evalStatus = "PROCESSING";
        row.leasedAt = new Date();
        row.evalAttempts = (row.evalAttempts || 0) + 1;
        touched = true;

        jobs.push({
          candidateId: String(c._id),
          qid: String(row.qid),
          section: row.section,
          maxMarks: row.maxMarks || q.marks || 1,
          question: q.text,
          reference: q.reference || null,
          // The rubric. For open questions this is the "what to look for"
          // guidance; for output prediction it is the expected output.
          rubric: q.answerText || null,
          openEnded: !!q.longAnswer,
          answer: row.given || "",
          attempt: row.evalAttempts,
        });
      }
      if (touched) {
        Object.assign(c, _recomputeTotals(c));
        await c.save();
      }
      if (jobs.length >= limit) break;
    }
    res.json({ success: true, data: { jobs, leaseSeconds: Math.round(LEASE_TIMEOUT_MS / 1000) } });
  } catch (err) {
    console.error("leaseJobs error:", err);
    res.status(500).json({ success: false, message: "Failed to lease evaluation jobs." });
  }
};

/*
 * POST /api/evaluation/results
 * Body: { results: [{ candidateId, qid, score, reason, matched, missing, confidence, error }] }
 *
 * Each result is validated against the row's OWN maximum before it is written,
 * so a worker cannot award 5 on a 3-mark question however it was asked to.
 */
exports.submitResults = async (req, res) => {
  try {
    const results = Array.isArray(req.body?.results) ? req.body.results : [];
    if (!results.length) return res.status(400).json({ success: false, message: "No results supplied." });

    const byCandidate = {};
    results.forEach((r) => { (byCandidate[String(r.candidateId)] ||= []).push(r); });

    const accepted = [], rejected = [];
    for (const [cid, list] of Object.entries(byCandidate)) {
      if (!mongoose.isValidObjectId(cid)) { list.forEach(r => rejected.push({ qid: r.qid, reason: "bad candidateId" })); continue; }
      const c = await Candidate.findById(cid);
      if (!c) { list.forEach(r => rejected.push({ qid: r.qid, reason: "candidate not found" })); continue; }

      let touched = false;
      for (const r of list) {
        const row = (c.answerSheet || []).find(x => String(x.qid) === String(r.qid));
        if (!row) { rejected.push({ qid: r.qid, reason: "no such answer on this candidate" }); continue; }
        // Idempotency: a row already graded is never re-scored, so a retried or
        // duplicated post cannot add marks twice.
        if (row.evalStatus === "COMPLETED") { rejected.push({ qid: r.qid, reason: "already evaluated" }); continue; }

        /*
         * RELEASE — the worker could not even attempt this one, because Ollama
         * was down or the machine is shutting down. That is infrastructure, not
         * an evaluation, so the lease is handed back AND the attempt is undone.
         * Counting it would let a laptop being asleep burn through the retries
         * and park a perfectly good answer as FAILED.
         */
        if (r.release) {
          row.evalStatus = "PENDING";
          row.evalAttempts = Math.max(0, (row.evalAttempts || 1) - 1);
          row.leasedAt = undefined;
          row.evalError = r.reason ? String(r.reason).slice(0, 300) : null;
          touched = true;
          continue;                              // not a rejection: nothing was judged
        }

        if (r.error) {                          // attempted, but could not be graded
          row.evalStatus = (row.evalAttempts || 0) >= MAX_ATTEMPTS ? "FAILED" : "PENDING";
          row.evalError = String(r.error).slice(0, 300);
          row.leasedAt = undefined;
          touched = true;
          rejected.push({ qid: r.qid, reason: "worker reported an error" });
          continue;
        }

        const max = row.maxMarks || 1;
        const score = Number(r.score);
        if (!Number.isFinite(score) || score < 0 || score > max || !Number.isInteger(score)) {
          // Out-of-range means the model misbehaved: send it back for another
          // attempt rather than storing an impossible mark.
          row.evalStatus = (row.evalAttempts || 0) >= MAX_ATTEMPTS ? "FAILED" : "PENDING";
          row.evalError = `rejected score ${r.score} (allowed 0..${max})`;
          row.leasedAt = undefined;
          touched = true;
          rejected.push({ qid: r.qid, reason: `score out of range (0..${max})` });
          continue;
        }

        row.marks = score;
        row.isCorrect = score === max;
        row.evalStatus = "COMPLETED";
        row.evalReason = r.reason ? String(r.reason).slice(0, 1000) : null;
        row.matched = Array.isArray(r.matched) ? r.matched.map(String).slice(0, 20) : undefined;
        row.missing = Array.isArray(r.missing) ? r.missing.map(String).slice(0, 20) : undefined;
        row.confidence = Number.isFinite(Number(r.confidence))
          ? Math.min(1, Math.max(0, Number(r.confidence))) : null;
        row.evaluatedAt = new Date();
        row.evalError = null;
        row.leasedAt = undefined;
        touched = true;
        accepted.push({ qid: r.qid, score });
      }

      if (touched) {
        // The total is DERIVED here, never taken from the request.
        const totals = _recomputeTotals(c);
        Object.assign(c, totals);
        if (totals.evaluationStatus === "COMPLETED") {
          c.evaluatedAt = new Date();
          const a = await require("../models/Assessment").findById(c.assessmentId).select("passingScore").lean();
          c.passed = totals.score >= (a?.passingScore || 0);
        }
        await c.save();
      }
    }
    const released = results.filter(r => r.release).length;
    res.json({ success: true, data: {
      accepted: accepted.length, rejected: rejected.length, released, rejections: rejected } });
  } catch (err) {
    console.error("submitResults error:", err);
    res.status(500).json({ success: false, message: "Failed to save evaluation results." });
  }
};

// GET /api/evaluation/health — what is waiting, for the worker and for /health.
exports.health = async (_req, res) => {
  try {
    const [pending, processing, failed] = await Promise.all([
      Candidate.countDocuments({ evaluationStatus: "PENDING" }),
      Candidate.countDocuments({ evaluationStatus: "PROCESSING" }),
      Candidate.countDocuments({ evaluationStatus: "FAILED" }),
    ]);
    res.json({ success: true, data: {
      evaluatorConfigured: !!process.env.EVALUATOR_API_KEY,
      pendingCandidates: pending, processingCandidates: processing, failedCandidates: failed,
    } });
  } catch (err) {
    res.status(500).json({ success: false, message: "Health check failed." });
  }
};

/*
 * POST /api/evaluation/reevaluate  { candidateId }   (admin)
 * Returns the AI-graded rows to PENDING so the worker picks them up again.
 * The candidate's ANSWERS are never touched — only the marks are cleared.
 */
exports.reevaluate = async (req, res) => {
  try {
    const { candidateId } = req.body || {};
    if (!mongoose.isValidObjectId(candidateId)) {
      return res.status(400).json({ success: false, message: "A valid candidateId is required." });
    }
    const { legacyScope } = require("../utils/legacyScope");
    const c = await Candidate.findOne({ _id: candidateId, ...legacyScope(req) });
    if (!c) return res.status(404).json({ success: false, message: "Candidate not found in this workspace." });

    let n = 0;
    for (const row of c.answerSheet || []) {
      // Only rows a reader graded. An MCQ has a key and must not be reopened.
      const wasAiGraded = row.evalStatus === "FAILED" || row.evaluatedAt || row.evalReason;
      if (!wasAiGraded) continue;
      row.marks = 0; row.isCorrect = false;
      row.evalStatus = "PENDING"; row.evalAttempts = 0;
      row.evalError = null; row.leasedAt = undefined; row.evaluatedAt = undefined;
      n++;
    }
    if (n) { Object.assign(c, _recomputeTotals(c)); c.passed = false; await c.save(); }
    res.json({ success: true, data: { reset: n, evaluationStatus: c.evaluationStatus } });
  } catch (err) {
    console.error("reevaluate error:", err);
    res.status(500).json({ success: false, message: "Failed to queue re-evaluation." });
  }
};

exports.authEvaluator = authEvaluator;


/*
 * POST /api/evaluation/run   (admin)
 *
 * The "Evaluate now" button. It does NOT evaluate anything itself — the model
 * runs on the admin's own machine, which this server cannot reach. What it does
 * is make the queue visible and unblock anything stuck, so pressing it after
 * starting Ollama gives an honest answer instead of appearing to do nothing:
 *
 *   - rows left PROCESSING by a worker that died are returned to PENDING
 *   - rows parked FAILED are given a fresh set of attempts
 *   - the resulting queue depth is reported back
 *
 * The local worker then picks them up on its next poll, within seconds.
 */
exports.runNow = async (req, res) => {
  try {
    const { legacyScope } = require("../utils/legacyScope");
    const filter = { ...legacyScope(req), evaluationStatus: { $in: ["PENDING", "PROCESSING", "FAILED"] } };
    if (req.body?.candidateId && mongoose.isValidObjectId(req.body.candidateId)) {
      filter._id = new mongoose.Types.ObjectId(req.body.candidateId);
      delete filter.evaluationStatus;             // a named candidate is requeued whatever its state
    }
    const cands = await Candidate.find(filter);

    let requeued = 0, papers = 0, pendingAnswers = 0;
    for (const c of cands) {
      let touched = false;
      for (const row of c.answerSheet || []) {
        // A stale lease or an exhausted row is the only thing standing between a
        // running worker and this answer.
        if (row.evalStatus === "PROCESSING" || row.evalStatus === "FAILED") {
          row.evalStatus = "PENDING";
          row.evalAttempts = 0;
          row.leasedAt = undefined;
          row.evalError = null;
          requeued++; touched = true;
        }
        if (row.evalStatus === "PENDING") pendingAnswers++;
      }
      if (touched) { Object.assign(c, _recomputeTotals(c)); await c.save(); papers++; }
    }

    res.json({ success: true, data: {
      papers: cands.length, requeued, pendingAnswers,
      message: pendingAnswers
        ? `${pendingAnswers} answer(s) are queued. Start Ollama and run "npm run evaluation:worker" on your machine — it will pick them up within seconds.`
        : "Nothing is waiting to be evaluated.",
    } });
  } catch (err) {
    console.error("runNow error:", err);
    res.status(500).json({ success: false, message: "Failed to queue the evaluation." });
  }
};

// GET /api/evaluation/queue  (admin) — what is waiting, for the button's badge.
exports.queueStatus = async (req, res) => {
  try {
    const { legacyScope } = require("../utils/legacyScope");
    const scope = legacyScope(req);
    const [pending, processing, failed] = await Promise.all([
      Candidate.countDocuments({ ...scope, evaluationStatus: "PENDING" }),
      Candidate.countDocuments({ ...scope, evaluationStatus: "PROCESSING" }),
      Candidate.countDocuments({ ...scope, evaluationStatus: "FAILED" }),
    ]);
    const agg = await Candidate.aggregate([
      { $match: { ...scope, evaluationStatus: { $in: ["PENDING", "PROCESSING", "FAILED"] } } },
      { $unwind: "$answerSheet" },
      { $match: { "answerSheet.evalStatus": { $in: ["PENDING", "PROCESSING", "FAILED"] } } },
      { $group: { _id: null, answers: { $sum: 1 }, marks: { $sum: "$answerSheet.maxMarks" } } },
    ]);
    res.json({ success: true, data: {
      pending, processing, failed,
      answersWaiting: agg[0]?.answers || 0,
      marksWaiting: agg[0]?.marks || 0,
    } });
  } catch (err) {
    res.status(500).json({ success: false, message: "Failed to read the evaluation queue." });
  }
};
