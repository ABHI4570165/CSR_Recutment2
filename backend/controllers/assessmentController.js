const mongoose   = require("mongoose");
const Assessment = require("../models/Assessment");
const Candidate  = require("../models/Candidate");
const Question   = require("../models/Question");
const Counter    = require("../models/Counter");
const { generateUniqueToken } = require("../utils/tokens");
const { legacyScope } = require("../utils/legacyScope");
const { buildLink, queueThankYou, queueDisqualification, flushNow } = require("../utils/emailQueue");

// Generate a RANDOM, non-guessable walk-in test code (e.g. MH7K3QP9). Sequential
// codes let students guess the next drive's code and take it from home — random
// codes prevent that. Collision-checked so a code is never issued twice.
const crypto = require("crypto");
const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // 32 chars, no ambiguous 0/O/1/I/L
function randomCode(len) {
  const bytes = crypto.randomBytes(len);
  let s = "";
  for (let i = 0; i < len; i++) s += CODE_ALPHABET[bytes[i] % CODE_ALPHABET.length];
  return s;
}
async function nextTestCode() {
  // Series MH000–MH999, but the code is picked RANDOMLY from the still-free
  // numbers (never in sequence, never a duplicate of an existing drive).
  const used = new Set(
    (await Assessment.find({ testCode: { $regex: /^MH\d{3}$/ } }).select("testCode").lean())
      .map((a) => a.testCode)
  );
  const free = [];
  for (let i = 0; i < 1000; i++) {
    const c = `MH${String(i).padStart(3, "0")}`;
    if (!used.has(c)) free.push(c);
  }
  if (free.length) return free[crypto.randomInt(0, free.length)];
  // MH000–MH999 exhausted (1000 drives) → widen to a longer random code.
  for (let attempt = 0; attempt < 25; attempt++) {
    const code = `MH${randomCode(6)}`;
    if (!(await Assessment.exists({ testCode: code }))) return code;
  }
  return `MH${randomCode(9)}`;
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
    // A drive created while a workspace is open MUST be stamped with it. Without
    // this the new drive has no workspaceId, and listAssessments — which scopes
    // by the X-Workspace-Id header — cannot return it: the drive is created
    // successfully and then vanishes from the list that just created it.
    // driveId/roundId do the same for a drive created from inside a round, so it
    // can be listed by the round it belongs to rather than by question pool.
    const scope = legacyScope(req);
    const wsId = scope.workspaceId instanceof mongoose.Types.ObjectId ? scope.workspaceId : null;
    const linkId = (v) => (v && mongoose.isValidObjectId(v) ? new mongoose.Types.ObjectId(v) : null);
    const driveId = linkId(b.driveId);
    const roundId = linkId(b.roundId);

    const doc = await Assessment.create({
      ...(wsId    ? { workspaceId: wsId }    : {}),
      ...(driveId ? { driveId }              : {}),
      ...(roundId ? { roundId }              : {}),
      name: String(name).trim(),
      description: description || "",
      durationMinutes: parseInt(durationMinutes) || 40,
      passingScore: parseInt(passingScore) || 30,
      ...(Array.isArray(sections) && sections.length ? { sections } : {}),
      randomizeQuestions: randomizeQuestions !== false,
      randomizeOptions:   randomizeOptions   !== false,
      ...(Number(b.round) === 2 ? { round: 2 } : {}),   // Round 2 = fed technical sets
      ...(Number(b.round) === 2 && Array.isArray(b.round2Sets) && b.round2Sets.length
        ? { round2Sets: b.round2Sets.map(s => String(s).trim().toUpperCase()).filter(Boolean) } : {}),
      ...(Array.isArray(b.walkInFields) && b.walkInFields.length
        ? { walkInFields: b.walkInFields.map(s => String(s).trim()).filter(Boolean) } : {}),

      ...(deadline ? { deadline: new Date(deadline) } : {}),
      // Scheduling window
      // Captured from the admin's browser so the times render back exactly as typed.
      ...(b.timezone ? { timezone: String(b.timezone).trim() } : {}),
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
      ...(Array.isArray(b.colleges) ? { colleges: b.colleges.map((s) => String(s).trim()).filter(Boolean) } : {}),
      ...(b.cutoff != null && b.cutoff !== "" ? { cutoff: parseInt(b.cutoff) } : {}),
      ...(b.maxCandidates != null && b.maxCandidates !== "" ? { maxCandidates: parseInt(b.maxCandidates) } : {}),
      ...(b.expectedCandidates != null && b.expectedCandidates !== "" ? { expectedCandidates: parseInt(b.expectedCandidates) } : {}),
      ...(b.security && typeof b.security === "object" ? { security: b.security } : {}),
      ...(b.securityConfig && typeof b.securityConfig === "object" ? { securityConfig: b.securityConfig } : {}),
    });
    res.status(201).json({ success: true, data: doc });
  } catch (err) {
    console.error("createAssessment:", err);
    res.status(500).json({ success: false, message: "Failed to create assessment." });
  }
};

