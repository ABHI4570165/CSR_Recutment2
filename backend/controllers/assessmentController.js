const mongoose   = require("mongoose");
const Assessment = require("../models/Assessment");
const Candidate  = require("../models/Candidate");
const Question   = require("../models/Question");
const Counter    = require("../models/Counter");
const { generateUniqueToken } = require("../utils/tokens");
const { buildLink, queueThankYou, queueDisqualification, flushNow } = require("../utils/emailQueue");

// Generate the next global walk-in test code, e.g. MH001 (never reused).
async function nextTestCode() {
  const n = await Counter.next("testCode");
  return `MH${String(n).padStart(3, "0")}`;
}

const shuffle = (a) => {
  const b = [...a];
  for (let i = b.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [b[i], b[j]] = [b[j], b[i]];
  }
  return b;
};

const isEmail = (s) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(String(s || "").trim());
const escapeRegex = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const MAX_UPLOAD = 2000; // candidates per single upload request
const toDate = (v) => (v ? new Date(v) : undefined);

// Resolve when the assessment-LINK email should go out for a drive.
function computeLinkSendAt(a) {
  if (a.linkSendOption === "custom") return a.linkSendAt ? new Date(a.linkSendAt) : new Date();
  if (a.linkSendOption === "immediately" || !a.startAt) return new Date();
  const offsets = { "15min": 15, "30min": 30, "1hour": 60, "2hours": 120 };
  const mins = offsets[a.linkSendOption];
  if (mins == null) return new Date();
  return new Date(new Date(a.startAt).getTime() - mins * 60000);
}

const SCHED_FIELDS = ["assessmentDate", "startAt", "endAt", "linkSendOption", "linkSendAt"];

/* =====================================================================
 *  ADMIN — Assessment (drive) management
 * ===================================================================== */

exports.createAssessment = async (req, res) => {
  try {
    const { name, description, durationMinutes, passingScore, sections,
            randomizeQuestions, randomizeOptions, deadline } = req.body || {};
    if (!name || !String(name).trim()) {
      return res.status(400).json({ success: false, message: "Assessment name is required." });
    }
    const b = req.body || {};
    const driveType = b.driveType === "WALK_IN" ? "WALK_IN" : "PRE_REGISTERED";
    // Walk-in drives get a unique global test code.
    const testCode = driveType === "WALK_IN" ? await nextTestCode() : undefined;
    const doc = await Assessment.create({
      name: String(name).trim(),
      description: description || "",
      durationMinutes: parseInt(durationMinutes) || 40,
      passingScore: parseInt(passingScore) || 30,
      ...(Array.isArray(sections) && sections.length ? { sections } : {}),
      randomizeQuestions: randomizeQuestions !== false,
      randomizeOptions:   randomizeOptions   !== false,
      ...(deadline ? { deadline: new Date(deadline) } : {}),
      // Scheduling window
      ...(b.assessmentDate ? { assessmentDate: toDate(b.assessmentDate) } : {}),
      ...(b.startAt ? { startAt: toDate(b.startAt) } : {}),
      ...(b.endAt ? { endAt: toDate(b.endAt) } : {}),
      ...(b.linkSendOption ? { linkSendOption: b.linkSendOption } : {}),
      ...(b.linkSendAt ? { linkSendAt: toDate(b.linkSendAt) } : {}),
      // V3 fields
      driveType,
      ...(testCode ? { testCode } : {}),
      ...(b.status && ["DRAFT","ACTIVE","COMPLETED","ARCHIVED"].includes(b.status) ? { status: b.status } : {}),
      ...(b.college ? { college: String(b.college).trim() } : {}),
      ...(b.cutoff != null && b.cutoff !== "" ? { cutoff: parseInt(b.cutoff) } : {}),
      ...(b.maxCandidates != null && b.maxCandidates !== "" ? { maxCandidates: parseInt(b.maxCandidates) } : {}),
      ...(b.expectedCandidates != null && b.expectedCandidates !== "" ? { expectedCandidates: parseInt(b.expectedCandidates) } : {}),
      ...(b.security && typeof b.security === "object" ? { security: b.security } : {}),
    });
    res.status(201).json({ success: true, data: doc });
  } catch (err) {
    console.error("createAssessment:", err);
    res.status(500).json({ success: false, message: "Failed to create assessment." });
  }
};

