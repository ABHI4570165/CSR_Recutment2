const User        = require("../models/User");
const Question    = require("../models/Question");
const QuizAttempt = require("../models/QuizAttempt");
const QuizConfig  = require("../models/QuizConfig");
const { cacheGet, cacheSet, cacheDel } = require("../utils/redis");

const Q_CACHE_KEY    = "quiz:questions:v2";
const CONFIG_CACHE_KEY = "quiz:config:v1";
const CACHE_TTL      = 3600; // 1 hour

// ── Get config + questions (cached) ──────────────────────────────────────────
exports.getConfig = async (req, res) => {
  try {
    let cached = await cacheGet(CONFIG_CACHE_KEY);
    if (!cached) {
      const config = await QuizConfig.findOne().lean();
      const questions = await Question.find().select("-__v").lean();
      cached = {
        timeLimitMinutes: config?.timeLimitMinutes || 40,
        passingScore:     config?.passingScore || 30,
        sections:         config?.sections || [],
        questions,
      };
      await cacheSet(CONFIG_CACHE_KEY, cached, CACHE_TTL);
    }
    res.json({ success: true, data: cached });
  } catch (err) {
    console.error("getConfig error:", err);
    res.status(500).json({ success: false, message: "Failed to load quiz config." });
  }
};

// ── Start Quiz ────────────────────────────────────────────────────────────────
exports.startQuiz = async (req, res) => {
  try {
    const userId = req.user.id;

    // Check if already completed
    const user = await User.findById(userId).lean();
    if (!user) return res.status(404).json({ success: false, message: "User not found." });

    if (user.quizCompleted) {
      const attempt = await QuizAttempt.findOne({ userId, status: { $in: ["completed","timed-out","auto-submitted"] } })
        .sort({ completedAt: -1 }).lean();
      return res.status(409).json({
        success: false,
        alreadyCompleted: true,
        score: attempt?.score || user.score,
        totalMarks: attempt?.totalMarks || user.totalMarks,
        passed: attempt?.passed,
        sectionScores: attempt?.sectionScores || {},
        message: "You have already completed this quiz.",
      });
    }

    // Check for in-progress attempt (resume)
    let attempt = await QuizAttempt.findOne({ userId, status: "in-progress" }).lean();
    if (!attempt) {
      attempt = await QuizAttempt.create({ userId, startedAt: new Date() });
      await User.findByIdAndUpdate(userId, { quizStarted: true });
    }

    res.json({ success: true, attemptId: attempt._id });
  } catch (err) {
    console.error("startQuiz error:", err);
    res.status(500).json({ success: false, message: "Failed to start quiz." });
  }
};

// ── Auto-save answers (batched, lightweight) ──────────────────────────────────
exports.autoSave = async (req, res) => {
  try {
    const { attemptId, malpracticeCount } = req.body;
    if (!attemptId) return res.json({ success: true }); // silent

    const update = {};
    if (typeof malpracticeCount === "number") update.malpracticeCount = malpracticeCount;

    if (Object.keys(update).length) {
      await QuizAttempt.findOneAndUpdate(
        { _id: attemptId, userId: req.user.id, status: "in-progress" },
        { $set: update },
        { lean: true }
      );
    }
    res.json({ success: true });
  } catch (err) {
    console.error("autoSave error:", err);
    res.json({ success: true }); // never fail auto-save
  }
};

// ── Submit Quiz ───────────────────────────────────────────────────────────────
exports.submitQuiz = async (req, res) => {
  try {
    const userId = req.user.id;
    const { attemptId, answers = [], timeTakenSeconds = 0, timedOut = false, malpracticeCount = 0 } = req.body;

    // Prevent duplicate submission
    const user = await User.findById(userId).lean();
    if (user?.quizCompleted) {
      return res.status(409).json({ success: false, message: "Quiz already submitted.", alreadyCompleted: true });
    }

    const attempt = await QuizAttempt.findOne({ _id: attemptId, userId, status: "in-progress" });
    if (!attempt) return res.status(404).json({ success: false, message: "No active quiz attempt found." });

    // Load questions from cache
    let configData = await cacheGet(CONFIG_CACHE_KEY);
    if (!configData) {
      const questions = await Question.find().lean();
      const config    = await QuizConfig.findOne().lean();
      configData = { questions, timeLimitMinutes: config?.timeLimitMinutes || 40, passingScore: config?.passingScore || 30, sections: config?.sections || [] };
    }

    const { questions, passingScore, sections } = configData;

    // Build question map for O(1) lookup
    const qMap = {};
    questions.forEach((q, i) => { qMap[String(q._id)] = q; });

    // Score calculation — O(n) single pass
    let totalScore = 0;
    let totalMarks = 0;
    const sectionScores = {};

    sections.forEach(s => { sectionScores[s.name] = 0; });

    const processedAnswers = [];
    answers.forEach(({ questionId, selectedIndex }) => {
      const q = qMap[questionId];
      if (!q) return;
      totalMarks += q.marks;
      const correct = selectedIndex === q.correctIndex;
      if (correct) {
        totalScore += q.marks;
        sectionScores[q.section] = (sectionScores[q.section] || 0) + q.marks;
      }
      processedAnswers.push({ questionId, selectedIndex });
    });

    // Total possible marks
    const totalPossible = questions.reduce((s, q) => s + (q.marks || 1), 0);
    const passed = totalScore >= (passingScore || 30);
    const status = timedOut ? "timed-out" : malpracticeCount >= 4 ? "auto-submitted" : "completed";

    // Update attempt
    attempt.answers         = processedAnswers;
    attempt.score           = totalScore;
    attempt.totalMarks      = totalPossible;
    attempt.malpracticeCount= malpracticeCount;
    attempt.timeTakenSeconds= timeTakenSeconds;
    attempt.status          = status;
    attempt.completedAt     = new Date();
    attempt.passed          = passed;
    attempt.sectionScores   = sectionScores;
    await attempt.save();

    // Update user
    await User.findByIdAndUpdate(userId, {
      quizCompleted: true,
      score: totalScore,
      totalMarks: totalPossible,
    });

    res.json({
      success: true,
      data: {
        score:         totalScore,
        totalMarks:    totalPossible,
        passingScore,
        passed,
        sectionScores,
        status,
        timeTakenSeconds,
      },
    });
  } catch (err) {
    console.error("submitQuiz error:", err);
    res.status(500).json({ success: false, message: "Submission failed. Please try again." });
  }
};

// ── Refresh cache (called after question updates) ─────────────────────────────
exports.refreshCache = async () => {
  try {
    await cacheDel(CONFIG_CACHE_KEY, Q_CACHE_KEY);
    // Pre-warm cache
    const questions = await Question.find().lean();
    const config    = await QuizConfig.findOne().lean();
    await cacheSet(CONFIG_CACHE_KEY, {
      questions,
      timeLimitMinutes: config?.timeLimitMinutes || 40,
      passingScore:     config?.passingScore || 30,
      sections:         config?.sections || [],
    }, CACHE_TTL);
    console.log("✅  Quiz cache refreshed");
  } catch (err) {
    console.error("Cache refresh error:", err);
  }
};
