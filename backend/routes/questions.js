const router = require("express").Router();
const { getQuestions, addQuestion, updateQuestion, deleteQuestion } = require("../controllers/questionController");
const { authAdmin } = require("../middleware/auth");

router.get   ("/",    authAdmin, getQuestions);
router.post  ("/",    authAdmin, addQuestion);
router.put   ("/:id", authAdmin, updateQuestion);
router.delete("/:id", authAdmin, deleteQuestion);

module.exports = router;