exports.listAssessments = async (req, res) => {
  try {
    const list = await Assessment.find().sort({ createdAt: -1 }).lean();
    // Attach candidate counts per assessment in one grouped query
    const counts = await Candidate.aggregate([
      { $group: { _id: "$assessmentId", total: { $sum: 1 },
        completed: { $sum: { $cond: [{ $eq: ["$status", "completed"] }, 1, 0] } } } },
    ]);
    const cmap = {};
    counts.forEach(c => { cmap[String(c._id)] = c; });
    const data = list.map(a => ({
      ...a,
      candidateCount: cmap[String(a._id)]?.total || 0,
      completedCount: cmap[String(a._id)]?.completed || 0,
    }));
    res.json({ success: true, data });
  } catch (err) {
    console.error("listAssessments:", err);
    res.status(500).json({ success: false, message: "Failed to load assessments." });
  }
};

exports.getAssessment = async (req, res) => {
  try {
    const a = await Assessment.findById(req.params.id).lean();
    if (!a) return res.status(404).json({ success: false, message: "Assessment not found." });
    res.json({ success: true, data: a });
  } catch (err) {
    console.error("getAssessment:", err);
    res.status(500).json({ success: false, message: "Server error." });
  }
};

exports.updateAssessment = async (req, res) => {
  try {
    const allowed = ["name", "description", "durationMinutes", "passingScore",
      "sections", "randomizeQuestions", "randomizeOptions", "deadline", "isActive", ...SCHED_FIELDS,
      // V3 editable fields (Phase 9) — note: driveType & testCode are NOT editable after creation
      "status", "college", "cutoff", "maxCandidates", "expectedCandidates", "security"];
    const update = {};
    allowed.forEach(k => { if (req.body[k] !== undefined) update[k] = req.body[k]; });
    ["deadline", "assessmentDate", "startAt", "endAt", "linkSendAt"].forEach(k => { if (update[k]) update[k] = new Date(update[k]); });
    ["durationMinutes", "passingScore", "cutoff", "maxCandidates", "expectedCandidates"].forEach(k => {
      if (update[k] !== undefined && update[k] !== null && update[k] !== "") update[k] = parseInt(update[k]);
    });
    const a = await Assessment.findByIdAndUpdate(req.params.id, { $set: update }, { new: true });
    if (!a) return res.status(404).json({ success: false, message: "Assessment not found." });
    res.json({ success: true, data: a });
  } catch (err) {
    console.error("updateAssessment:", err);
    res.status(500).json({ success: false, message: "Server error." });
  }
};

exports.deleteAssessment = async (req, res) => {
  try {
    const count = await Candidate.countDocuments({ assessmentId: req.params.id });
    if (count > 0 && req.query.force !== "true") {
      return res.status(409).json({ success: false,
        message: `This drive has ${count} candidate(s). Pass ?force=true to delete the drive and its candidates.` });
    }
    if (req.query.force === "true") await Candidate.deleteMany({ assessmentId: req.params.id });
    const a = await Assessment.findByIdAndDelete(req.params.id);
    if (!a) return res.status(404).json({ success: false, message: "Assessment not found." });
    res.json({ success: true, message: "Assessment deleted." });
  } catch (err) {
    console.error("deleteAssessment:", err);
    res.status(500).json({ success: false, message: "Server error." });
  }
};

/* =====================================================================
 *  ADMIN — Candidate upload & scheduling
 * ===================================================================== */

