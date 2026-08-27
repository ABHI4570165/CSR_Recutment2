const router = require("express").Router();
const { authAdmin, requireFullAdmin } = require("../middleware/auth");
const { resolveWorkspace, loadRound, loadParticipation } = require("../middleware/workspace");
const r = require("../controllers/roundController");

/*
 * /api/rounds — operations on one round of one drive.
 * Identical code path whether it is round 1 or round 10.
 */

const d = require("../controllers/driveController");

router.use(authAdmin, resolveWorkspace);

// The workspace's rounds — the admin never names or sees a drive.
router.get ("/", d.listWorkspaceRounds);
router.post("/", requireFullAdmin, d.createWorkspaceRound);

router.put   ("/:roundId", requireFullAdmin, loadRound(), d.updateRound);
router.delete("/:roundId", requireFullAdmin, loadRound(), d.deleteRound);

router.get ("/:roundId/dashboard",  loadRound(), r.roundDashboard);
router.get ("/:roundId/candidates", loadRound(), r.roundCandidates);

router.post("/:roundId/assign",         requireFullAdmin, loadRound(), r.assignCandidates);
router.post("/:roundId/cutoff/preview", loadRound(), r.previewCutoff);
router.post("/:roundId/cutoff/apply",   requireFullAdmin, loadRound(), r.applyCutoff);
router.post("/:roundId/advance",        requireFullAdmin, loadRound(), r.advance);
router.post("/:roundId/results",        requireFullAdmin, loadRound(), r.recordManualResults);

module.exports = router;
