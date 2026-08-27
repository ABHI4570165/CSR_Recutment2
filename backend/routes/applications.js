const router = require("express").Router();
const { authAdmin, requireFullAdmin } = require("../middleware/auth");
const { resolveWorkspace, loadApplication, loadParticipation } = require("../middleware/workspace");
const a = require("../controllers/applicationController");
const r = require("../controllers/roundController");

/*
 * /api/applications — the PEOPLE view. One row per candidate per drive,
 * however many rounds they have taken.
 *
 * /api/participations/:id/override — manual qualification, chain-verified from
 * the result upwards (participation → round → drive → workspace).
 */

router.use(authAdmin, resolveWorkspace);

router.get("/",                 a.listApplications);
router.get("/:applicationId",   loadApplication(), a.getApplication);

module.exports = router;

// Mounted separately at /api/participations by server.js
const participations = require("express").Router();
participations.use(authAdmin, resolveWorkspace);
participations.patch("/:id/override", requireFullAdmin, loadParticipation(), r.overrideQualification);
module.exports.participations = participations;
