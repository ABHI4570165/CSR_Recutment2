const mongoose = require("mongoose");
const Round = require("../models/Round");
const Candidate = require("../models/Candidate");
const CandidateApplication = require("../models/CandidateApplication");
const Student = require("../models/Student");
const {
  RuleError, nextRound, previousRound, isFinalRound,
  assertEligible, ensureParticipation, decideQualified, recomputeApplication,
} = require("../utils/recruitment");

/* =====================================================================
 *  ROUND OPERATIONS — assignment, dashboard, cutoff, advancement.
 *  Every one of these works for round 1 or round 10 without change.
 * ===================================================================== */

const fail = (res, err, fallback) => {
  if (err instanceof RuleError) return res.status(err.status).json({ success: false, message: err.message, ...err });
  console.error(fallback + ":", err);
  return res.status(500).json({ success: false, message: `Failed to ${fallback}.` });
};

// GET /api/rounds/:roundId/dashboard
exports.roundDashboard = async (req, res) => {
  try {
    const r = req.round;
    const agg = await Candidate.aggregate([
      { $match: { roundId: r._id, isPrimary: true } },
      { $group: { _id: { s: "$roundStatus", q: "$qualification" }, n: { $sum: 1 } } },
    ]);
    const sum = (fn) => agg.filter(fn).reduce((t, x) => t + x.n, 0);
    const [prev, nxt, final] = await Promise.all([previousRound(r), nextRound(r), isFinalRound(r)]);

    res.json({ success: true, data: {
      round: { _id: r._id, name: r.name, sequence: r.sequence, roundType: r.roundType, status: r.status, cutoff: r.cutoff },
      previousRound: prev ? { _id: prev._id, name: prev.name, sequence: prev.sequence } : null,
      nextRound: nxt ? { _id: nxt._id, name: nxt.name, sequence: nxt.sequence } : null,
      isFinalRound: final,
      stats: {
        eligible:     sum(() => true),
        started:      sum(x => x._id.s === "IN_PROGRESS"),
        completed:    sum(x => ["COMPLETED", "QUALIFIED", "REJECTED"].includes(x._id.s)),
        qualified:    sum(x => x._id.q === "QUALIFIED"),
        rejected:     sum(x => x._id.q === "REJECTED"),
        pending:      sum(x => x._id.q === "PENDING"),
        notAttempted: sum(x => ["NOT_STARTED", "NOT_ATTEMPTED"].includes(x._id.s)),
      },
    }});
  } catch (err) { fail(res, err, "load round dashboard"); }
};