// Body: { assessmentId, candidates:[{name,email,college}], scheduleAt?, expiresAt?, sendShortlist? }
// On upload: shortlist email is scheduled immediately; the assessment-LINK email
// is scheduled at the drive's configured send time (computeLinkSendAt).
// CSV/Excel are parsed to JSON client-side (xlsx) and posted through here.
exports.uploadCandidates = async (req, res) => {
  try {
    const { assessmentId, candidates, scheduleAt, expiresAt, sendShortlist } = req.body || {};
    if (!mongoose.isValidObjectId(assessmentId)) {
      return res.status(400).json({ success: false, message: "Valid assessmentId is required." });
    }
    const assessment = await Assessment.findById(assessmentId).lean();
    if (!assessment) return res.status(404).json({ success: false, message: "Assessment not found." });
    if (!Array.isArray(candidates) || !candidates.length) {
      return res.status(400).json({ success: false, message: "candidates array is required." });
    }
    if (candidates.length > MAX_UPLOAD) {
      return res.status(413).json({ success: false, message: `Too many candidates in one upload (max ${MAX_UPLOAD}). Split into smaller files.` });
    }

    // Link expiry defaults to the drive's end time (or legacy deadline); explicit override wins.
    const expiry = expiresAt ? new Date(expiresAt) : (assessment.endAt || assessment.deadline || null);
    // Link email time: explicit scheduleAt wins, else computed from the drive settings.
    const linkSendAt = scheduleAt ? new Date(scheduleAt) : computeLinkSendAt(assessment);
    const wantShortlist = sendShortlist !== false; // default ON

    const added = [];
    const skipped = [];
    const seen = new Set();

    for (const row of candidates) {
      const name    = String(row.name || "").trim();
      const email   = String(row.email || "").trim().toLowerCase();
      const college = String(row.college || "").trim();
      if (!name || !isEmail(email) || !college) { skipped.push({ row, reason: "invalid name/email/college" }); continue; }
      if (seen.has(email)) { skipped.push({ email, reason: "duplicate in upload" }); continue; }
      seen.add(email);

      const exists = await Candidate.exists({ assessmentId, email });
      if (exists) { skipped.push({ email, reason: "already invited to this drive" }); continue; }

      const token = await generateUniqueToken(Candidate);
      const doc = await Candidate.create({
        assessmentId, name, email, college, token,
        tokenExpiresAt: expiry || undefined,
        status: "invited",
        // Assessment-LINK email: scheduled at the configured send time.
        emailStatus: "scheduled",
        emailScheduledAt: linkSendAt,
        // Shortlist email: sent immediately (now).
        shortlistEmail: wantShortlist
          ? { status: "scheduled", scheduledAt: new Date() }
          : { status: "pending" },
      });
      added.push({ _id: doc._id, name, email, college, link: buildLink(token) });
    }

    // Kick the queue so shortlist (and any immediate link) emails go out now —
    // fire-and-forget so the upload response isn't blocked.
    if (added.length) setImmediate(() => flushNow(MAX_UPLOAD).catch(() => {}));

    res.status(201).json({
      success: true,
      message: `${added.length} candidate(s) added, ${skipped.length} skipped. Shortlist emails sending now; assessment links scheduled for ${new Date(linkSendAt).toLocaleString()}.`,
      added, skipped,
      addedCount: added.length, skippedCount: skipped.length,
      linkSendAt,
    });
  } catch (err) {
    console.error("uploadCandidates:", err);
    res.status(500).json({ success: false, message: "Failed to upload candidates." });
  }
};

// Schedule (or send-now) invitations. Body: { assessmentId, candidateIds?, scheduleAt?, sendNow? }
exports.scheduleEmails = async (req, res) => {
  try {
    const { assessmentId, candidateIds, scheduleAt, sendNow } = req.body || {};
    const filter = {};
    if (assessmentId) filter.assessmentId = assessmentId;
    if (Array.isArray(candidateIds) && candidateIds.length) filter._id = { $in: candidateIds };
    if (!assessmentId && !filter._id) {
      return res.status(400).json({ success: false, message: "assessmentId or candidateIds required." });
    }
    // Only (re)schedule those not already sent / sending
    filter.emailStatus = { $in: ["pending", "scheduled", "failed"] };

    const when = sendNow ? new Date() : (scheduleAt ? new Date(scheduleAt) : new Date());
    const r = await Candidate.updateMany(filter, {
      $set: { emailStatus: "scheduled", emailScheduledAt: when },
    });
    console.log(`[scheduleEmails] matched & scheduled ${r.modifiedCount} invite(s) for ${when.toISOString()} (sendNow=${!!sendNow})`);

    // Send-now → process synchronously so the admin gets real sent/failed counts.
    if (sendNow) {
      const { flushNow } = require("../utils/emailQueue");
      const { emailConfigured, verifyTransport } = require("../utils/email");
      if (!emailConfigured()) {
        return res.json({
          success: true, scheduledCount: r.modifiedCount, sentCount: 0, failedCount: 0,
          emailConfigured: false,
          message: `${r.modifiedCount} invitation(s) queued, but EMAIL is NOT configured on the server — set EMAIL_USER/EMAIL_PASS and restart the backend.`,
        });
      }
      const verify = await verifyTransport();
      if (!verify.ok) {
        return res.json({
          success: true, scheduledCount: r.modifiedCount, sentCount: 0, failedCount: 0,
          emailConfigured: true, smtpError: verify.error,
          message: `${r.modifiedCount} queued, but SMTP authentication failed: ${verify.error}`,
        });
      }
      const flush = await flushNow(200);
      return res.json({
        success: true,
        scheduledCount: r.modifiedCount,
        sentCount: flush.sent,
        failedCount: flush.failed,
        errors: flush.errors,
        emailConfigured: true,
        message: `${flush.sent} sent, ${flush.failed} failed${flush.processed < r.modifiedCount ? `, remaining queued for background delivery` : ""}.`,
      });
    }

    res.json({ success: true, message: `${r.modifiedCount} invitation(s) scheduled for ${when.toLocaleString()}.`, scheduledCount: r.modifiedCount, when });
  } catch (err) {
    console.error("scheduleEmails:", err);
    res.status(500).json({ success: false, message: "Failed to schedule emails." });
  }
};

