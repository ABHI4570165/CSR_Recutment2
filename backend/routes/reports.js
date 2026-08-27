const router = require("express").Router();
const { authAdmin, requireFullAdmin } = require("../middleware/auth");
const { resolveWorkspace } = require("../middleware/workspace");
const r = require("../controllers/reportController");

/*
 * /api/reports — workspace-scoped AI reports.
 * resolveWorkspace validates the active workspace against the admin's token, so
 * no workspaceId from a request body is ever trusted.
 */
router.use(authAdmin, resolveWorkspace);

router.get ("/",          r.listReports);      // saved reports for this workspace
router.get ("/colleges",  r.listColleges);     // colleges present in THIS workspace
router.post("/company",   requireFullAdmin, r.generateCompanyReport);
router.post("/college",   requireFullAdmin, r.generateCollegeReport);
router.get ("/status",    r.ollamaStatus);
router.get ("/one",       r.getReport);      // latest saved report for a scope

module.exports = router;
