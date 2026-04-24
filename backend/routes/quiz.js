const router = require("express").Router();
const { getConfig, startQuiz, autoSave, submitQuiz } = require("../controllers/quizController");
const { authStudent } = require("../middleware/auth");
const { submitLimiter } = require("../middleware/rateLimit");

router.get ("/config",    authStudent, getConfig);
router.post("/start",     authStudent, startQuiz);
router.post("/auto-save", authStudent, autoSave);
router.post("/submit",    authStudent, submitLimiter, submitQuiz);

module.exports = router;
