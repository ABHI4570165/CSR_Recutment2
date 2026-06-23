const router = require("express").Router();
const { validateTestCode, registerWalkIn, resumeWalkIn } = require("../controllers/walkinController");
const { walkinLimiter } = require("../middleware/rateLimit");

// Public walk-in portal endpoints (test-code based, no auth)
router.post("/validate", walkinLimiter, validateTestCode);
router.post("/register", walkinLimiter, registerWalkIn);
router.post("/resume",   walkinLimiter, resumeWalkIn);

module.exports = router;
