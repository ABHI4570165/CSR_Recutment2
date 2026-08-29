const router = require("express").Router();
const {
  authEvaluator, leaseJobs, submitResults, health, reevaluate, runNow, queueStatus,
} = require("../controllers/evaluationController");
const { authAdmin, requireFullAdmin } = require("../middleware/auth");

/*
 * Worker endpoints. Guarded by EVALUATOR_API_KEY, deliberately NOT the admin
 * JWT: this credential sits in a file on a laptop, so it must be rotatable on
 * its own and must not grant admin access if it leaks.
 */
router.get ("/jobs",    authEvaluator, leaseJobs);
router.post("/results", authEvaluator, submitResults);

// Readable by either, so the worker can report queue depth and the dashboard
// can show it. Exposes counts only — never an answer or a rubric.
router.get ("/health", (req, res, next) => {
  if (req.get("X-Evaluator-Key")) return authEvaluator(req, res, next);
  return authAdmin(req, res, next);
}, health);

// Admin-only. "Evaluate now" and the queue badge behind it. Neither evaluates:
// the model runs on the admin's machine, which this server cannot reach. They
// unblock the queue and report its depth so the button tells the truth.
router.get ("/queue", authAdmin, queueStatus);
router.post("/run",   authAdmin, requireFullAdmin, runNow);

// Admin-only: put a candidate's AI-graded answers back in the queue.
router.post("/reevaluate", authAdmin, requireFullAdmin, reevaluate);

module.exports = router;