/* =====================================================================
 *  ADMIN — Candidate listing, stats, status pipeline
 * ===================================================================== */

exports.listCandidates = async (req, res) => {
  try {
    const page   = Math.max(1, parseInt(req.query.page) || 1);
    const limit  = Math.min(500, parseInt(req.query.limit) || 20);
    const { assessmentId, college, status, search, source } = req.query;

    const filter = {};
    if (assessmentId) filter.assessmentId = assessmentId;
    if (college) filter.college = college;
    if (status) filter.status = status;
    if (source) filter.candidateSource = source;
    if (search) {
      const re = new RegExp(escapeRegex(String(search).trim()), "i");
      filter.$or = [{ name: re }, { email: re }, { college: re }];
    }

    const [rows, total] = await Promise.all([
      Candidate.find(filter)
        .select("name email college candidateSource usn phone gender dob aadhaar location status emailStatus emailScheduledAt emailSentAt shortlistEmail thankYouEmailSentAt disqualificationEmailSentAt score totalMarks passed violations submissionReason startedAt completedAt token tokenExpiresAt createdAt")
        .sort({ createdAt: -1 }).skip((page - 1) * limit).limit(limit).lean(),
      Candidate.countDocuments(filter),
    ]);
    const data = rows.map(c => ({ ...c, link: buildLink(c.token), token: undefined }));
    res.json({ success: true, data, pagination: { page, limit, total, pages: Math.ceil(total / limit) } });
  } catch (err) {
    console.error("listCandidates:", err);
    res.status(500).json({ success: false, message: "Failed to load candidates." });
  }
};

// Counters by status + by college for the drive dashboard
exports.candidateStats = async (req, res) => {
  try {
    const match = {};
    if (req.query.assessmentId) {
      if (!mongoose.isValidObjectId(req.query.assessmentId)) {
        return res.status(400).json({ success: false, message: "Invalid assessmentId." });
      }
      match.assessmentId = new mongoose.Types.ObjectId(req.query.assessmentId);
    }

    const [byStatus, byCollege, totals] = await Promise.all([
      Candidate.aggregate([{ $match: match }, { $group: { _id: "$status", n: { $sum: 1 } } }]),
      Candidate.aggregate([{ $match: match }, { $group: {
        _id: "$college",
        total: { $sum: 1 },
        completed: { $sum: { $cond: [{ $eq: ["$status", "completed"] }, 1, 0] } },
        shortlisted: { $sum: { $cond: [{ $eq: ["$status", "shortlisted"] }, 1, 0] } },
        avgScore: { $avg: "$score" },
      } }, { $sort: { total: -1 } }]),
      Candidate.aggregate([{ $match: match }, { $group: {
        _id: null, total: { $sum: 1 },
        violations: { $sum: "$violations.total" },
        shortlistEmailsSent: { $sum: { $cond: [{ $eq: ["$shortlistEmail.status", "sent"] }, 1, 0] } },
        linkEmailsSent: { $sum: { $cond: [{ $eq: ["$emailStatus", "sent"] }, 1, 0] } },
        started:   { $sum: { $cond: [{ $in: ["$status", ["started", "in-progress"]] }, 1, 0] } },
        completed: { $sum: { $cond: [{ $eq: ["$status", "completed"] }, 1, 0] } },
        disqualified: { $sum: { $cond: [{ $eq: ["$status", "disqualified"] }, 1, 0] } },
      } }]),
    ]);

    const statusCounts = {};
    Candidate.STATUSES.forEach(s => { statusCounts[s] = 0; });
    byStatus.forEach(s => { statusCounts[s._id] = s.n; });

    const t = totals[0] || {};
    res.json({ success: true, data: {
      statusCounts,
      total: t.total || 0,
      totalViolations: t.violations || 0,
      counters: {
        uploaded: t.total || 0,
        shortlistEmailsSent: t.shortlistEmailsSent || 0,
        linkEmailsSent: t.linkEmailsSent || 0,
        started: t.started || 0,
        completed: t.completed || 0,
        disqualified: t.disqualified || 0,
      },
      byCollege: byCollege.map(c => ({
        college: c._id, total: c.total, completed: c.completed,
        shortlisted: c.shortlisted, avgScore: c.avgScore ? Math.round(c.avgScore * 10) / 10 : null,
      })),
    }});
  } catch (err) {
    console.error("candidateStats:", err);
    res.status(500).json({ success: false, message: "Failed to load stats." });
  }
};

