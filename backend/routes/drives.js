const router = require("express").Router();
const { authAdmin, requireFullAdmin } = require("../middleware/auth");
const { resolveWorkspace, loadDrive, loadRound } = require("../middleware/workspace");
const d = require("../controllers/driveController");
const a = require("../controllers/applicationController");

/*
 * /api/drives — campaigns and their DYNAMIC rounds.
 *
 * Every route resolves the active workspace first, then walks the ownership
 * chain (drive → workspace, round → drive → workspace). A drive or round id
 * from another workspace returns 404, never data.
 */

router.use(authAdmin, resolveWorkspace);

router.get   ("/",         d.listDrives);
router.post  ("/",         requireFullAdmin, d.createDrive);
router.get   ("/:driveId", loadDrive(), d.getDrive);
router.put   ("/:driveId", requireFullAdmin, loadDrive(), d.updateDrive);
router.delete("/:driveId", requireFullAdmin, loadDrive(), d.deleteDrive);

// ── Rounds: any number, admin-named, sequence-ordered ──
router.get   ("/:driveId/rounds",                 loadDrive(), d.listRounds);
router.post  ("/:driveId/rounds",                 requireFullAdmin, loadDrive(), d.createRound);
router.patch ("/:driveId/rounds/reorder",         requireFullAdmin, loadDrive(), d.reorderRounds);
router.put   ("/:driveId/rounds/:roundId",        requireFullAdmin, loadDrive(), loadRound(), d.updateRound);
router.delete("/:driveId/rounds/:roundId",        requireFullAdmin, loadDrive(), loadRound(), d.deleteRound);

// ── Candidates in a drive ──
router.post("/:driveId/candidates",      requireFullAdmin, loadDrive(), a.addCandidates);
router.get ("/:driveId/final-selection", loadDrive(), a.finalSelection);

module.exports = router;
