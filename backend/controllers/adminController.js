const User        = require("../models/User");
const QuizAttempt = require("../models/QuizAttempt");
const QuizConfig  = require("../models/QuizConfig");
const Question    = require("../models/Question");
const { cacheGet, cacheSet, cacheDel } = require("../utils/redis");
const { refreshCache } = require("./quizController");

const STATS_TTL = 60;

// ── Dashboard Stats ────────────────────────────────────────────────────────────
exports.getStats = async (req, res) => {
  try {
    const cacheKey = "admin:stats";
    let stats = await cacheGet(cacheKey);
    if (!stats) {
      const [total, started, completed, passed] = await Promise.all([
        User.countDocuments(),
        User.countDocuments({ quizStarted: true }),
        User.countDocuments({ quizCompleted: true }),
        QuizAttempt.countDocuments({ passed: true }),
      ]);
      const avgAgg = await QuizAttempt.aggregate([
        { $match: { status: { $in: ["completed","timed-out","auto-submitted"] } } },
        { $group: { _id: null, avg: { $avg: "$score" }, max: { $max: "$score" } } },
      ]);
      stats = {
        total, started, completed, passed,
        notStarted: total - started,
        avgScore: avgAgg[0]?.avg?.toFixed(1) || 0,
        topScore:  avgAgg[0]?.max || 0,
      };
      await cacheSet(cacheKey, stats, STATS_TTL);
    }
    res.json({ success: true, data: stats });
  } catch (err) {
    console.error("getStats:", err);
    res.status(500).json({ success: false, message: "Failed to load stats." });
  }
};

// ── Users (paginated) ──────────────────────────────────────────────────────────
exports.getUsers = async (req, res) => {
  try {
    const page    = Math.max(1, parseInt(req.query.page)  || 1);
    const limit   = Math.min(500, parseInt(req.query.limit) || 15);
    const search  = (req.query.search || "").trim();
    const minScore = req.query.minScore ? parseInt(req.query.minScore) : null;
    const status   = req.query.status || "";

    const filter = {};
    if (search) {
      const re = new RegExp(search, "i");
      filter.$or = [{ name:re },{ email:re },{ rollNo:re },{ phone:re },{ college:re }];
    }
    if (minScore !== null) filter.score = { $gte: minScore };
    if (status === "completed")  { filter.quizCompleted = true; }
    if (status === "started")    { filter.quizStarted = true; filter.quizCompleted = false; }
    if (status === "notStarted") { filter.quizStarted = false; }

    const [users, total] = await Promise.all([
      User.find(filter)
        .select("name email college rollNo phone quizStarted quizCompleted score totalMarks createdAt")
        .sort({ createdAt: -1 }).skip((page-1)*limit).limit(limit).lean(),
      User.countDocuments(filter),
    ]);
    res.json({ success:true, data:users, pagination:{ page, limit, total, pages:Math.ceil(total/limit) } });
  } catch (err) {
    console.error("getUsers:", err);
    res.status(500).json({ success:false, message:"Failed to load users." });
  }
};

// ── Delete User ───────────────────────────────────────────────────────────────
// ── Get single user detail ────────────────────────────────────────────────────
exports.getUserDetail = async (req, res) => {
  try {
    const user = await User.findById(req.params.id).select("-quizToken -__v").lean();
    if (!user) return res.status(404).json({ success:false, message:"User not found." });
    const attempt = await QuizAttempt.findOne({
      userId: user._id,
      status: { $in: ["completed","timed-out","auto-submitted"] }
    }).sort({ completedAt: -1 }).select("-answers -__v").lean();
    res.json({ success:true, data:{ ...user, attempt } });
  } catch (err) {
    console.error("getUserDetail:", err);
    res.status(500).json({ success:false, message:"Server error." });
  }
};

exports.deleteUser = async (req, res) => {
  try {
    const user = await User.findByIdAndDelete(req.params.id);
    if (!user) return res.status(404).json({ success:false, message:"User not found." });
    await QuizAttempt.deleteMany({ userId: req.params.id });
    await cacheDel("admin:stats");
    res.json({ success:true, message:"User deleted." });
  } catch (err) {
    console.error("deleteUser:", err);
    res.status(500).json({ success:false, message:"Server error." });
  }
};

