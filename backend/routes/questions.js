const router = require("express").Router();
const { getQuestions, getQuestionCatalog, addQuestion, updateQuestion, deleteQuestion } = require("../controllers/questionController");
const { authAdmin, requireFullAdmin } = require("../middleware/auth");

// Round-2 paper catalogue, derived from the questions actually in the DB, so a
// newly seeded set shows up in the drive-creation dropdown with no frontend change.
router.get   ("/catalog", authAdmin, getQuestionCatalog);
router.get   ("/",    authAdmin, getQuestions);
router.post  ("/",    authAdmin, requireFullAdmin, addQuestion);
router.put   ("/:id", authAdmin, requireFullAdmin, updateQuestion);
router.delete("/:id", authAdmin, requireFullAdmin, deleteQuestion);

module.exports = router;