// Campus overview metrics + recent activity for the admin Dashboard tab.
exports.overviewStats = async (req, res) => {
  try {
    const [driveAgg, candAgg, selectedAgg, recentCands, recentDrives] = await Promise.all([
      Assessment.aggregate([{ $group: { _id: "$status", n: { $sum: 1 } } }]),
      Candidate.aggregate([{ $group: {
        _id: null,
        total: { $sum: 1 },
        walkIn: { $sum: { $cond: [{ $eq: ["$candidateSource", "WALK_IN"] }, 1, 0] } },
        preReg: { $sum: { $cond: [{ $ne: ["$candidateSource", "WALK_IN"] }, 1, 0] } },
        completed: { $sum: { $cond: [{ $eq: ["$status", "completed"] }, 1, 0] } },
        disqualified: { $sum: { $cond: [{ $eq: ["$status", "disqualified"] }, 1, 0] } },
        avgScore: { $avg: "$score" },
      } }]),
      // Selected = completed AND score >= the drive's cutoff (cutoff set)
      Candidate.aggregate([
        { $match: { status: "completed", score: { $ne: null } } },
        { $lookup: { from: "assessments", localField: "assessmentId", foreignField: "_id", as: "d" } },
        { $unwind: "$d" },
        { $match: { "d.cutoff": { $ne: null } , $expr: { $gte: ["$score", "$d.cutoff"] } } },
        { $count: "n" },
      ]),
      Candidate.find().sort({ updatedAt: -1 }).limit(8)
        .select("name college status candidateSource completedAt createdAt updatedAt").lean(),
      Assessment.find().sort({ createdAt: -1 }).limit(5)
        .select("name driveType status testCode createdAt").lean(),
    ]);

    const driveCounts = { DRAFT: 0, ACTIVE: 0, COMPLETED: 0, ARCHIVED: 0 };
    driveAgg.forEach(d => { if (d._id) driveCounts[d._id] = d.n; });
    const totalDrives = Object.values(driveCounts).reduce((a, b) => a + b, 0);
    const c = candAgg[0] || {};

    const activity = [
      ...recentCands.map(x => ({
        type: x.status === "completed" ? "completed" : x.status === "disqualified" ? "disqualified" : "registered",
        text: `${x.name} (${x.college}) — ${x.status}`,
        source: x.candidateSource, at: x.completedAt || x.updatedAt || x.createdAt,
      })),
      ...recentDrives.map(x => ({
        type: "drive", text: `Drive created: ${x.name}${x.testCode ? ` [${x.testCode}]` : ""}`,
        source: x.driveType, at: x.createdAt,
      })),
    ].sort((a, b) => new Date(b.at) - new Date(a.at)).slice(0, 10);

    res.json({ success: true, data: {
      drives: { total: totalDrives, active: driveCounts.ACTIVE, archived: driveCounts.ARCHIVED, draft: driveCounts.DRAFT, completed: driveCounts.COMPLETED },
      candidates: {
        total: c.total || 0, walkIn: c.walkIn || 0, preRegistered: c.preReg || 0,
        completed: c.completed || 0, disqualified: c.disqualified || 0,
        selected: selectedAgg[0]?.n || 0,
        avgScore: c.avgScore ? Math.round(c.avgScore * 10) / 10 : 0,
      },
      recentActivity: activity,
    }});
  } catch (err) {
    console.error("overviewStats:", err);
    res.status(500).json({ success: false, message: "Failed to load overview." });
  }
};

exports.listColleges = async (req, res) => {
  try {
    const filter = req.query.assessmentId ? { assessmentId: req.query.assessmentId } : {};
    const colleges = await Candidate.distinct("college", filter);
    res.json({ success: true, data: colleges.sort() });
  } catch (err) {
    console.error("listColleges:", err);
    res.status(500).json({ success: false, message: "Server error." });
  }
};

// Bulk or single status update (shortlist / reject etc.)
exports.updateCandidateStatus = async (req, res) => {
  try {
    const { candidateIds, status } = req.body || {};
    if (!Candidate.STATUSES.includes(status)) {
      return res.status(400).json({ success: false, message: "Invalid status." });
    }
    const ids = Array.isArray(candidateIds) ? candidateIds : [req.params.id].filter(Boolean);
    if (!ids.length) return res.status(400).json({ success: false, message: "candidateIds required." });
    const r = await Candidate.updateMany({ _id: { $in: ids } }, { $set: { status } });
    res.json({ success: true, message: `${r.modifiedCount} candidate(s) updated to ${status}.`, modified: r.modifiedCount });
  } catch (err) {
    console.error("updateCandidateStatus:", err);
    res.status(500).json({ success: false, message: "Server error." });
  }
};