// ── Attempts ───────────────────────────────────────────────────────────────────
exports.getAttempts = async (req, res) => {
  try {
    const page   = Math.max(1, parseInt(req.query.page) || 1);
    const limit  = Math.min(500, parseInt(req.query.limit) || 15);
    const search = (req.query.search || "").trim();
    const status = req.query.status || "";
    const passed = req.query.passed;

    const filter = {};
    if (status) filter.status = status;
    if (passed === "true")  filter.passed = true;
    if (passed === "false") filter.passed = false;

    let pipeline = [];
    pipeline.push({ $lookup:{ from:"users", localField:"userId", foreignField:"_id", as:"user" } });
    pipeline.push({ $unwind:"$user" });
    if (search) {
      const re = new RegExp(search, "i");
      pipeline.push({ $match:{ $or:[{"user.name":re},{"user.email":re},{"user.rollNo":re}] } });
    }
    if (Object.keys(filter).length) pipeline.push({ $match:filter });
    const countPipe = [...pipeline, { $count:"total" }];
    const dataPipe  = [...pipeline,
      { $sort:{ completedAt:-1 } },
      { $skip:(page-1)*limit },
      { $limit:limit },
      { $project:{
        _id:1,score:1,totalMarks:1,passed:1,status:1,
        timeTakenSeconds:1,malpracticeCount:1,completedAt:1,sectionScores:1,
        name:"$user.name",email:"$user.email",rollNo:"$user.rollNo",college:"$user.college",
      }},
    ];
    const [countRes, attempts] = await Promise.all([
      QuizAttempt.aggregate(countPipe),
      QuizAttempt.aggregate(dataPipe),
    ]);
    const total = countRes[0]?.total || 0;
    res.json({ success:true, data:attempts, pagination:{ page, limit, total, pages:Math.ceil(total/limit) } });
  } catch (err) {
    console.error("getAttempts:", err);
    res.status(500).json({ success:false, message:"Failed to load attempts." });
  }
};

// ── Settings ───────────────────────────────────────────────────────────────────
exports.getSettings = async (req, res) => {
  try {
    let config = await QuizConfig.findOne().lean();
    if (!config) config = (await QuizConfig.create({})).toObject();
    res.json({ success:true, data:config });
  } catch (err) {
    console.error("getSettings:", err);
    res.status(500).json({ success:false, message:"Server error." });
  }
};

exports.updateSettings = async (req, res) => {
  try {
    const { timeLimitMinutes, passingScore, sections } = req.body;
    const update = {};
    if (timeLimitMinutes != null) update.timeLimitMinutes = parseInt(timeLimitMinutes);
    if (passingScore != null)     update.passingScore     = parseInt(passingScore);
    if (sections)                 update.sections         = sections;
    const config = await QuizConfig.findOneAndUpdate({}, { $set:update }, { new:true, upsert:true });
    await refreshCache();
    await cacheDel("admin:stats");
    res.json({ success:true, data:config, message:"Settings updated." });
  } catch (err) {
    console.error("updateSettings:", err);
    res.status(500).json({ success:false, message:"Server error." });
  }
};

// ── Get sections list (for question form dropdown) ─────────────────────────────
exports.getSections = async (req, res) => {
  try {
    const config = await QuizConfig.findOne().select("sections").lean();
    const sections = config?.sections || [];
    res.json({ success:true, data:sections });
  } catch (err) {
    console.error("getSections:", err);
    res.status(500).json({ success:false, message:"Server error." });
  }
};


// ── Add a new section ─────────────────────────────────────────────────────────
exports.addSection = async (req, res) => {
  try {
    const { name, displayName, questionCount, color } = req.body;
    if (!name || !displayName) {
      return res.status(400).json({ success:false, message:"name and displayName are required." });
    }
    // Normalize name to lowercase slug
    const key = name.trim().toLowerCase().replace(/[^a-z0-9_]/g, "_");
    const config = await QuizConfig.findOne();
    if (!config) return res.status(404).json({ success:false, message:"Config not found." });
    // Check duplicate
    if (config.sections.some(s => s.name === key)) {
      return res.status(409).json({ success:false, message:`Section "${key}" already exists.` });
    }
    config.sections.push({
      name: key,
      displayName: displayName.trim(),
      questionCount: parseInt(questionCount) || 20,
      color: color || "#4F46E5",
    });
    await config.save();
    const { refreshCache } = require("./quizController");
    await refreshCache();
    res.status(201).json({ success:true, data:config.sections, message:"Section added." });
  } catch (err) {
    console.error("addSection:", err);
    res.status(500).json({ success:false, message:"Server error." });
  }
};

