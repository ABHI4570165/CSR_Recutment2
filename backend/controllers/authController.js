const jwt   = require("jsonwebtoken");
const User  = require("../models/User");

// ── Student Registration ──────────────────────────────────────────────────────
exports.register = async (req, res) => {
  try {
    const { name, email, college, rollNo, phone } = req.body;
    if (!name || !email || !college || !rollNo || !phone) {
      return res.status(400).json({ success:false, message:"All fields are required." });
    }
    const emailLc  = email.toLowerCase().trim();
    const rollNorm = rollNo.trim().toUpperCase();

    const existing = await User.findOne({ $or:[{email:emailLc},{rollNo:rollNorm}] }).lean();
    if (existing) {
      const field = existing.email === emailLc ? "email" : "roll number";
      return res.status(409).json({ success:false, message:`This ${field} is already registered.` });
    }

    const user = await User.create({
      name: name.trim(), email: emailLc,
      college: college.trim(), rollNo: rollNorm, phone: phone.trim(),
    });

    // Generate JWT — this IS the quiz access token
    const token = jwt.sign(
      { id:user._id, email:user.email, name:user.name },
      process.env.JWT_SECRET,
      { expiresIn: process.env.JWT_EXPIRES_IN || "7d" }
    );
    user.quizToken = token;
    await user.save();

    // NO email — return token directly so frontend redirects to quiz
    return res.status(201).json({
      success: true,
      message: "Registration successful! You can now start your quiz.",
      data: { token, name:user.name, email:user.email },
    });
  } catch (err) {
    if (err.code === 11000) {
      const field = Object.keys(err.keyPattern)[0];
      return res.status(409).json({ success:false, message:`This ${field} is already registered.` });
    }
    console.error("Register error:", err);
    res.status(500).json({ success:false, message:"Registration failed. Please try again." });
  }
};

// ── Admin Login ───────────────────────────────────────────────────────────────
exports.adminLogin = async (req, res) => {
  try {
    const { username, password } = req.body;
    if (!username || !password) {
      return res.status(400).json({ success:false, message:"Username and password required." });
    }
    if (username !== process.env.ADMIN_USERNAME || password !== process.env.ADMIN_PASSWORD) {
      return res.status(401).json({ success:false, message:"Invalid credentials." });
    }
    const token = jwt.sign({ role:"admin", username }, process.env.ADMIN_JWT_SECRET, { expiresIn:"12h" });
    res.json({ success:true, token });
  } catch (err) {
    console.error("Admin login:", err);
    res.status(500).json({ success:false, message:"Server error." });
  }
};

// ── Verify student token ──────────────────────────────────────────────────────
exports.verifyToken = async (req, res) => {
  try {
    const user = await User.findById(req.user.id)
      .select("name email college rollNo quizStarted quizCompleted score").lean();
    if (!user) return res.status(404).json({ success:false, message:"User not found." });
    res.json({ success:true, data:user });
  } catch (err) {
    console.error("verifyToken:", err);
    res.status(500).json({ success:false, message:"Server error." });
  }
};
