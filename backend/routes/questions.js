const router = require("express").Router();
const { getQuestions, getQuestionCatalog, addQuestion, updateQuestion, deleteQuestion,
        listPapers, createPaper, updatePaper, deletePaper } = require("../controllers/questionController");
const { authAdmin, requireFullAdmin } = require("../middleware/auth");

// Round-2 paper catalogue, derived from the questions actually in the DB, so a
// newly seeded set shows up in the drive-creation dropdown with no frontend change.
router.get   ("/catalog", authAdmin, getQuestionCatalog);
// Named question papers. The NAME is the admin's; `key` stays fixed so
// renaming never detaches a drive that already points at the paper.
router.get   ("/papers",     authAdmin, listPapers);
router.post  ("/papers",     authAdmin, requireFullAdmin, createPaper);
router.put   ("/papers/:id", authAdmin, requireFullAdmin, updatePaper);
router.delete("/papers/:id", authAdmin, requireFullAdmin, deletePaper);
router.get   ("/",    authAdmin, getQuestions);
router.post  ("/",    authAdmin, requireFullAdmin, addQuestion);
router.put   ("/:id", authAdmin, requireFullAdmin, updateQuestion);
router.delete("/:id", authAdmin, requireFullAdmin, deleteQuestion);

module.exports = router;