exports.deleteCandidate = async (req, res) => {
  try {
    const c = await Candidate.findByIdAndDelete(req.params.id);
    if (!c) return res.status(404).json({ success: false, message: "Candidate not found." });
    res.json({ success: true, message: "Candidate deleted." });
  } catch (err) {
    console.error("deleteCandidate:", err);
    res.status(500).json({ success: false, message: "Server error." });
  }
};

/* =====================================================================
 *  CANDIDATE — token-based assessment flow (public, no JWT)
 *  The opaque URL token IS the credential. req.candidate is set by
 *  middleware/candidate.js after a DB lookup.
 * ===================================================================== */

function now() { return Date.now(); }

function publicCandidateView(c, assessment) {
  const s = assessment.security || {};
  return {
    name: c.name,
    college: c.college,
    assessmentName: assessment.name,
    durationMinutes: assessment.durationMinutes,
    startAt: assessment.startAt || null,
    endAt:   assessment.endAt || null,
    // Per-drive security toggles (default ON if unset) — enforced by the engine.
    security: {
      desktopOnly:           s.desktopOnly !== false,
      fullscreenEnforcement: s.fullscreenEnforcement !== false,
      cameraMonitoring:      s.cameraMonitoring !== false,
      faceVerification:      s.faceVerification !== false,
      multipleFaceDetection: s.multipleFaceDetection !== false,
      tabSwitchDetection:    s.tabSwitchDetection !== false,
      violationTracking:     s.violationTracking !== false,
    },
  };
}

// Window state helper — only enforced when the drive has startAt/endAt set.
function windowState(assessment) {
  const t = now();
  if (assessment.startAt && t < new Date(assessment.startAt).getTime()) return "not-started";
  if (assessment.endAt && t > new Date(assessment.endAt).getTime()) return "window-expired";
  return "open";
}

// Build a fresh paper (question + option order) honouring randomization flags.
async function buildPaper(assessment) {
  const sections = assessment.sections || [];
  const sectionNames = sections.map(s => s.name);
  const all = await Question.find({ section: { $in: sectionNames } }).lean();

  const bySection = {};
  all.forEach(q => { (bySection[q.section] ||= []).push(q); });

  const questionOrder = [];
  const optionOrder = {};   // qid -> [origIdx in display order]
  const clientQuestions = [];

  // NOTE: we iterate sections in their fixed configured order and shuffle the
  // pool WITHIN each section only — questions can never cross section boundaries.
  sections.forEach(sec => {
    let pool = bySection[sec.name] || [];
    pool = assessment.randomizeQuestions ? shuffle(pool) : pool.sort((a, b) => (a.order || 0) - (b.order || 0));
    pool = pool.slice(0, sec.questionCount || pool.length);
    pool.forEach(q => {
      const qid = String(q._id);
      const idxs = q.options.map((_, i) => i);
      const dispIdxs = assessment.randomizeOptions ? shuffle(idxs) : idxs;
      questionOrder.push(qid);
      optionOrder[qid] = dispIdxs;
      clientQuestions.push({
        id: qid,
        section: q.section,
        sectionLabel: sec.displayName || sec.name,
        text: q.text,
        options: dispIdxs.map(oi => q.options[oi]), // display order, no correctIndex leaked
      });
    });
  });

  return { questionOrder, optionOrder, clientQuestions };
}

// Rebuild client questions from a stored paper (for resume).
async function rehydratePaper(progress, assessment) {
  const ids = progress.questionOrder || [];
  const docs = await Question.find({ _id: { $in: ids } }).lean();
  const map = {};
  docs.forEach(q => { map[String(q._id)] = q; });
  const labelMap = {};
  (assessment?.sections || []).forEach(s => { labelMap[s.name] = s.displayName || s.name; });
  const optionOrder = progress.optionOrder instanceof Map
    ? Object.fromEntries(progress.optionOrder) : (progress.optionOrder || {});
  const clientQuestions = [];
  ids.forEach(qid => {
    const q = map[qid];
    if (!q) return;
    const dispIdxs = optionOrder[qid] || q.options.map((_, i) => i);
    clientQuestions.push({
      id: qid, section: q.section, sectionLabel: labelMap[q.section] || q.section,
      text: q.text, options: dispIdxs.map(oi => q.options[oi]),
    });
  });
  return clientQuestions;
}

function remainingSeconds(candidate, assessment) {
  if (!candidate.startedAt) return assessment.durationMinutes * 60;
  const elapsed = Math.floor((now() - new Date(candidate.startedAt).getTime()) / 1000);
  return Math.max(0, assessment.durationMinutes * 60 - elapsed);
}