// ── Delete a section ──────────────────────────────────────────────────────────
exports.deleteSection = async (req, res) => {
  try {
    const { name } = req.params;
    const config = await QuizConfig.findOne();
    if (!config) return res.status(404).json({ success:false, message:"Config not found." });
    const before = config.sections.length;
    config.sections = config.sections.filter(s => s.name !== name);
    if (config.sections.length === before) {
      return res.status(404).json({ success:false, message:"Section not found." });
    }
    await config.save();
    const { refreshCache } = require("./quizController");
    await refreshCache();
    res.json({ success:true, message:"Section deleted.", data:config.sections });
  } catch (err) {
    console.error("deleteSection:", err);
    res.status(500).json({ success:false, message:"Server error." });
  }
};

// ── Email diagnostics + test send (temporary admin tool) ───────────────────────
exports.testEmail = async (req, res) => {
  const { emailDiag, emailConfigured, verifyTransport, sendMail } = require("../utils/email");
  const to = (req.body?.to || "").trim();
  const diag = emailDiag();
  console.log("[testEmail] requested →", to, "| diag:", JSON.stringify(diag));
  if (!emailConfigured()) {
    return res.status(400).json({ success: false, step: "config",
      message: "Email NOT configured (EMAIL_USER/EMAIL_PASS missing in the running process). Set them and restart the backend.", diag });
  }
  const verify = await verifyTransport();
  if (!verify.ok) {
    return res.status(502).json({ success: false, step: "smtp-auth",
      message: `SMTP authentication failed: ${verify.error}`, diag, error: verify.error });
  }
  if (!to || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(to)) {
    return res.json({ success: true, step: "verify-only", smtpAuth: "ok", diag,
      message: "SMTP authentication succeeded. Provide a valid 'to' address to send a real test email." });
  }
  try {
    const messageId = await sendMail({
      to,
      subject: "MH Academy — SMTP Test ✅",
      html: `<div style="font-family:Arial;padding:20px"><h2>SMTP test successful</h2><p>If you received this, your MH Academy email pipeline is working.</p></div>`,
      text: "SMTP test successful — your MH Academy email pipeline is working.",
    });
    console.log(`[testEmail] ✔ sent to ${to} (messageId: ${messageId})`);
    res.json({ success: true, step: "sent", smtpAuth: "ok", messageId, diag, message: `Test email sent to ${to}.` });
  } catch (err) {
    console.error("[testEmail] send failed:", err.message);
    res.status(502).json({ success: false, step: "send", message: `Send failed: ${err.message}`, error: err.message, diag });
  }
};

// ── Cutoff Preview ─────────────────────────────────────────────────────────────
exports.getCutoffPreview = async (req, res) => {
  try {
    const cutoff = parseInt(req.query.cutoff);
    if (isNaN(cutoff) || cutoff < 0) {
      return res.status(400).json({ success:false, message:"Invalid cutoff value." });
    }
    const page  = Math.max(1, parseInt(req.query.page) || 1);
    const limit = Math.min(100000, parseInt(req.query.limit) || 500);
    const filter = { quizCompleted:true, score:{ $gte:cutoff } };
    const [users, total, topDoc] = await Promise.all([
      User.find(filter)
        .select("name email college rollNo phone score totalMarks createdAt")
        .sort({ score:-1 }).skip((page-1)*limit).limit(limit).lean(),
      User.countDocuments(filter),
      User.findOne({ quizCompleted:true }).sort({ score:-1 }).select("score").lean(),
    ]);
    res.json({ success:true, data:{ users, total, cutoff, topScore:topDoc?.score||0, pages:Math.ceil(total/limit), page } });
  } catch (err) {
    console.error("getCutoffPreview:", err);
    res.status(500).json({ success:false, message:"Server error." });
  }
};
