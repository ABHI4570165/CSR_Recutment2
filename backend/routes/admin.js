const router = require("express").Router();
const {
  getStats, getUsers, getUserDetail, deleteUser, getAttempts,
  getSettings, updateSettings,
  getSections, addSection, deleteSection,
  getCutoffPreview, testEmail
} = require("../controllers/adminController");
const { authAdmin, requireFullAdmin } = require("../middleware/auth");

router.get   ("/stats",           authAdmin, getStats);
router.get   ("/users",           authAdmin, getUsers);
router.get   ("/users/:id",       authAdmin, getUserDetail);
router.delete("/users/:id",       authAdmin, requireFullAdmin, deleteUser);
router.get   ("/attempts",        authAdmin, getAttempts);
router.get   ("/settings",        authAdmin, getSettings);
router.put   ("/settings",        authAdmin, requireFullAdmin, updateSettings);
router.get   ("/sections",        authAdmin, getSections);
router.post  ("/sections",        authAdmin, requireFullAdmin, addSection);
router.delete("/sections/:name",  authAdmin, requireFullAdmin, deleteSection);
router.get   ("/cutoff",          authAdmin, getCutoffPreview);
router.post  ("/test-email",      authAdmin, requireFullAdmin, testEmail);

module.exports = router;