// GET /api/candidate/:token  — landing info + current state
exports.getCandidate = async (req, res) => {
  try {
    const c = req.candidate;
    const assessment = await Assessment.findById(c.assessmentId).lean();
    if (!assessment) return res.status(404).json({ success: false, message: "Assessment not found." });

    const view = publicCandidateView(c, assessment);

    if (c.status === "disqualified") {
      return res.json({ success: true, state: "disqualified", data: view });
    }
    if (c.status === "completed" || c.status === "shortlisted" || c.status === "rejected") {
      return res.json({ success: true, state: "completed", data: view });
    }
    if (c.tokenExpiresAt && new Date(c.tokenExpiresAt).getTime() < now()) {
      return res.json({ success: true, state: "expired", data: view });
    }
    // Resume takes priority over the window so an in-flight attempt can always continue.
    if (c.status === "in-progress" && c.progress) {
      return res.json({ success: true, state: "in-progress", data: view });
    }
    // Time-window gating (only if the drive defines a window)
    const ws = windowState(assessment);
    if (ws === "not-started") return res.json({ success: true, state: "not-started", data: view });
    if (ws === "window-expired") return res.json({ success: true, state: "expired", data: view });

    res.json({ success: true, state: "ready", data: view });
  } catch (err) {
    console.error("getCandidate:", err);
    res.status(500).json({ success: false, message: "Server error." });
  }
};

// POST /api/candidate/:token/start  — begin (or return existing) paper
exports.startCandidate = async (req, res) => {
  try {
    const c = req.candidate;
    const assessment = await Assessment.findById(c.assessmentId).lean();
    if (!assessment) return res.status(404).json({ success: false, message: "Assessment not found." });

    if (c.status === "disqualified") {
      return res.status(409).json({ success: false, state: "disqualified", message: "Your assessment session was terminated." });
    }
    if (["completed", "shortlisted", "rejected"].includes(c.status)) {
      return res.status(409).json({ success: false, state: "completed", message: "This assessment has already been completed." });
    }
    if (c.tokenExpiresAt && new Date(c.tokenExpiresAt).getTime() < now()) {
      return res.status(410).json({ success: false, state: "expired", message: "This assessment link has expired." });
    }

    // Resume path — allowed even outside the window so an in-flight attempt can continue.
    if (c.status === "in-progress" && c.progress?.questionOrder?.length) {
      const questions = await rehydratePaper(c.progress, assessment);
      const answers = c.progress.answers instanceof Map
        ? Object.fromEntries(c.progress.answers) : (c.progress.answers || {});
      return res.json({ success: true, resumed: true, data: {
        questions, answers,
        review: c.progress.review || [],
        visited: c.progress.visited || [],
        currentQuestion: c.progress.currentQuestion || 0,
        remainingSeconds: remainingSeconds(c, assessment),
        durationMinutes: assessment.durationMinutes,
        violations: c.violations || {},
      }});
    }

    // Time-window gating for a FRESH start (only if the drive defines a window)
    const ws = windowState(assessment);
    if (ws === "not-started") {
      return res.status(425).json({ success: false, state: "not-started", startAt: assessment.startAt,
        message: "The assessment has not started yet." });
    }
    if (ws === "window-expired") {
      return res.status(410).json({ success: false, state: "expired", message: "This assessment window has expired." });
    }

    // Fresh start
    const { questionOrder, optionOrder, clientQuestions } = await buildPaper(assessment);
    if (!clientQuestions.length) {
      return res.status(400).json({ success: false, message: "No questions configured for this assessment." });
    }
    c.status = "in-progress";
    c.startedAt = new Date();
    c.progress = {
      questionOrder, optionOrder, answers: {}, review: [], visited: [],
      currentQuestion: 0,
      remainingSeconds: assessment.durationMinutes * 60,
      lastSavedAt: new Date(),
    };
    await c.save();

    res.json({ success: true, resumed: false, data: {
      questions: clientQuestions, answers: {}, review: [], visited: [],
      currentQuestion: 0,
      remainingSeconds: assessment.durationMinutes * 60,
      durationMinutes: assessment.durationMinutes,
      violations: {},
    }});
  } catch (err) {
    console.error("startCandidate:", err);
    res.status(500).json({ success: false, message: "Failed to start assessment." });
  }
};