// GET /api/rounds/:roundId/candidates?page=&search=&status=&qualification=
exports.roundCandidates = async (req, res) => {
  try {
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const limit = Math.min(1000, parseInt(req.query.limit) || 20);
    const filter = { roundId: req.round._id, isPrimary: true, workspaceId: req.workspaceId };
    if (req.query.roundStatus) filter.roundStatus = req.query.roundStatus;
    if (req.query.qualification) filter.qualification = req.query.qualification;
    if (req.query.search) {
      const re = new RegExp(String(req.query.search).trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
      filter.$or = [{ name: re }, { email: re }, { college: re }, { phone: re }];
    }
    const [rows, total] = await Promise.all([
      Candidate.find(filter)
        .select("name email college phone course branch applicationId studentId roundStatus qualification score totalMarks startedAt completedAt violations status override")
        .sort({ score: -1, createdAt: 1 }).skip((page - 1) * limit).limit(limit).lean(),
      Candidate.countDocuments(filter),
    ]);
    res.json({ success: true, data: rows.map(c => ({
      ...c,
      percentage: (c.score != null && c.totalMarks) ? Math.round((c.score / c.totalMarks) * 1000) / 10 : null,
    })), pagination: { page, limit, total, pages: Math.ceil(total / limit) } });
  } catch (err) { fail(res, err, "load round candidates"); }
};

// POST /api/rounds/:roundId/assign   { applicationIds:[…] }  or  { all:true }
// Creates the participation rows that let candidates into this round.
// Eligibility is re-checked per candidate — assignment can never bypass a cutoff.
exports.assignCandidates = async (req, res) => {
  try {
    const round = req.round;
    let apps;
    if (req.body?.all) {
      const prev = await previousRound(round);
      if (!prev || !round.requiresPreviousQualification) {
        apps = await CandidateApplication.find({ driveId: round.driveId, overallStatus: { $ne: "REJECTED" } });
      } else {
        const qualified = await Candidate.find({ roundId: prev._id, isPrimary: true, qualification: "QUALIFIED" })
          .distinct("applicationId");
        apps = await CandidateApplication.find({ _id: { $in: qualified } });
      }
    } else {
      const ids = (req.body?.applicationIds || []).filter(id => mongoose.isValidObjectId(id));
      if (!ids.length) return res.status(400).json({ success: false, message: "No candidates selected." });
      apps = await CandidateApplication.find({ _id: { $in: ids }, driveId: round.driveId, workspaceId: req.workspaceId });
    }

    let assigned = 0, already = 0, blocked = 0;
    const blockedList = [];
    for (const app of apps) {
      try {
        await assertEligible(app, round, { ignoreRoundStatus: true });
      } catch (e) {
        blocked++; if (blockedList.length < 10) blockedList.push({ name: app._id, reason: e.message });
        continue;
      }
      const exists = await Candidate.exists({ applicationId: app._id, roundId: round._id, isPrimary: true });
      if (exists) { already++; continue; }
      await ensureParticipation(app, round, { assignedBy: req.admin?.username || "admin" });
      await recomputeApplication(app._id);
      assigned++;
    }
    res.json({ success: true, data: { requested: apps.length, assigned, alreadyAssigned: already, blocked, blockedList } });
  } catch (err) { fail(res, err, "assign candidates"); }
};

// POST /api/rounds/:roundId/cutoff/preview   — decides, writes NOTHING
exports.previewCutoff = async (req, res) => {
  try {
    const round = req.round;
    const method = req.body?.method || round.cutoff?.method || "NONE";
    const value = req.body?.value != null ? Number(req.body.value) : round.cutoff?.value;
    if (method === "NONE") return res.status(400).json({ success: false, message: "Choose a cutoff method first." });

    const parts = await Candidate.find({ roundId: round._id, isPrimary: true })
      .select("name email college score totalMarks roundStatus qualification timeTakenSeconds applicationId").lean();
    const { qualified, considered } = decideQualified(
      { ...round.toObject(), cutoff: { method, value } }, parts, req.body?.applicationIds);

    const decided = parts.map(p => ({
      _id: p._id, applicationId: p.applicationId, name: p.name, email: p.email, college: p.college,
      score: p.score, totalMarks: p.totalMarks,
      percentage: (p.score != null && p.totalMarks) ? Math.round((p.score / p.totalMarks) * 1000) / 10 : null,
      roundStatus: p.roundStatus,
      willQualify: qualified.has(String(p._id)),
    })).sort((a, b) => (b.score ?? -1) - (a.score ?? -1));

    res.json({ success: true, data: {
      method, value, considered,
      willQualify: decided.filter(d => d.willQualify).length,
      willReject: decided.filter(d => !d.willQualify && ["COMPLETED", "QUALIFIED", "REJECTED"].includes(d.roundStatus)).length,
      notAttempted: decided.filter(d => ["NOT_STARTED", "NOT_ATTEMPTED"].includes(d.roundStatus)).length,
      candidates: decided,
    }});
  } catch (err) { fail(res, err, "preview cutoff"); }
};

// POST /api/rounds/:roundId/cutoff/apply — WRITES the qualification decision
exports.applyCutoff = async (req, res) => {
  try {
    const round = req.round;
    const method = req.body?.method || round.cutoff?.method || "NONE";
    const value = req.body?.value != null ? Number(req.body.value) : round.cutoff?.value;
    if (method === "NONE") return res.status(400).json({ success: false, message: "Choose a cutoff method first." });

    const parts = await Candidate.find({ roundId: round._id, isPrimary: true });
    const { qualified } = decideQualified(
      { ...round.toObject(), cutoff: { method, value } },
      parts.map(p => p.toObject()), req.body?.applicationIds);

    let q = 0, rj = 0, skipped = 0;
    for (const p of parts) {
      // A manual override is never silently undone by re-running a cutoff.
      if (p.qualificationSource === "MANUAL_OVERRIDE") { skipped++; continue; }
      const isQ = qualified.has(String(p._id));
      const attempted = ["COMPLETED", "QUALIFIED", "REJECTED"].includes(p.roundStatus);
      if (!attempted && !isQ) { p.qualification = "REJECTED"; p.roundStatus = p.roundStatus === "NOT_STARTED" ? "NOT_ATTEMPTED" : p.roundStatus; }
      else { p.qualification = isQ ? "QUALIFIED" : "REJECTED"; p.roundStatus = isQ ? "QUALIFIED" : "REJECTED"; }
      p.qualificationSource = "CUTOFF";
      p.cutoffAtDecision = value ?? null;
      p.decidedAt = new Date();
      await p.save();
      isQ ? q++ : rj++;
    }
    round.cutoff = { method, value: value ?? null, appliedAt: new Date(), appliedBy: req.admin?.username || "admin" };
    await round.save();

    // Roll the decision up into each application's overall status.
    const appIds = [...new Set(parts.map(p => String(p.applicationId)))];
    for (const id of appIds) await recomputeApplication(id);

    res.json({ success: true, data: { qualified: q, rejected: rj, skippedOverridden: skipped, method, value } });
  } catch (err) { fail(res, err, "apply cutoff"); }
};

// POST /api/rounds/:roundId/advance — create participations in the NEXT round
// for everyone who qualified here. Idempotent; sequence-driven; never assumes
// which round comes next or what it is called.
exports.advance = async (req, res) => {
  try {
    const round = req.round;
    const nxt = await nextRound(round);
    if (!nxt) return res.status(400).json({ success: false, message: "This is the final round — use Final Selection." });

    const qualified = await Candidate.find({ roundId: round._id, isPrimary: true, qualification: "QUALIFIED" })
      .select("applicationId").lean();
    const appIds = [...new Set(qualified.map(q => String(q.applicationId)))];
    const apps = await CandidateApplication.find({ _id: { $in: appIds } });

    let advanced = 0, already = 0;
    for (const app of apps) {
      const exists = await Candidate.exists({ applicationId: app._id, roundId: nxt._id, isPrimary: true });
      if (exists) { already++; continue; }
      await ensureParticipation(app, nxt, { assignedBy: req.admin?.username || "admin" });
      await recomputeApplication(app._id);
      advanced++;
    }
    res.json({ success: true, data: {
      fromRound: round.name, toRound: nxt.name, toRoundId: nxt._id,
      qualified: appIds.length, advanced, alreadyThere: already,
    }});
  } catch (err) { fail(res, err, "advance candidates"); }
};

// POST /api/rounds/:roundId/results   { results:[{applicationId, score, totalMarks, notes}] }
// Manual result entry for INTERVIEW / GD / HR / MANUAL_EVALUATION rounds.
exports.recordManualResults = async (req, res) => {
  try {
    const round = req.round;
    if (Round.usesEngine(round.roundType)) {
      return res.status(400).json({ success: false, message: "This round is scored by the test engine — results cannot be typed in." });
    }
    const rows = Array.isArray(req.body?.results) ? req.body.results : [];
    if (!rows.length) return res.status(400).json({ success: false, message: "No results supplied." });

    let saved = 0;
    for (const r of rows) {
      if (!mongoose.isValidObjectId(r.applicationId)) continue;
      const app = await CandidateApplication.findOne({ _id: r.applicationId, driveId: round.driveId, workspaceId: req.workspaceId });
      if (!app) continue;
      try { await assertEligible(app, round, { ignoreRoundStatus: true }); } catch { continue; }

      const p = await ensureParticipation(app, round, { assignedBy: req.admin?.username || "admin" });
      if (r.score != null) p.score = Number(r.score);
      if (r.totalMarks != null) p.totalMarks = Number(r.totalMarks);
      p.roundStatus = "COMPLETED";
      p.status = "completed";
      p.completedAt = new Date();
      if (r.notes) p.reviewReason = String(r.notes).slice(0, 500);
      await p.save();
      saved++;
    }
    res.json({ success: true, data: { saved } });
  } catch (err) { fail(res, err, "record results"); }
};

// PATCH /api/participations/:id/override   { to:"QUALIFIED"|"REJECTED", reason }
// The automatic decision is preserved in override.from — never overwritten.
exports.overrideQualification = async (req, res) => {
  try {
    const p = req.participation;
    const to = req.body?.to;
    const reason = String(req.body?.reason || "").trim();
    if (!["QUALIFIED", "REJECTED"].includes(to)) {
      return res.status(400).json({ success: false, message: "Choose QUALIFIED or REJECTED." });
    }
    if (!reason) return res.status(400).json({ success: false, message: "A reason is required for a manual override." });

    p.override = {
      from: p.qualification || "PENDING", to,
      by: req.admin?.username || "admin", at: new Date(), reason,
    };
    p.qualification = to;
    p.roundStatus = to;
    p.qualificationSource = "MANUAL_OVERRIDE";
    p.decidedAt = new Date();
    await p.save();
    const app = await recomputeApplication(p.applicationId);
    res.json({ success: true, data: { participation: p, application: app } });
  } catch (err) { fail(res, err, "override qualification"); }
};
