const router = require("express").Router();
const {
  listTriggers, listTemplates, createTemplate, updateTemplate, deleteTemplate,
  previewTemplate, testSendTemplate,
} = require("../controllers/emailTemplateController");
const { authAdmin, requireFullAdmin } = require("../middleware/auth");

// Reference data for the editor: which events can fire an email, and which
// {{placeholders}} a body may use. Served so the UI needs no hard-coded copy.
router.get   ("/meta",      authAdmin, listTriggers);

// Preview and test-send operate on the DRAFT in the editor, so they take the
// body rather than an id — the admin can check wording before ever saving.
router.post  ("/preview",   authAdmin, previewTemplate);
router.post  ("/test-send", authAdmin, requireFullAdmin, testSendTemplate);

router.get   ("/",          authAdmin, listTemplates);          // ?roundId=…
router.post  ("/",          authAdmin, requireFullAdmin, createTemplate);
router.put   ("/:id",       authAdmin, requireFullAdmin, updateTemplate);
router.delete("/:id",       authAdmin, requireFullAdmin, deleteTemplate);

module.exports = router;