// POST /api/candidate/:token/save  — throttled progress autosave
// Body: { answers:{qid:displayIdx}, currentQuestion, violations:{...} }
exports.saveProgress = async (req, res) => {
  try {
    const c = req.candidate;
    if (c.status !== "in-progress") return res.json({ success: true }); // silent no-op
    const { answers, currentQuestion, violations, review, visited } = req.body || {};

    const set = { "progress.lastSavedAt": new Date() };
    if (answers && typeof answers === "object") set["progress.answers"] = answers;
    if (Array.isArray(review))  set["progress.review"]  = review.map(String);
    if (Array.isArray(visited)) set["progress.visited"] = visited.map(String);
    if (Number.isInteger(currentQuestion)) set["progress.currentQuestion"] = currentQuestion;
    if (violations && typeof violations === "object") {
      const fs = Math.max(c.violations?.fullscreenExits || 0, violations.fullscreenExits || 0);
      const ts = Math.max(c.violations?.tabSwitches || 0, violations.tabSwitches || 0);
      const fl = Math.max(c.violations?.focusLoss || 0, violations.focusLoss || 0);
      const mf = Math.max(c.violations?.multipleFaces || 0, violations.multipleFaces || 0);
      set["violations"] = { fullscreenExits: fs, tabSwitches: ts, focusLoss: fl, multipleFaces: mf, total: fs + ts + fl + mf };
    }
    await Candidate.updateOne({ _id: c._id, status: "in-progress" }, { $set: set });
    res.json({ success: true });
  } catch (err) {
    console.error("saveProgress:", err);
    res.json({ success: true }); // never fail autosave
  }
};

// POST /api/candidate/:token/submit
// Body: { answers:{qid:displayIdx}, timedOut?, reason?, violations? }
exports.submitCandidate = async (req, res) => {
  try {
    const c = req.candidate;
    const assessment = await Assessment.findById(c.assessmentId).lean();
    if (!assessment) return res.status(404).json({ success: false, message: "Assessment not found." });

    // Idempotent — already finalized
    if (["completed", "shortlisted", "rejected", "disqualified"].includes(c.status)) {
      return res.json({ success: true, alreadyCompleted: true, disqualified: c.status === "disqualified", data: { name: c.name } });
    }
    if (!c.progress?.questionOrder?.length) {
      return res.status(400).json({ success: false, message: "No active attempt to submit." });
    }

    const { answers = {}, timedOut = false, reason, violations } = req.body || {};

    const optionOrder = c.progress.optionOrder instanceof Map
      ? Object.fromEntries(c.progress.optionOrder) : (c.progress.optionOrder || {});
    const qids = c.progress.questionOrder;
    const docs = await Question.find({ _id: { $in: qids } }).lean();
    const qmap = {};
    docs.forEach(q => { qmap[String(q._id)] = q; });

    let score = 0, totalMarks = 0;
    const sectionScores = {};
    (assessment.sections || []).forEach(s => { sectionScores[s.name] = 0; });

    qids.forEach(qid => {
      const q = qmap[qid];
      if (!q) return;
      totalMarks += q.marks || 1;
      const dispIdx = answers[qid];
      if (dispIdx == null) return;
      const origIdx = (optionOrder[qid] || [])[dispIdx];
      if (origIdx === q.correctIndex) {
        score += q.marks || 1;
        sectionScores[q.section] = (sectionScores[q.section] || 0) + (q.marks || 1);
      }
    });

    const passed = score >= (assessment.passingScore || 0);
    const elapsed = c.startedAt
      ? Math.floor((now() - new Date(c.startedAt).getTime()) / 1000) : 0;

    if (violations && typeof violations === "object") {
      const fs = Math.max(c.violations?.fullscreenExits || 0, violations.fullscreenExits || 0);
      const ts = Math.max(c.violations?.tabSwitches || 0, violations.tabSwitches || 0);
      const fl = Math.max(c.violations?.focusLoss || 0, violations.focusLoss || 0);
      const mf = Math.max(c.violations?.multipleFaces || 0, violations.multipleFaces || 0);
      c.violations = { fullscreenExits: fs, tabSwitches: ts, focusLoss: fl, multipleFaces: mf, total: fs + ts + fl + mf };
    }

    // Disqualification (auto-terminate on malpractice) vs normal completion.
    const disqualified = reason === "auto-malpractice";
    c.status = disqualified ? "disqualified" : "completed";
    c.submissionReason = disqualified ? "disqualified" : (timedOut ? "timed-out" : "manual");
    c.completedAt = new Date();
    c.score = score;
    c.totalMarks = totalMarks;
    c.passed = disqualified ? false : passed;
    c.sectionScores = sectionScores;
    c.timeTakenSeconds = elapsed;
    c.progress = undefined; // free the in-flight snapshot
    await c.save();

    // Send the appropriate email (best-effort — never blocks the response).
    if (disqualified) queueDisqualification(c);   // NOT the thank-you
    else queueThankYou(c, assessment);

    res.json({ success: true, disqualified, data: { name: c.name } }); // no score leaked to candidate
  } catch (err) {
    console.error("submitCandidate:", err);
    res.status(500).json({ success: false, message: "Submission failed. Please try again." });
  }
};
