const router = require("express").Router();
const { getQuestions, addQuestion, updateQuestion, deleteQuestion } = require("../controllers/questionController");
const { authAdmin, requireFullAdmin } = require("../middleware/auth");

router.get   ("/",    authAdmin, getQuestions);
router.post  ("/",    authAdmin, requireFullAdmin, addQuestion);
router.put   ("/:id", authAdmin, requireFullAdmin, updateQuestion);
router.delete("/:id", authAdmin, requireFullAdmin, deleteQuestion);

module.exports = router;
