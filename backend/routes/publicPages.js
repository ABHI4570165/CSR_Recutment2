const router = require("express").Router();
const a = require("../controllers/applicationController");
const reg = require("../controllers/publicRegistrationController");
const { walkinLimiter } = require("../middleware/rateLimit");

/*
 * /api/public — unauthenticated, read-only except for self-registration.
 *
 * Both flows key off the workspace SLUG in the URL, and every lookup requires
 * the drive to belong to that workspace — so no workspace or drive id from the
 * browser can be used to reach another company's data.
 */

// Final-selection page. Only drives the admin has published are visible.
router.get("/selection/:workspaceSlug/:driveSlug", a.publicSelection);

// Workspace drive self-registration (the new walk-in flow).
router.get ("/register/:workspaceSlug/:driveSlug", reg.getRegistrationForm);
router.post("/register/:workspaceSlug/:driveSlug", walkinLimiter, reg.submitRegistration);

module.exports = router;
