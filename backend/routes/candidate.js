const router = require("express").Router();
const { getCandidate, startCandidate, saveProgress, submitCandidate } = require("../controllers/assessmentController");
const { loadCandidate } = require("../middleware/candidate");
const { candidateLimiter } = require("../middleware/rateLimit");

// Public, token-authenticated candidate flow
router.get ("/:token",        candidateLimiter, loadCandidate, getCandidate);
router.post("/:token/start",  candidateLimiter, loadCandidate, startCandidate);
router.post("/:token/save",   candidateLimiter, loadCandidate, saveProgress);
router.post("/:token/submit", candidateLimiter, loadCandidate, submitCandidate);

module.exports = router;
