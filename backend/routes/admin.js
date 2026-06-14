const router = require("express").Router();
const {
  getStats, getUsers, getUserDetail, deleteUser, getAttempts,
  getSettings, updateSettings,
  getSections, addSection, deleteSection,
  getCutoffPreview, testEmail
} = require("../controllers/adminController");
const { authAdmin } = require("../middleware/auth");

router.get   ("/stats",           authAdmin, getStats);
router.get   ("/users",           authAdmin, getUsers);
router.get   ("/users/:id",       authAdmin, getUserDetail);
router.delete("/users/:id",       authAdmin, deleteUser);
router.get   ("/attempts",        authAdmin, getAttempts);
router.get   ("/settings",        authAdmin, getSettings);
router.put   ("/settings",        authAdmin, updateSettings);
router.get   ("/sections",        authAdmin, getSections);
router.post  ("/sections",        authAdmin, addSection);
router.delete("/sections/:name",  authAdmin, deleteSection);
router.get   ("/cutoff",          authAdmin, getCutoffPreview);
router.post  ("/test-email",      authAdmin, testEmail);

module.exports = router;
