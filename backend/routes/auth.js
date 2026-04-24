const router = require("express").Router();
const { register, adminLogin, verifyToken } = require("../controllers/authController");
const { authStudent } = require("../middleware/auth");
const { authLimiter } = require("../middleware/rateLimit");

router.post("/register",    authLimiter, register);
router.post("/admin/login", authLimiter, adminLogin);
router.get ("/verify",      authStudent, verifyToken);

module.exports = router;
