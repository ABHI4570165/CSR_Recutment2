const router = require("express").Router();
const { getStatus, setActiveMode, heartbeat } = require("../controllers/systemController");
const { authAdmin } = require("../middleware/auth");

router.get ("/status",       authAdmin, getStatus);
router.post("/active-mode",  authAdmin, setActiveMode);
router.post("/heartbeat",    authAdmin, heartbeat);   // keep-alive ping from the admin dashboard

module.exports = router;