exports.listAssessments = async (req, res) => {
  try {
    // LEGACY SCOPE: a round's test in the new architecture is also an Assessment,
    // but it belongs to a workspace drive and is never a drive itself. Excluding
    // those keeps this list showing exactly the drives it always showed.
    // A round's test container is an implementation detail of the round, never a
    // drive. Excluding it here is what stops "one drive per round" appearing.
    const list = await Assessment.find({ ...legacyScope(req), isTest: { $ne: true } })
      .sort({ createdAt: -1 }).lean();
    // Attach candidate counts per assessment in one grouped query
    const counts = await Candidate.aggregate([
      { $match: legacyScope(req) },
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

// POST /api/assessments/:id/refresh-code — issue a NEW random test code for a
// walk-in drive (between batches, to stop code leaking). Already-registered
// students are UNAFFECTED — they take the test via their personal token link,
// not the code; the code is only used for NEW registrations.
exports.refreshTestCode = async (req, res) => {
  try {
    const a = await Assessment.findById(req.params.id);
    if (!a) return res.status(404).json({ success: false, message: "Drive not found." });
    if (a.driveType !== "WALK_IN") {
      return res.status(400).json({ success: false, message: "Only walk-in drives have a test code." });
    }
    const previous = a.testCode || null;
    a.testCode = await nextTestCode();   // random, unique
    await a.save();
    res.json({ success: true, testCode: a.testCode, previous, message: `Test code changed to ${a.testCode}.` });
  } catch (err) {
    console.error("refreshTestCode:", err);
    res.status(500).json({ success: false, message: "Failed to refresh test code." });
  }
};

exports.updateAssessment = async (req, res) => {
  try {
    const allowed = ["name", "description", "durationMinutes", "passingScore",
      "sections", "randomizeQuestions", "randomizeOptions", "deadline", "isActive", ...SCHED_FIELDS,
      // V3 editable fields (Phase 9) — note: driveType & testCode are NOT editable after creation
      "status", "college", "colleges", "cutoff", "maxCandidates", "expectedCandidates", "security", "securityConfig", "round", "round2Sets", "walkInFields", "timezone"];
    const update = {};
    allowed.forEach(k => { if (req.body[k] !== undefined) update[k] = req.body[k]; });
    ["deadline", "assessmentDate", "startAt", "endAt", "linkSendAt"].forEach(k => { if (update[k]) update[k] = new Date(update[k]); });
    ["durationMinutes", "passingScore", "cutoff", "maxCandidates", "expectedCandidates"].forEach(k => {
      if (update[k] !== undefined && update[k] !== null && update[k] !== "") update[k] = parseInt(update[k]);
    });
    const a = await Assessment.findByIdAndUpdate(req.params.id, { $set: update }, { new: true });
    if (!a) return res.status(404).json({ success: false, message: "Assessment not found." });

    // If the schedule was changed, extend EXISTING candidates' token expiry to the new
    // end time — otherwise candidates registered under the old schedule stay "expired"
    // even though the drive window was moved. (tokenExpiresAt is frozen at registration.)
    const scheduleChanged = ["endAt", "deadline", "assessmentDate", "startAt"].some(k => req.body[k] !== undefined);
    if (scheduleChanged) {
      const newExpiry = a.endAt || a.deadline || null;
      if (newExpiry) {
        const r = await Candidate.updateMany(
          { assessmentId: a._id, status: { $nin: ["completed", "shortlisted", "rejected", "disqualified"] } },
          { $set: { tokenExpiresAt: newExpiry } }
        );
        console.log(`[updateAssessment] schedule changed → extended tokenExpiresAt for ${r.modifiedCount} candidate(s)`);
      }
    }
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
        // Inherit the drive's scope. Without workspaceId the candidate is
        // invisible to listCandidates, which scopes by the X-Workspace-Id
        // header — the row is created and then cannot be found. Taking it from
        // the assessment (rather than the request) keeps it correct on the
        // public walk-in route too, which carries no admin header.
        ...(assessment.workspaceId ? { workspaceId: assessment.workspaceId } : {}),
        ...(assessment.driveId     ? { driveId: assessment.driveId }         : {}),
        ...(assessment.roundId     ? { roundId: assessment.roundId }         : {}),
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
    // Cap high enough for full-drive / all-candidates exports (limit=99999) to
    // return everyone. The list omits resume base64 (select below), so a large
    // page stays light. The paginated table still passes limit=20.
    const limit  = Math.min(100000, parseInt(req.query.limit) || 20);
    const { assessmentId, college, status, search, source, minScore, round, techEligible } = req.query;

    // LEGACY SCOPE: this endpoint serves the original (pre-workspace) screens,
    // which have no concept of a workspace. Records created by the new
    // multi-workspace flow carry workspaceId and belong to their own screens —
    // excluding them keeps this list showing exactly what it always showed.
    const filter = { ...legacyScope(req) };
    if (assessmentId) filter.assessmentId = assessmentId;   // omit → global (all drives)
    // Round filter — authoritative: resolve to the drives whose Assessment.round matches,
    // so round always comes from the drive, never from UI text. (Round 1 = Aptitude, 2 = Technical.)
    if (!assessmentId && round) {
      const roundIds = await Assessment.find({ round: Number(round) }).distinct("_id");
      filter.assessmentId = { $in: roundIds };
    }
    if (college) filter.college = college;
    if (status) filter.status = status;
    if (source) filter.candidateSource = source;
    if (techEligible === "true") filter.techEligible = true;
    if (minScore !== undefined && minScore !== "") filter.score = { $gte: parseInt(minScore) || 0 };
    if (search) {
      const re = new RegExp(escapeRegex(String(search).trim()), "i");
      filter.$or = [{ name: re }, { email: re }, { college: re }, { aadhaar: re }, { phone: re }, { usn: re }];
    }

    const [rows, total] = await Promise.all([
      Candidate.find(filter)
        .select("name email college candidateSource usn phone gender dob aadhaar location course branch resume.filename resume.ext resume.mime resume.size resume.url resume.uploadedAt status emailStatus emailScheduledAt emailSentAt shortlistEmail thankYouEmailSentAt disqualificationEmailSentAt score totalMarks passed violations refreshCount terminationReason geo submissionReason startedAt completedAt token tokenExpiresAt createdAt")
        .populate("assessmentId", "name driveType cutoff round")  // drive context for the global view
        .sort({ createdAt: -1 }).skip((page - 1) * limit).limit(limit).lean(),
      Candidate.countDocuments(filter),
    ]);
    const data = rows.map(c => {
      const drv = c.assessmentId && typeof c.assessmentId === "object" ? c.assessmentId : null;
      const roundNo = drv?.round ?? c.round ?? null;   // authoritative: from the drive
      return {
        ...c,
        drive: drv ? { _id: drv._id, name: drv.name, driveType: drv.driveType, cutoff: drv.cutoff, round: drv.round } : null,
        round: roundNo,
        roundName: Candidate.roundName(roundNo),
        roundStatus: Candidate.roundStatusOf(c.status),
        assessmentId: c.assessmentId?._id || c.assessmentId,
        link: buildLink(c.token), token: undefined,
      };
    });
    res.json({ success: true, data, pagination: { page, limit, total, pages: Math.ceil(total / limit) } });
  } catch (err) {
    console.error("listCandidates:", err);
    res.status(500).json({ success: false, message: "Failed to load candidates." });
  }
};

// Counters by status + by college for the drive dashboard
exports.candidateStats = async (req, res) => {
  try {
    // Legacy scope — see listCandidates.
    const match = { ...legacyScope(req) };
    if (req.query.assessmentId) {
      if (!mongoose.isValidObjectId(req.query.assessmentId)) {
        return res.status(400).json({ success: false, message: "Invalid assessmentId." });
      }
      match.assessmentId = new mongoose.Types.ObjectId(req.query.assessmentId);
    } else if (req.query.round) {
      // Round-scoped stats — authoritative from Assessment.round (all drives of that round).
      const roundIds = await Assessment.find({ round: Number(req.query.round) }).distinct("_id");
      match.assessmentId = { $in: roundIds };
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

/* =====================================================================
 *  ROUND SEGREGATION  (Round 1 = Aptitude, Round 2 = Technical Round)
 *  Additive: existing per-drive candidate records ARE the per-round result
 *  records. Round is always read from Assessment.round (never UI text).
 * ===================================================================== */

// Identity helpers for linking a person's separate per-round records.
const _em = (s) => String(s || "").trim().toLowerCase();
const _ph = (s) => { const d = String(s || "").replace(/\D/g, ""); return d.length >= 10 ? d.slice(-10) : ""; };

// Fold raw status counts into the funnel numbers the dashboard shows.
function funnelFrom(statusMap) {
  const g = (...ks) => ks.reduce((t, k) => t + (statusMap[k] || 0), 0);
  return {
    total:       g("invited", "email-sent", "started", "in-progress", "completed", "shortlisted", "rejected", "disqualified"),
    notAttempted: g("invited", "email-sent"),
    started:     g("started", "in-progress"),
    completed:   g("completed", "shortlisted", "rejected"),   // finished the test (decisions are post-completion)
    selected:    g("shortlisted"),
    rejected:    g("rejected", "disqualified"),
  };
}

// GET /api/assessments/rounds/summary — Aptitude → Technical → Final funnel.
exports.roundSummary = async (_req, res) => {
  try {
    const scope = legacyScope(_req);
    const [r1Ids, r2Ids] = await Promise.all([
      Assessment.find({ round: 1, ...scope }).distinct("_id"),
      Assessment.find({ round: 2, ...scope }).distinct("_id"),
    ]);
    const countsFor = async (ids) => {
      const agg = await Candidate.aggregate([
        // Legacy scope — workspace records have their own round dashboards.
        { $match: { assessmentId: { $in: ids }, ...legacyScope(_req) } },
        { $group: { _id: "$status", n: { $sum: 1 } } },
      ]);
      const m = {}; agg.forEach(a => { m[a._id] = a.n; });
      return funnelFrom(m);
    };
    const [apt, tech] = await Promise.all([countsFor(r1Ids), countsFor(r2Ids)]);
    res.json({ success: true, data: {
      rounds: [
        { roundNumber: 1, roundName: Candidate.roundName(1), ...apt },
        { roundNumber: 2, roundName: Candidate.roundName(2), ...tech },
      ],
      final: { roundName: "Final Selection", selected: tech.selected },
    }});
  } catch (err) {
    console.error("roundSummary:", err);
    res.status(500).json({ success: false, message: "Failed to load round summary." });
  }
};

// GET /api/assessments/candidates/:id/journey — the person's full round history.
// Links records by masterId (authoritative) else by exact email/phone identity.
exports.candidateJourney = async (req, res) => {
  try {
    const c = await Candidate.findById(req.params.id).lean();
    if (!c) return res.status(404).json({ success: false, message: "Candidate not found." });

    let linked;
    if (c.masterId) {
      linked = await Candidate.find({ $or: [{ masterId: c.masterId }, { _id: c.masterId }] })
        .populate("assessmentId", "name round").lean();
    } else {
      const or = [{ email: _em(c.email) }];
      const p = _ph(c.phone);
      if (p) or.push({ phone: new RegExp(p + "$") });
      linked = await Candidate.find({ $or: or }).populate("assessmentId", "name round").lean();
    }

    const stageOf = (x) => {
      const drv = x.assessmentId && typeof x.assessmentId === "object" ? x.assessmentId : null;
      const roundNo = drv?.round ?? x.round ?? null;
      const rs = Candidate.roundStatusOf(x.status);
      const started = ["started", "in-progress", "completed", "shortlisted", "rejected", "disqualified"].includes(x.status);
      return {
        candidateId: String(x._id),
        roundNumber: roundNo,
        roundName: Candidate.roundName(roundNo),
        driveName: drv?.name || "",
        status: x.status,
        roundStatus: rs,
        // RESULT ISOLATION: only expose a score if this record actually took THIS round.
        score: started ? x.score : null,
        totalScore: started ? x.totalMarks : null,
        percentage: (started && x.score != null && x.totalMarks) ? Math.round((x.score / x.totalMarks) * 100) : null,
        startedAt: x.startedAt || null,
        completedAt: x.completedAt || null,
      };
    };
    const rounds = linked.map(stageOf)
      .filter(r => r.roundNumber != null)
      .sort((a, b) => a.roundNumber - b.roundNumber);

    const currentRound = rounds.length ? Math.max(...rounds.map(r => r.roundNumber)) : (c.round || 1);
    const techSelected = rounds.some(r => r.roundNumber === 2 && r.roundStatus === "SELECTED");
    const anyRejected  = rounds.some(r => r.roundStatus === "REJECTED");
    const overallStatus = techSelected ? "FINALLY_SELECTED" : anyRejected ? "REJECTED" : "IN_PROGRESS";

    res.json({ success: true, data: {
      candidate: { name: c.name, email: c.email, phone: c.phone, college: c.college },
      currentRound, currentRoundName: Candidate.roundName(currentRound),
      overallStatus, rounds,
    }});
  } catch (err) {
    console.error("candidateJourney:", err);
    res.status(500).json({ success: false, message: "Failed to load candidate journey." });
  }
};

// POST /api/assessments/rounds/move-to-technical  { candidateIds:[...] }
// Advances Aptitude-SELECTED candidates to the Technical round. Idempotent, never
// duplicates: sets techEligible + a stable masterId, and links any existing Round-2
// record of the same person to that masterId. Aptitude results are left untouched.
exports.moveToTechnical = async (req, res) => {
  try {
    const { candidateIds } = req.body || {};
    if (!Array.isArray(candidateIds) || !candidateIds.length) {
      return res.status(400).json({ success: false, message: "No candidates selected." });
    }
    const r2Ids = await Assessment.find({ round: 2 }).distinct("_id");
    const r2Set = new Set(r2Ids.map(String));

    let moved = 0, skipped = 0, linked = 0;
    const cands = await Candidate.find({ _id: { $in: candidateIds } });
    for (const c of cands) {
      // ENFORCE PROGRESSION: only Aptitude records that are SELECTED (shortlisted) advance.
      const roundNo = c.round ?? null;
      const isAptitude = roundNo === 1 || (roundNo == null && !r2Set.has(String(c.assessmentId)));
      if (!isAptitude || c.status !== "shortlisted") { skipped++; continue; }

      const master = c.masterId || c._id;         // stable person key = the Aptitude record id
      if (!c.techEligible || !c.masterId) {
        c.techEligible = true; c.masterId = master; await c.save(); moved++;
      }
      // Link an existing Round-2 record of the same person (exact email or phone) to the master.
      const p = _ph(c.phone);
      const idOr = [{ email: _em(c.email) }]; if (p) idOr.push({ phone: new RegExp(p + "$") });
      const r2rec = await Candidate.findOne({ assessmentId: { $in: r2Ids }, $or: idOr });
      if (r2rec && String(r2rec.masterId || "") !== String(master)) {
        r2rec.masterId = master; await r2rec.save(); linked++;
      }
    }
    res.json({ success: true, data: { requested: candidateIds.length, moved, alreadyEligible: cands.length - moved - skipped, skipped, linkedExistingTechnical: linked } });
  } catch (err) {
    console.error("moveToTechnical:", err);
    res.status(500).json({ success: false, message: "Failed to move candidates." });
  }
};

// Campus overview metrics + recent activity for the admin Dashboard tab.
exports.overviewStats = async (req, res) => {
  try {
    // Legacy scope — the original dashboard counts only pre-workspace records.
    const LEGACY = legacyScope(req);
    const [driveAgg, candAgg, selectedAgg, recentCands, recentDrives] = await Promise.all([
      Assessment.aggregate([{ $match: LEGACY }, { $group: { _id: "$status", n: { $sum: 1 } } }]),
      Candidate.aggregate([{ $match: LEGACY }, { $group: {
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
    // Legacy scope — see listCandidates.
    const filter = { ...legacyScope(req) };
    if (req.query.assessmentId) filter.assessmentId = req.query.assessmentId;
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

// Download a candidate's uploaded resume (admin).
// Resolve the correct MIME type from extension when the stored mime is generic.
function resumeMime(ext, stored) {
  const e = (ext || "").toLowerCase();
  if (e === "pdf") return "application/pdf";
  if (e === "doc") return "application/msword";
  if (e === "docx") return "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
  return stored && stored !== "application/octet-stream" ? stored : "application/octet-stream";
}

exports.getCandidateResume = async (req, res) => {
  try {
    const c = await Candidate.findById(req.params.id).select("resume name usn").lean();
    if (!c || !c.resume || (!c.resume.url && !c.resume.data)) return res.status(404).json({ success: false, message: "No resume on file." });

    // Build a clean, predictable filename: CandidateName_USN_Resume.ext
    const r = c.resume;
    const ext = (r.ext || (r.filename || "").split(".").pop() || "").toLowerCase().replace(/[^a-z0-9]/g, "") || "pdf";
    const namePart = String(c.name || "Candidate").replace(/[^a-z0-9]+/gi, "_").replace(/^_|_$/g, "");
    const usnPart  = c.usn ? `_${String(c.usn).replace(/[^a-z0-9]+/gi, "_")}` : "";
    const downloadName = `${namePart}${usnPart}_Resume.${ext}`;
    const inline = req.query.download ? false : true; // preview inline by default; ?download=1 forces save
    const mime = resumeMime(ext, r.mime);

    // Fetch the bytes (Cloudinary URL streamed server-side so we control the headers),
    // or use the base64 fallback. This guarantees the right content-type + filename
    // regardless of how the file was stored — fixes "wrong extension / unreadable".
    let buf;
    if (r.data) {
      buf = Buffer.from(r.data, "base64");
    } else {
      const resp = await fetch(r.url);
      if (!resp.ok) return res.status(502).json({ success: false, message: "Resume is temporarily unavailable." });
      buf = Buffer.from(await resp.arrayBuffer());
    }
    res.setHeader("Content-Type", mime);
    res.setHeader("Content-Disposition", `${inline ? "inline" : "attachment"}; filename="${downloadName}"`);
    res.setHeader("Cache-Control", "private, max-age=300");
    res.send(buf);
  } catch (err) {
    console.error("getCandidateResume:", err);
    res.status(500).json({ success: false, message: "Server error." });
  }
};

// GET /api/assessments/candidates/:id/answers — per-question answer review (admin).
// Completed candidates use the answerSheet stored at submission; in-progress
// candidates get a live sheet built from their saved progress.
exports.getCandidateAnswers = async (req, res) => {
  try {
    const c = await Candidate.findById(req.params.id)
      .select("name email college status score totalMarks assignedSet answerSheet progress").lean();
    if (!c) return res.status(404).json({ success: false, message: "Candidate not found." });

    let sheet = c.answerSheet;
    if (!sheet && c.progress?.questionOrder?.length) {
      // Live view for an in-progress attempt (no correctness leak concern — admin only).
      const qids = c.progress.questionOrder;
      const optionOrder = c.progress.optionOrder instanceof Map
        ? Object.fromEntries(c.progress.optionOrder) : (c.progress.optionOrder || {});
      const rawAns = c.progress.answers instanceof Map
        ? Object.fromEntries(c.progress.answers) : (c.progress.answers || {});
      const docs = await Question.find({ _id: { $in: qids } }).lean();
      const qmap = {}; docs.forEach(q => { qmap[String(q._id)] = q; });
      const norm = s => String(s ?? "").trim().toLowerCase().replace(/\s+/g, " ");
      sheet = qids.map(qid => {
        const q = qmap[qid]; if (!q) return null;
        const ans = rawAns[qid];
        const correctAns = q.type === "text" ? (q.answerText ?? null) : (q.options?.[q.correctIndex] ?? null);
        let given = null, correct = false;
        if (ans != null && ans !== "") {
          if (q.type === "text") { given = String(ans); correct = q.answerText != null && norm(ans) === norm(q.answerText); }
          else { const oi = (optionOrder[qid] || [])[ans]; given = oi != null && q.options ? (q.options[oi] ?? null) : null; correct = oi === q.correctIndex; }
        }
        return { qid, section: q.section, given, correct: correctAns, isCorrect: correct, marks: correct ? (q.marks || 1) : 0 };
      }).filter(Boolean);
    }

    if (!sheet || !sheet.length) {
      return res.json({ success: true, data: { candidate: pickCand(c), answers: [],
        note: "No answer data for this candidate (submitted before answer recording was enabled)." } });
    }

    // Join current question text (kept out of the sheet to keep candidate docs light).
    const docs = await Question.find({ _id: { $in: sheet.map(s => s.qid) } }).select("text type").lean();
    const qmap = {}; docs.forEach(q => { qmap[String(q._id)] = q; });
    const answers = sheet.map((s, i) => ({
      n: i + 1, section: s.section,
      text: qmap[s.qid]?.text || "(question was edited or removed)",
      type: qmap[s.qid]?.type || (s.correct && s.correct.length > 30 ? "text" : undefined),
      given: s.given, correct: s.correct, isCorrect: !!s.isCorrect, marks: s.marks || 0,
    }));
    res.json({ success: true, data: { candidate: pickCand(c), answers } });
  } catch (err) {
    console.error("getCandidateAnswers:", err);
    res.status(500).json({ success: false, message: "Server error." });
  }
};
function pickCand(c) {
  return { name: c.name, email: c.email, college: c.college, status: c.status,
    score: c.score ?? null, totalMarks: c.totalMarks ?? null, assignedSet: c.assignedSet || null };
}

// POST /api/assessments/candidates/:id/terminate — admin ends a live attempt now.
// Scores whatever was answered so far, marks the candidate disqualified, and the
// student's exam page ends within one auto-save cycle (or on refresh).
exports.terminateCandidate = async (req, res) => {
  try {
    console.log("[terminate] candidate:", req.params.id);
    if (!mongoose.isValidObjectId(req.params.id)) {
      return res.status(400).json({ success: false, message: "Invalid candidate id." });
    }
    const c = await Candidate.findById(req.params.id);
    if (!c) return res.status(404).json({ success: false, message: "Candidate not found." });
    if (["completed", "shortlisted", "rejected", "disqualified"].includes(c.status)) {
      return res.status(409).json({ success: false, message: `Assessment already ended (status: ${c.status}).` });
    }
    const prog = c.progress || {};
    const qids = prog.questionOrder || [];
    const optionOrder = prog.optionOrder instanceof Map ? Object.fromEntries(prog.optionOrder) : (prog.optionOrder || {});
    const rawAns = prog.answers instanceof Map ? Object.fromEntries(prog.answers) : (prog.answers || {});
    const docs = await Question.find({ _id: { $in: qids } }).lean();
    const qmap = {}; docs.forEach(q => { qmap[String(q._id)] = q; });
    const norm = s => String(s ?? "").trim().toLowerCase().replace(/\s+/g, " ");
    let score = 0, totalMarks = 0; const sectionScores = {}; const answerSheet = [];
    qids.forEach(qid => {
      const q = qmap[qid]; if (!q) return;
      totalMarks += q.marks || 1;
      const ans = rawAns[qid];
      const correctAns = q.type === "text" ? (q.answerText ?? null) : (q.options?.[q.correctIndex] ?? null);
      let correct = false, given = null;
      if (ans != null && ans !== "") {
        if (q.type === "text") { given = String(ans); correct = q.answerText != null && norm(ans) === norm(q.answerText); }
        else { const oi = (optionOrder[qid] || [])[ans]; given = oi != null && q.options ? (q.options[oi] ?? null) : null; correct = oi === q.correctIndex; }
        if (correct) { score += q.marks || 1; sectionScores[q.section] = (sectionScores[q.section] || 0) + (q.marks || 1); }
      }
      answerSheet.push({ qid, section: q.section, given, correct: correctAns, isCorrect: correct, marks: correct ? (q.marks || 1) : 0 });
    });
    c.status = "disqualified";
    c.submissionReason = "manual-terminate";
    c.terminationReason = String(req.body?.reason || "Manually terminated by administrator").slice(0, 200);
    c.completedAt = new Date();
    c.score = score; c.totalMarks = totalMarks; c.sectionScores = sectionScores; c.passed = false;
    c.answerSheet = answerSheet;
    if (c.startedAt) c.timeTakenSeconds = Math.floor((now() - new Date(c.startedAt).getTime()) / 1000);
    c.progress = undefined;
    c.completionEmail = { status: "pending", scheduledAt: new Date(), attempts: 0 };
    await c.save();
    console.log(`[terminate] done: ${c.name} → disqualified (${score}/${totalMarks})`);
    res.json({ success: true, message: `${c.name}'s assessment was terminated.`, data: { name: c.name, status: c.status } });
  } catch (err) {
    console.error("terminateCandidate error:", err?.name, err?.message, err);
    // Surface validation errors instead of a generic 500 so the cause is visible.
    if (err?.name === "ValidationError") {
      return res.status(400).json({ success: false, message: `Validation failed: ${err.message}` });
    }
    res.status(500).json({ success: false, message: "Failed to terminate the assessment. Please try again." });
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

// All per-attempt violation counters (monotonic — we keep the max seen).
const VIOLATION_KEYS = ["fullscreenExits", "tabSwitches", "focusLoss", "multipleFaces",
  "refresh", "devtools", "clipboard", "idle", "windowResize", "location", "cameraDisconnect", "faceHidden"];
function mergeViolations(existing, incoming) {
  const out = {};
  let total = 0;
  VIOLATION_KEYS.forEach(k => { const v = Math.max(existing?.[k] || 0, incoming?.[k] || 0); out[k] = v; total += v; });
  out.total = total;
  return out;
}

// Great-circle distance in metres between two lat/lng points (Haversine).
function haversineMeters(lat1, lng1, lat2, lng2) {
  const R = 6371000, toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1), dLng = toRad(lng2 - lng1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return Math.round(R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a)));
}

function publicCandidateView(c, assessment) {
  const s = assessment.security || {};
  const cfg = assessment.securityConfig || {};
  const loc = cfg.location || {};
  return {
    name: c.name,
    email: c.email,
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
      // Batch A (default ON)
      refreshProtection:         s.refreshProtection !== false,
      rightClickProtection:      s.rightClickProtection !== false,
      keyboardBlocking:          s.keyboardBlocking !== false,
      devToolsDetection:         s.devToolsDetection !== false,
      clipboardMonitoring:       s.clipboardMonitoring !== false,
      idleDetection:             s.idleDetection !== false,
      windowResizeDetection:     s.windowResizeDetection !== false,
      screenResolutionCheck:     s.screenResolutionCheck !== false,
      browserCompatibility:      s.browserCompatibility !== false,
      incognitoDetection:        s.incognitoDetection !== false,
      cameraDisconnectDetection: s.cameraDisconnectDetection !== false,
      faceVisibilityDetection:   s.faceVisibilityDetection !== false,
      // Batch B (default OFF unless a location is configured)
      locationRestriction:       s.locationRestriction === true && loc.lat != null && loc.lng != null,
    },
    securityConfig: {
      maxViolations:   cfg.maxViolations   || 3,
      idleSeconds:     cfg.idleSeconds     || 120,
      clipboardLimit:  cfg.clipboardLimit  || 3,
      minScreenWidth:  cfg.minScreenWidth  || 1024,
      minScreenHeight: cfg.minScreenHeight || 600,
      cameraGraceSeconds: cfg.cameraGraceSeconds || 10,
      location: { lat: loc.lat ?? null, lng: loc.lng ?? null, radiusMeters: loc.radiusMeters || 200, label: loc.label || "" },
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
// Round 2: pass the candidate's assigned set ("A"/"B") — only that set's questions
// are pulled. Supports both MCQ and typed-answer ("text") questions.
async function buildPaper(assessment, set = null) {
  const sections = assessment.sections || [];
  const sectionNames = sections.map(s => s.name);
  const filter = (assessment.round === 2)
    ? { round: 2, set, section: { $in: sectionNames } }   // one set per candidate
    : { section: { $in: sectionNames } };                 // round 1: unchanged pool
  const all = await Question.find(filter).lean();

  const bySection = {};
  all.forEach(q => { (bySection[q.section] ||= []).push(q); });

  const questionOrder = [];
  const optionOrder = {};   // qid -> [origIdx in display order]  (mcq only)
  const clientQuestions = [];

  // Iterate sections in fixed configured order; shuffle the pool WITHIN each
  // section only (jumbled per section) — questions never cross section boundaries.
  sections.forEach(sec => {
    let pool = bySection[sec.name] || [];
    pool = assessment.randomizeQuestions ? shuffle(pool) : pool.sort((a, b) => (a.order || 0) - (b.order || 0));
    pool = pool.slice(0, sec.questionCount || pool.length);
    pool.forEach(q => {
      const qid = String(q._id);
      questionOrder.push(qid);
      if (q.type === "text") {
        // Typed-answer: no options, no answer leaked to the client. `reference`
        // carries shared HTML (e.g. SQL tables) shown with the question.
        clientQuestions.push({ id: qid, section: q.section, sectionLabel: sec.displayName || sec.name, text: q.text, type: "text", marks: q.marks || 1, ...(q.longAnswer ? { longAnswer: true } : {}), ...(q.reference ? { reference: q.reference } : {}) });
      } else {
        const idxs = (q.options || []).map((_, i) => i);
        const dispIdxs = assessment.randomizeOptions ? shuffle(idxs) : idxs;
        optionOrder[qid] = dispIdxs;
        clientQuestions.push({
          id: qid, section: q.section, sectionLabel: sec.displayName || sec.name, text: q.text,
          type: "mcq", marks: q.marks || 1,
          options: dispIdxs.map(oi => q.options[oi]), // display order, no correctIndex leaked
        });
      }
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
    if (q.type === "text") {
      clientQuestions.push({ id: qid, section: q.section, sectionLabel: labelMap[q.section] || q.section, text: q.text, type: "text", marks: q.marks || 1, ...(q.longAnswer ? { longAnswer: true } : {}), ...(q.reference ? { reference: q.reference } : {}) });
    } else {
      const dispIdxs = optionOrder[qid] || (q.options || []).map((_, i) => i);
      clientQuestions.push({
        id: qid, section: q.section, sectionLabel: labelMap[q.section] || q.section,
        text: q.text, type: "mcq", marks: q.marks || 1, options: dispIdxs.map(oi => q.options[oi]),
      });
    }
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
    // Resume ALWAYS wins — an in-flight attempt can continue regardless of a stale
    // per-candidate token, so a mid-exam student is never wrongly "expired".
    if (c.status === "in-progress" && c.progress) {
      return res.json({ success: true, state: "in-progress", data: view });
    }
    // The DRIVE WINDOW is the authority. Never expire a candidate while the drive's
    // end time is still in the future — a stale tokenExpiresAt must not block them.
    const ws = windowState(assessment);
    if (ws === "not-started") return res.json({ success: true, state: "not-started", data: view });
    if (ws === "window-expired") return res.json({ success: true, state: "expired", data: view });
    // Legacy drives with no window fall back to the per-candidate token expiry.
    if (!assessment.endAt && !assessment.deadline && c.tokenExpiresAt && new Date(c.tokenExpiresAt).getTime() < now()) {
      return res.json({ success: true, state: "expired", data: view });
    }

    res.json({ success: true, state: "ready", data: view });
  } catch (err) {
    console.error("getCandidate:", err);
    res.status(500).json({ success: false, message: "Server error." });
  }
};

/*
 * NEW-ARCHITECTURE GATE — round eligibility + mandatory registration fields.
 *
 * Runs ONLY for records written by the multi-workspace flow (they carry
 * roundId + applicationId). Legacy candidates have neither field, so they skip
 * this entirely and behave exactly as they always have.
 *
 * This is the server-side enforcement of round progression: a candidate who has
 * not QUALIFIED the previous round cannot start the next one, no matter what
 * URL or API call they use. Hiding a button in the UI is never the control.
 */
async function assertRoundAccess(c) {
  if (!c.roundId || !c.applicationId) return null;   // legacy record — no gate

  const Round = require("../models/Round");
  const CandidateApplication = require("../models/CandidateApplication");
  const Student = require("../models/Student");
  const { assertEligible, missingRequiredFields } = require("../utils/recruitment");

  const [round, application] = await Promise.all([
    Round.findById(c.roundId),
    CandidateApplication.findById(c.applicationId),
  ]);
  if (!round || !application) {
    const e = new Error("This assessment is no longer available."); e.status = 404; throw e;
  }
  // Throws RuleError(403) when the previous round was not qualified.
  await assertEligible(application, round);

  const student = await Student.findById(application.studentId).lean();
  const missing = await missingRequiredFields(application, student);
  if (missing.length) {
    const e = new Error("Please complete your registration details before starting the test.");
    e.status = 428; e.state = "registration-incomplete"; e.missing = missing;
    throw e;
  }
  return round;
}

// POST /api/candidate/:token/start  — begin (or return existing) paper
exports.startCandidate = async (req, res) => {
  try {
    const c = req.candidate;

    // Round-progression + registration gate (new architecture only).
    try {
      await assertRoundAccess(c);
    } catch (gate) {
      return res.status(gate.status || 403).json({
        success: false, message: gate.message,
        ...(gate.state ? { state: gate.state } : {}),
        ...(gate.missing ? { missing: gate.missing } : {}),
        ...(gate.requiredRound ? { requiredRound: gate.requiredRound } : {}),
      });
    }

    const assessment = await Assessment.findById(c.assessmentId).lean();
    if (!assessment) return res.status(404).json({ success: false, message: "Assessment not found." });

    if (c.status === "disqualified") {
      return res.status(409).json({ success: false, state: "disqualified", message: "Your assessment session was terminated." });
    }
    if (["completed", "shortlisted", "rejected"].includes(c.status)) {
      return res.status(409).json({ success: false, state: "completed", message: "This assessment has already been completed." });
    }
    // Resume path — ALWAYS allowed for an in-flight attempt (never blocked by a
    // stale token), even outside the window, so a mid-exam student can continue.
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
    // Legacy drives with no window fall back to the per-candidate token expiry.
    if (!assessment.endAt && !assessment.deadline && c.tokenExpiresAt && new Date(c.tokenExpiresAt).getTime() < now()) {
      return res.status(410).json({ success: false, state: "expired", message: "This assessment link has expired." });
    }

    // ── Batch B: geolocation gate (server-authoritative distance) ──────────────
    // Enforced only when the drive enables locationRestriction AND has a centre set.
    const sec = assessment.security || {};
    const locCfg = (assessment.securityConfig || {}).location || {};
    if (sec.locationRestriction === true && locCfg.lat != null && locCfg.lng != null) {
      const g = req.body?.geo || {};
      if (typeof g.lat !== "number" || typeof g.lng !== "number") {
        return res.status(428).json({ success: false, state: "location-required",
          message: "Location access is required to start this assessment. Please allow location and retry." });
      }
      const distance = haversineMeters(locCfg.lat, locCfg.lng, g.lat, g.lng);
      const radius = locCfg.radiusMeters || 200;
      // Tolerate GPS inaccuracy: indoor/WiFi positioning is often off by 50–300 m, so a
      // student standing INSIDE the venue can report coords beyond the radius. Allow the
      // reported accuracy as slack (capped at 500 m so a wildly-wrong reading can't fully bypass).
      const acc = Math.max(0, Number(g.accuracy) || 0);
      const slack = Math.min(acc, 500);
      const inside = distance <= radius + slack;
      c.geo = { lat: g.lat, lng: g.lng, accuracy: g.accuracy ?? null, distance, inside, capturedAt: new Date() };
      if (!inside) {
        await c.save();
        return res.status(403).json({ success: false, state: "location-blocked", distance, radius,
          message: "You are outside the permitted assessment location." });
      }
    } else if (req.body?.geo && typeof req.body.geo.lat === "number") {
      // Location not enforced, but still record it if the client volunteered it.
      c.geo = { lat: req.body.geo.lat, lng: req.body.geo.lng, accuracy: req.body.geo.accuracy ?? null, distance: null, inside: null, capturedAt: new Date() };
    }

    // Round 2: assign this candidate ONE set (A/B), alternating by start order.
    // Fixed once and stored so a resume shows the same paper.
    let assignedSet = c.assignedSet || null;
    if (assessment.round === 2 && !assignedSet) {
      const sets = (Array.isArray(assessment.round2Sets) && assessment.round2Sets.length)
        ? assessment.round2Sets : ["A", "B"];   // default for older drives
      const already = await Candidate.countDocuments({ assessmentId: assessment._id, assignedSet: { $ne: null } });
      assignedSet = sets[already % sets.length];   // round-robin across the drive's sets
      c.assignedSet = assignedSet;
    }

    // Fresh start
    const { questionOrder, optionOrder, clientQuestions } = await buildPaper(assessment, assignedSet);
    if (!clientQuestions.length) {
      return res.status(400).json({ success: false, message: "No questions configured for this assessment." });
    }
    c.status = "in-progress";
    // Mirror the engine state onto the round vocabulary (new architecture only).
    if (c.roundId) c.roundStatus = "IN_PROGRESS";
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
    if (c.status !== "in-progress") {
      // Admin may have terminated this attempt — tell the exam page to end immediately.
      return res.json({ success: true, terminated: c.status === "disqualified", reason: c.terminationReason || null });
    }
    const { answers, currentQuestion, violations, review, visited, refreshCount } = req.body || {};

    const set = { "progress.lastSavedAt": new Date() };
    if (answers && typeof answers === "object") set["progress.answers"] = answers;
    if (Array.isArray(review))  set["progress.review"]  = review.map(String);
    if (Array.isArray(visited)) set["progress.visited"] = visited.map(String);
    if (Number.isInteger(currentQuestion)) set["progress.currentQuestion"] = currentQuestion;
    if (Number.isInteger(refreshCount)) set["refreshCount"] = Math.max(c.refreshCount || 0, refreshCount);
    if (violations && typeof violations === "object") {
      set["violations"] = mergeViolations(c.violations, violations);
    }
    await Candidate.updateOne({ _id: c._id, status: "in-progress" }, { $set: set });
    res.json({ success: true });
  } catch (err) {
    console.error("saveProgress:", err);
    res.json({ success: true }); // never fail autosave
  }
};

/*
 * Pure scorer — grades a saved attempt. Shared by the live submit path AND the
 * server-side timeout auto-submit so both grade identically.
 *
 * Two kinds of question, and the difference is the whole point:
 *
 *   Gradable now   MCQs, and typed answers whose text matches the expected
 *                  output exactly. Marked here, COMPLETED, marks awarded.
 *
 *   Needs reading  Open-ended answers, and typed answers that did not match.
 *                  Left PENDING with marks 0 and counted into `pendingMarks`.
 *
 * PENDING IS NOT WRONG. A pending row scores 0 only because nobody has read it
 * yet, so `score` must be understood as "of what has been graded" — never as a
 * final mark. Treating the two as the same is how a candidate ends up rejected
 * by a cutoff on a paper that was never evaluated.
 *
 * An unanswered open question needs no evaluator: nothing to read is 0.
 */
function scoreAttempt(qids, qmap, answers, optionOrder, sections) {
  let score = 0, totalMarks = 0, pendingMarks = 0;
  const sectionScores = {};
  (sections || []).forEach(s => { sectionScores[s.name] = 0; });
  const norm = s => String(s ?? "").trim().toLowerCase().replace(/\s+/g, " ");
  const answerSheet = [];
  (qids || []).forEach(qid => {
    const q = qmap[qid];
    if (!q) return;
    const max = q.marks || 1;
    totalMarks += max;
    const ans = answers[qid];
    const answered = ans != null && ans !== "";
    const correctAns = q.type === "text" ? (q.answerText ?? null) : (q.options?.[q.correctIndex] ?? null);
    let correct = false, given = null, evalStatus = "COMPLETED", marks = 0;

    if (q.type === "text") {
      given = answered ? String(ans) : null;
      // Exact match first: a crisp expected output ("[1, 2, 3, 4]", "False") is
      // graded here and for free. Only what it cannot settle goes to a reader.
      const exact = answered && q.answerText != null && norm(ans) === norm(q.answerText);
      if (exact) { correct = true; marks = max; }
      else if (answered) { evalStatus = "PENDING"; pendingMarks += max; }
      // Unanswered stays COMPLETED at 0 — there is nothing for anyone to read.
    } else if (answered) {
      const origIdx = (optionOrder[qid] || [])[ans];
      given = origIdx != null && q.options ? (q.options[origIdx] ?? null) : null;
      correct = origIdx === q.correctIndex;
      if (correct) marks = max;
    }

    if (marks) {
      score += marks;
      sectionScores[q.section] = (sectionScores[q.section] || 0) + marks;
    }
    answerSheet.push({ qid, section: q.section, given, correct: correctAns,
      isCorrect: correct, marks, maxMarks: max, evalStatus });
  });
  const evaluationStatus = answerSheet.some(r => r.evalStatus === "PENDING") ? "PENDING" : "COMPLETED";
  return { score, totalMarks, pendingMarks, sectionScores, answerSheet, evaluationStatus };
}

/*
 * Recompute a paper's totals FROM ITS OWN ROWS.
 *
 * The only place a total is ever produced. A client never submits a score, and
 * an evaluator only ever writes one row — the total is derived here so a bad or
 * replayed evaluation cannot inflate a result.
 */
function recomputeTotals(candidate) {
  const rows = candidate.answerSheet || [];
  let score = 0, totalMarks = 0, pendingMarks = 0;
  const sectionScores = {};
  let anyPending = false, anyProcessing = false, anyFailed = false;
  rows.forEach(r => {
    const max = r.maxMarks || 1;
    totalMarks += max;
    score += r.marks || 0;
    sectionScores[r.section] = (sectionScores[r.section] || 0) + (r.marks || 0);
    if (r.evalStatus === "PENDING")    { anyPending = true;    pendingMarks += max; }
    if (r.evalStatus === "PROCESSING") { anyProcessing = true; pendingMarks += max; }
    if (r.evalStatus === "FAILED")     { anyFailed = true;     pendingMarks += max; }
  });
  // FAILED outranks PENDING: it needs a human, not more waiting.
  const evaluationStatus = anyFailed ? "FAILED"
    : anyPending ? "PENDING"
    : anyProcessing ? "PROCESSING"
    : "COMPLETED";
  return { score, totalMarks, pendingMarks, sectionScores, evaluationStatus };
}

exports._recomputeTotals = recomputeTotals;   // used by the evaluation worker API
exports._scoreAttempt = scoreAttempt;         // exported so the scoring rules can be tested directly

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

    const { answers = {}, timedOut = false, reason, violations, terminationReason, refreshCount } = req.body || {};
    if (Number.isInteger(refreshCount)) c.refreshCount = Math.max(c.refreshCount || 0, refreshCount);

    const optionOrder = c.progress.optionOrder instanceof Map
      ? Object.fromEntries(c.progress.optionOrder) : (c.progress.optionOrder || {});
    const qids = c.progress.questionOrder;
    const docs = await Question.find({ _id: { $in: qids } }).lean();
    const qmap = {};
    docs.forEach(q => { qmap[String(q._id)] = q; });

    const { score, totalMarks, pendingMarks, sectionScores, answerSheet, evaluationStatus } =
      scoreAttempt(qids, qmap, answers, optionOrder, assessment.sections);

    // With marks still unread, "passed" cannot be decided yet — a paper awaiting
    // an evaluator would otherwise fail on a partial score.
    const passed = evaluationStatus === "COMPLETED" && score >= (assessment.passingScore || 0);
    const elapsed = c.startedAt
      ? Math.floor((now() - new Date(c.startedAt).getTime()) / 1000) : 0;

    if (violations && typeof violations === "object") {
      c.violations = mergeViolations(c.violations, violations);
    }

    // Disqualification (auto-terminate on malpractice) vs normal completion.
    const disqualified = reason === "auto-malpractice";
    c.status = disqualified ? "disqualified" : "completed";
    // Mirror onto the round vocabulary (new architecture only). Qualification is
    // NOT decided here — that is the round cutoff's job.
    if (c.roundId) c.roundStatus = disqualified ? "REJECTED" : "COMPLETED";
    c.submissionReason = disqualified ? "disqualified" : (timedOut ? "timed-out" : "manual");
    if (disqualified) c.terminationReason = String(terminationReason || "Assessment guidelines violated").slice(0, 200);
    c.completedAt = new Date();
    c.score = score;
    c.totalMarks = totalMarks;
    c.pendingMarks = pendingMarks;
    c.evaluationStatus = evaluationStatus;
    if (evaluationStatus === "COMPLETED") c.evaluatedAt = new Date();
    c.passed = disqualified ? false : passed;
    c.sectionScores = sectionScores;
    c.timeTakenSeconds = elapsed;
    c.answerSheet = answerSheet;   // kept for the admin per-question answer view
    c.progress = undefined; // free the in-flight snapshot
    // Queue the completion email (thank-you if completed, termination if disqualified).
    // Queued + retried by the scheduler so a transient failure never loses it.
    c.completionEmail = { status: "pending", scheduledAt: new Date(), attempts: 0 };
    await c.save();

    // Attempt delivery immediately (does not block the response); scheduler retries on failure.
    setImmediate(() => flushNow(50).catch(() => {}));

    res.json({ success: true, disqualified, data: { name: c.name } }); // no score leaked to candidate
  } catch (err) {
    console.error("submitCandidate:", err);
    res.status(500).json({ success: false, message: "Submission failed. Please try again." });
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// Server-side timeout auto-submit (safety net).
//
// If a student's own time runs out but their browser never fires the submit
// (laptop closed, network drop, tab crash), they used to stay stuck "in-progress"
// forever — the admin sees "⏳ Time up" and no marks. This scheduler finds those
// candidates, grades their last saved answers, and finalizes them as completed
// (submissionReason: "timed-out"). Runs on every instance; a single atomic
// findOneAndUpdate ensures only one instance finalizes each candidate.
// ─────────────────────────────────────────────────────────────────────────────
let autoSubmitTimer = null;
const AUTO_SUBMIT_GRACE_S = 60; // give the client's own submit a minute to land first

async function autoSubmitTimedOut() {
  const cs = await Candidate.find({
    status: { $in: ["in-progress", "started"] },
    startedAt: { $ne: null },
    "progress.questionOrder.0": { $exists: true },
  }).limit(500);
  if (!cs.length) return;

  const asmtCache = {};
  for (const c of cs) {
    try {
      const aId = String(c.assessmentId);
      if (!(aId in asmtCache)) asmtCache[aId] = await Assessment.findById(aId).lean();
      const a = asmtCache[aId];
      if (!a) continue;

      const limitS = (a.durationMinutes || 40) * 60 + AUTO_SUBMIT_GRACE_S;
      const elapsed = Math.floor((now() - new Date(c.startedAt).getTime()) / 1000);
      if (elapsed < limitS) continue; // time not up yet (with grace)

      const answers = c.progress?.answers instanceof Map
        ? Object.fromEntries(c.progress.answers) : (c.progress?.answers || {});
      const optionOrder = c.progress?.optionOrder instanceof Map
        ? Object.fromEntries(c.progress.optionOrder) : (c.progress?.optionOrder || {});
      const qids = c.progress?.questionOrder || [];
      const docs = await Question.find({ _id: { $in: qids } }).lean();
      const qmap = {}; docs.forEach(q => { qmap[String(q._id)] = q; });

      const { score, totalMarks, pendingMarks, sectionScores, answerSheet, evaluationStatus } =
        scoreAttempt(qids, qmap, answers, optionOrder, a.sections);
      const passed = evaluationStatus === "COMPLETED" && score >= (a.passingScore || 0);

      // Atomic claim + finalize: the status condition means only ONE instance wins.
      const upd = await Candidate.findOneAndUpdate(
        { _id: c._id, status: { $in: ["in-progress", "started"] } },
        {
          $set: {
            status: "completed", submissionReason: "timed-out", completedAt: new Date(),
            score, totalMarks, passed, sectionScores, timeTakenSeconds: elapsed, answerSheet,
            pendingMarks, evaluationStatus,
            ...(evaluationStatus === "COMPLETED" ? { evaluatedAt: new Date() } : {}),
          },
          $unset: { progress: "" },
        },
        { new: true }
      );
      if (upd) console.log(`[auto-submit] timed-out candidate ${c._id} finalized (${score}/${totalMarks}).`);
    } catch (e) {
      console.warn(`[auto-submit] failed for ${c._id}:`, e.message);
    }
  }
}

function startTimeoutAutoSubmitScheduler() {
  if (autoSubmitTimer) return;
  autoSubmitTimer = setInterval(() => { autoSubmitTimedOut().catch(() => {}); }, 60 * 1000);
  autoSubmitTimer.unref?.();
  console.log("[auto-submit] timed-out auto-submit scheduler started (every 60s).");
}
exports.startTimeoutAutoSubmitScheduler = startTimeoutAutoSubmitScheduler;
