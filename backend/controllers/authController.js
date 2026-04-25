const jwt  = require("jsonwebtoken");
const User = require("../models/User");

// ── Student Registration ──────────────────────────────────────────────────────
exports.register = async (req, res) => {
  try {
    // DEBUG — remove after confirming fix in production
    console.log("[register] Content-Type:", req.headers["content-type"]);
    console.log("[register] req.body:", JSON.stringify(req.body));

    const { name, email, college, rollNo, phone } = req.body || {};

    // Collect every missing field so the error is specific
    const missing = [];
    if (!name    || !String(name).trim())    missing.push("name");
    if (!email   || !String(email).trim())   missing.push("email");
    if (!college || !String(college).trim()) missing.push("college");
    if (!rollNo  || !String(rollNo).trim())  missing.push("rollNo");
    if (!phone   || !String(phone).trim())   missing.push("phone");

    if (missing.length) {
      console.warn("[register] Missing fields:", missing);
      return res.status(400).json({
        success: false,
        message: `Missing required fields: ${missing.join(", ")}`,
        missing,              // sends exact field names back to frontend for debugging
        received: Object.keys(req.body || {}), // shows what the server actually got
      });
    }

    const emailLc  = String(email).toLowerCase().trim();
    const rollNorm = String(rollNo).trim().toUpperCase();

    // Check for duplicate email or roll number in one query
    const existing = await User.findOne({
      $or: [{ email: emailLc }, { rollNo: rollNorm }],
    }).lean();

    if (existing) {
      const field = existing.email === emailLc ? "email" : "roll number";
      return res.status(409).json({
        success: false,
        message: `This ${field} is already registered.`,
      });
    }

    // Create user
    const user = await User.create({
      name:    String(name).trim(),
      email:   emailLc,
      college: String(college).trim(),
      rollNo:  rollNorm,
      phone:   String(phone).trim(),
    });

    // Verify JWT_SECRET is set — fail fast with a clear message if not
    if (!process.env.JWT_SECRET) {
      console.error("[register] FATAL: JWT_SECRET is not set in environment variables");
      return res.status(500).json({
        success: false,
        message: "Server configuration error: JWT_SECRET not set. Check Render environment variables.",
      });
    }

    const token = jwt.sign(
      { id: user._id, email: user.email, name: user.name },
      process.env.JWT_SECRET,
      { expiresIn: process.env.JWT_EXPIRES_IN || "7d" }
    );

    user.quizToken = token;
    await user.save();

    console.log("[register] Success — user:", user.email);

    // Return token at BOTH response.data.token AND response.data.data.token
    // so any frontend access pattern works
    return res.status(201).json({
      success: true,
      message: "Registration successful! You can now start your quiz.",
      token,                      // top level — for simple res.data.token access
      user: {                     // top level user object
        id:      user._id,
        name:    user.name,
        email:   user.email,
        college: user.college,
        rollNo:  user.rollNo,
      },
      data: {                     // nested — for res.data.data.token access
        token,
        name:  user.name,
        email: user.email,
      },
    });
  } catch (err) {
    if (err.code === 11000) {
      const field = Object.keys(err.keyPattern || {})[0] || "field";
      return res.status(409).json({
        success: false,
        message: `This ${field} is already registered.`,
      });
    }
    console.error("[register] Unhandled error:", err);
    return res.status(500).json({
      success: false,
      message: "Registration failed. Please try again.",
    });
  }
};

// ── Admin Login ───────────────────────────────────────────────────────────────
exports.adminLogin = async (req, res) => {
  try {
    console.log("[adminLogin] req.body:", JSON.stringify(req.body));
    const { username, password } = req.body || {};

    if (!username || !password) {
      return res.status(400).json({ success: false, message: "Username and password required." });
    }
    if (username !== process.env.ADMIN_USERNAME || password !== process.env.ADMIN_PASSWORD) {
      return res.status(401).json({ success: false, message: "Invalid credentials." });
    }
    if (!process.env.ADMIN_JWT_SECRET) {
      console.error("[adminLogin] FATAL: ADMIN_JWT_SECRET not set");
      return res.status(500).json({ success: false, message: "Server config error: ADMIN_JWT_SECRET not set." });
    }
    const token = jwt.sign(
      { role: "admin", username },
      process.env.ADMIN_JWT_SECRET,
      { expiresIn: "12h" }
    );
    return res.json({ success: true, token });
  } catch (err) {
    console.error("[adminLogin] Error:", err);
    return res.status(500).json({ success: false, message: "Server error." });
  }
};

// ── Verify student token ──────────────────────────────────────────────────────
exports.verifyToken = async (req, res) => {
  try {
    const user = await User.findById(req.user.id)
      .select("name email college rollNo quizStarted quizCompleted score")
      .lean();
    if (!user) {
      return res.status(404).json({ success: false, message: "User not found." });
    }
    return res.json({ success: true, data: user });
  } catch (err) {
    console.error("[verifyToken] Error:", err);
    return res.status(500).json({ success: false, message: "Server error." });
  }
};