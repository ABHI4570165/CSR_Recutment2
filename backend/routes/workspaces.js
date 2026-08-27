const router = require("express").Router();
const { authAdmin, requireFullAdmin } = require("../middleware/auth");
const { resolveWorkspace } = require("../middleware/workspace");
const w = require("../controllers/workspaceController");

/*
 * /api/workspaces — company management.
 *
 * The list endpoint spans workspaces (it IS the switcher) but returns only the
 * ones this admin may access. Everything else runs through resolveWorkspace,
 * which validates the X-Workspace-Id header against the admin's own set.
 */

router.get ("/",         authAdmin, w.listWorkspaces);
// LEVEL 1 — global aggregates across every workspace. Deliberately has no
// workspace context: it is the admin's home screen, not a workspace screen.
router.get ("/overview", authAdmin, w.globalOverview);
router.post("/",         authAdmin, requireFullAdmin, w.createWorkspace);

// Scoped to the active workspace (X-Workspace-Id header).
router.put ("/current",           authAdmin, requireFullAdmin, resolveWorkspace, w.updateWorkspace);
router.get ("/current/dashboard", authAdmin, resolveWorkspace, w.workspaceDashboard);

// Dynamic registration fields
router.get   ("/current/registration-fields",     authAdmin, resolveWorkspace, w.listFields);
router.post  ("/current/registration-fields",     authAdmin, requireFullAdmin, resolveWorkspace, w.createField);
router.put   ("/current/registration-fields/:id", authAdmin, requireFullAdmin, resolveWorkspace, w.updateField);
router.delete("/current/registration-fields/:id", authAdmin, requireFullAdmin, resolveWorkspace, w.deleteField);

module.exports = router;
