const mongoose = require("mongoose");
const Drive = require("../models/Drive");
const Round = require("../models/Round");
const Assessment = require("../models/Assessment");
const Candidate = require("../models/Candidate");
const CandidateApplication = require("../models/CandidateApplication");
const { roundsOf, ensureRoundAssessment } = require("../utils/recruitment");

/* =====================================================================
 *  DRIVES — a recruitment campaign inside a workspace.
 *  ROUNDS — created dynamically under a drive. Any number, any names.
 * ===================================================================== */

const slugify = (s) => String(s || "").toLowerCase().trim()
  .replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60);

/* =====================================================================
 *  THE WORKSPACE'S RECRUITMENT PROCESS
 *
 *  A workspace runs ONE recruitment process made of sequential rounds. The
 *  Drive document is the internal container that process needs (the quiz engine
 *  and every existing query hang off driveId), but it is never shown to the
 *  admin: there is exactly one per workspace, created on demand, and the UI
 *  speaks only of Workspace → Rounds.
 * ===================================================================== */
async function getProcessDrive(workspaceId, { create = false, createdBy = "" } = {}) {
  // The oldest drive in the workspace IS the process — this keeps working for
  // workspaces that already have one (including the migrated company).
  let drive = await Drive.findOne({ workspaceId }).sort({ createdAt: 1 });
  if (!drive && create) {
    drive = await Drive.create({
      workspaceId, name: "Recruitment Process", slug: "recruitment-process",
      status: "ACTIVE", createdBy,
    });
  }
  return drive;
}
exports.getProcessDrive = getProcessDrive;

// GET /api/rounds — every round of this workspace, in sequence order.
exports.listWorkspaceRounds = async (req, res) => {
  try {
    const drive = await getProcessDrive(req.workspaceId);
    if (!drive) return res.json({ success: true, data: [] });   // nothing configured yet

    const rounds = await roundsOf(drive._id);
    const driveCounts = await Assessment.aggregate([
      { $match: { workspaceId: req.workspaceId, isTest: { $ne: true } } },
      { $group: { _id: "$roundId", n: { $sum: 1 } } },
    ]);
    const dc = {}; driveCounts.forEach(x => { dc[String(x._id)] = x.n; });

    const stats = await Candidate.aggregate([
      { $match: { driveId: drive._id, isPrimary: true } },
      { $group: {
        _id: "$roundId",
        total:     { $sum: 1 },
        attended:  { $sum: { $cond: [{ $in: ["$roundStatus", ["IN_PROGRESS", "COMPLETED", "QUALIFIED", "REJECTED"]] }, 1, 0] } },
        qualified: { $sum: { $cond: [{ $eq: ["$qualification", "QUALIFIED"] }, 1, 0] } },
        rejected:  { $sum: { $cond: [{ $eq: ["$qualification", "REJECTED"] }, 1, 0] } },
      } },
    ]);
    const m = {}; stats.forEach(s => { m[String(s._id)] = s; });

    res.json({ success: true, data: rounds.map(r => ({
      ...r,
      driveCount: dc[String(r._id)] || 0,
      eligible:  m[String(r._id)]?.total || 0,
      attended:  m[String(r._id)]?.attended || 0,
      qualified: m[String(r._id)]?.qualified || 0,
      rejected:  m[String(r._id)]?.rejected || 0,
    })) });
  } catch (err) {
    console.error("listWorkspaceRounds:", err.message);
    res.status(500).json({ success: false, message: "Failed to load rounds." });
  }
};

// POST /api/rounds — add the next stage to this workspace's process.
exports.createWorkspaceRound = async (req, res) => {
  try {
    const b = req.body || {};
    const name = String(b.name || "").trim();
    if (!name) return res.status(400).json({ success: false, message: "Round name is required." });

    const drive = await getProcessDrive(req.workspaceId, { create: true, createdBy: req.admin?.username || "" });
    const existing = await roundsOf(drive._id);
    const sequence = existing.length ? existing[existing.length - 1].sequence + 1 : 1;

    const round = await Round.create({
      workspaceId: req.workspaceId,
      driveId: drive._id,
      name,
      sequence,
      roundType: Round.ROUND_TYPES.includes(b.roundType) ? b.roundType : "TEST",
      description: String(b.description || "").trim(),
      status: b.status === "ACTIVE" ? "ACTIVE" : "DRAFT",
      cutoff: {
        method: Round.CUTOFF_METHODS.includes(b.cutoffMethod) ? b.cutoffMethod : "NONE",
        value: b.cutoffValue != null && b.cutoffValue !== "" ? Number(b.cutoffValue) : null,
      },
      // Round 1 is open to everyone; every later stage admits only the
      // candidates who qualified the stage before it.
      requiresPreviousQualification: sequence > 1,
    });
    await ensureRoundAssessment(round, drive);
    res.status(201).json({ success: true, data: round });
  } catch (err) {
    if (err.code === 11000) return res.status(409).json({ success: false, message: "That round position is taken. Reload and try again." });
    console.error("createWorkspaceRound:", err.message);
    res.status(500).json({ success: false, message: "Failed to create round." });
  }
};

// ── Drives (internal — no longer surfaced in the admin UI) ───────────────────

// GET /api/drives
exports.listDrives = async (req, res) => {
  try {
    const filter = { workspaceId: req.workspaceId };
    if (req.query.status) filter.status = req.query.status;

    const drives = await Drive.find(filter).sort({ createdAt: -1 }).lean();
    const ids = drives.map(d => d._id);
    const [roundAgg, appAgg] = await Promise.all([
      Round.aggregate([{ $match: { driveId: { $in: ids } } }, { $group: { _id: "$driveId", n: { $sum: 1 } } }]),
      CandidateApplication.aggregate([{ $match: { driveId: { $in: ids } } }, { $group: { _id: "$driveId", n: { $sum: 1 } } }]),
    ]);
    const rm = {}; roundAgg.forEach(r => { rm[String(r._id)] = r.n; });
    const am = {}; appAgg.forEach(a => { am[String(a._id)] = a.n; });

    res.json({ success: true, data: drives.map(d => ({
      ...d, roundCount: rm[String(d._id)] || 0, candidateCount: am[String(d._id)] || 0,
    })) });
  } catch (err) {
    console.error("listDrives:", err);
    res.status(500).json({ success: false, message: "Failed to load drives." });
  }
};

// POST /api/drives   { name, description, role, rounds:[{name, roundType, cutoff…}] }
exports.createDrive = async (req, res) => {
  try {
    const b = req.body || {};
    const name = String(b.name || "").trim();
    if (!name) return res.status(400).json({ success: false, message: "Drive name is required." });

    let slug = slugify(b.slug || name);
    let n = 1;
    while (await Drive.exists({ workspaceId: req.workspaceId, slug })) slug = `${slugify(name)}-${++n}`;

    const drive = await Drive.create({
      workspaceId: req.workspaceId,
      name,
      description: String(b.description || "").trim(),
      role: String(b.role || "").trim(),
      slug,
      status: b.status === "ACTIVE" ? "ACTIVE" : "DRAFT",
      startDate: b.startDate || undefined,
      endDate: b.endDate || undefined,
      createdBy: req.admin?.username || "",
    });

    // Optional: create the rounds in the same request. Sequence follows the
    // order the admin listed them in — no name is ever interpreted.
    const created = [];
    const list = Array.isArray(b.rounds) ? b.rounds : [];
    for (let i = 0; i < list.length; i++) {
      const r = list[i] || {};
      const rName = String(r.name || "").trim();
      if (!rName) continue;
      const round = await Round.create({
        workspaceId: req.workspaceId,
        driveId: drive._id,
        name: rName,
        sequence: i + 1,
        roundType: Round.ROUND_TYPES.includes(r.roundType) ? r.roundType : "TEST",
        status: "DRAFT",
        description: String(r.description || "").trim(),
        cutoff: {
          method: Round.CUTOFF_METHODS.includes(r.cutoffMethod) ? r.cutoffMethod : "NONE",
          value: r.cutoffValue != null && r.cutoffValue !== "" ? Number(r.cutoffValue) : null,
        },
        // The FIRST round never requires a previous qualification; later rounds do.
        requiresPreviousQualification: i > 0,
      });
      // Give the round its own test container so it is ready to configure.
      await ensureRoundAssessment(round, drive);
      created.push(round);
    }

    res.status(201).json({ success: true, data: { drive, rounds: created } });
  } catch (err) {
    if (err.code === 11000) return res.status(409).json({ success: false, message: "A drive with that name already exists in this workspace." });
    console.error("createDrive:", err);
    res.status(500).json({ success: false, message: "Failed to create drive." });
  }
};

// GET /api/drives/:driveId   — drive + its rounds, in sequence order
exports.getDrive = async (req, res) => {
  try {
    const rounds = await roundsOf(req.drive._id);
    const counts = await Candidate.aggregate([
      { $match: { driveId: req.drive._id, isPrimary: true } },
      { $group: { _id: "$roundId", n: { $sum: 1 } } },
    ]);
    const cm = {}; counts.forEach(c => { cm[String(c._id)] = c.n; });
    res.json({ success: true, data: {
      drive: req.drive,
      rounds: rounds.map(r => ({ ...r, participantCount: cm[String(r._id)] || 0 })),
    }});
  } catch (err) {
    console.error("getDrive:", err);
    res.status(500).json({ success: false, message: "Failed to load drive." });
  }
};

// PUT /api/drives/:driveId
exports.updateDrive = async (req, res) => {
  try {
    const b = req.body || {};
    ["name", "description", "role"].forEach(k => { if (b[k] != null) req.drive[k] = String(b[k]).trim(); });
    if (b.status && ["DRAFT", "ACTIVE", "COMPLETED", "ARCHIVED"].includes(b.status)) req.drive.status = b.status;
    if (b.startDate !== undefined) req.drive.startDate = b.startDate || undefined;
    if (b.endDate !== undefined) req.drive.endDate = b.endDate || undefined;
    if (b.publishSelection != null) req.drive.publishSelection = !!b.publishSelection;
    await req.drive.save();
    res.json({ success: true, data: req.drive });
  } catch (err) {
    console.error("updateDrive:", err);
    res.status(500).json({ success: false, message: "Failed to update drive." });
  }
};

// DELETE /api/drives/:driveId — only while empty. Never destroys results.
exports.deleteDrive = async (req, res) => {
  try {
    const apps = await CandidateApplication.countDocuments({ driveId: req.drive._id });
    if (apps > 0) {
      return res.status(409).json({ success: false,
        message: `This drive has ${apps} candidate(s). Archive it instead — deleting would destroy their results.` });
    }
    await Assessment.deleteMany({ driveId: req.drive._id, isTest: true });
    await Round.deleteMany({ driveId: req.drive._id });
    await Drive.deleteOne({ _id: req.drive._id });
    res.json({ success: true, message: "Drive deleted." });
  } catch (err) {
    console.error("deleteDrive:", err);
    res.status(500).json({ success: false, message: "Failed to delete drive." });
  }
};

/* =====================================================================
 *  ROUNDS
 * ===================================================================== */

// GET /api/drives/:driveId/rounds
exports.listRounds = async (req, res) => {
  try {
    const rounds = await roundsOf(req.drive._id);
    const counts = await Candidate.aggregate([
      { $match: { driveId: req.drive._id, isPrimary: true } },
      { $group: { _id: "$roundId", n: { $sum: 1 }, qualified: { $sum: { $cond: [{ $eq: ["$qualification", "QUALIFIED"] }, 1, 0] } } } },
    ]);
    const cm = {}; counts.forEach(c => { cm[String(c._id)] = c; });
    res.json({ success: true, data: rounds.map(r => ({
      ...r,
      participantCount: cm[String(r._id)]?.n || 0,
      qualifiedCount: cm[String(r._id)]?.qualified || 0,
    })) });
  } catch (err) {
    console.error("listRounds:", err);
    res.status(500).json({ success: false, message: "Failed to load rounds." });
  }
};

// POST /api/drives/:driveId/rounds   { name, roundType, cutoffMethod, cutoffValue, insertAfterSequence? }
exports.createRound = async (req, res) => {
  try {
    const b = req.body || {};
    const name = String(b.name || "").trim();
    if (!name) return res.status(400).json({ success: false, message: "Round name is required." });

    const existing = await roundsOf(req.drive._id);
    let sequence;
    if (b.insertAfterSequence != null) {
      const after = Number(b.insertAfterSequence);
      // Shift everything after the insertion point down by one.
      const toShift = existing.filter(r => r.sequence > after);
      for (const r of [...toShift].reverse()) {
        await Round.updateOne({ _id: r._id }, { $set: { sequence: r.sequence + 1 } });
      }
      sequence = after + 1;
    } else {
      sequence = existing.length ? existing[existing.length - 1].sequence + 1 : 1;
    }

    const round = await Round.create({
      workspaceId: req.workspaceId,
      driveId: req.drive._id,
      name,
      sequence,
      roundType: Round.ROUND_TYPES.includes(b.roundType) ? b.roundType : "TEST",
      description: String(b.description || "").trim(),
      status: "DRAFT",
      cutoff: {
        method: Round.CUTOFF_METHODS.includes(b.cutoffMethod) ? b.cutoffMethod : "NONE",
        value: b.cutoffValue != null && b.cutoffValue !== "" ? Number(b.cutoffValue) : null,
      },
      requiresPreviousQualification: sequence > 1 ? (b.requiresPreviousQualification !== false) : false,
      assignmentMode: b.assignmentMode === "MANUAL_ASSIGN" ? "MANUAL_ASSIGN" : "AUTO_QUALIFIED",
    });
    await ensureRoundAssessment(round, req.drive);
    res.status(201).json({ success: true, data: round });
  } catch (err) {
    if (err.code === 11000) return res.status(409).json({ success: false, message: "That round position is already taken. Reload and try again." });
    console.error("createRound:", err);
    res.status(500).json({ success: false, message: "Failed to create round." });
  }
};

// PUT /api/drives/:driveId/rounds/:roundId
exports.updateRound = async (req, res) => {
  try {
    const b = req.body || {};
    const round = req.round;

    // Renaming is ALWAYS safe — no logic anywhere reads a round's name.
    if (b.name != null) {
      const nm = String(b.name).trim();
      if (!nm) return res.status(400).json({ success: false, message: "Round name cannot be empty." });
      round.name = nm;
    }
    if (b.description != null) round.description = String(b.description).trim();

    const hasAttempts = await Candidate.exists({
      roundId: round._id, roundStatus: { $in: ["IN_PROGRESS", "COMPLETED", "QUALIFIED", "REJECTED"] },
    });

    // Type changes are blocked once results exist — scoring semantics would shift.
    if (b.roundType && b.roundType !== round.roundType) {
      if (hasAttempts) return res.status(409).json({ success: false, message: "Attempts already exist in this round — its type can no longer change." });
      if (Round.ROUND_TYPES.includes(b.roundType)) round.roundType = b.roundType;
    }
    if (b.status && ["DRAFT", "ACTIVE", "CLOSED"].includes(b.status)) round.status = b.status;
    if (b.cutoffMethod && Round.CUTOFF_METHODS.includes(b.cutoffMethod)) round.cutoff.method = b.cutoffMethod;
    if (b.cutoffValue !== undefined) round.cutoff.value = b.cutoffValue === "" || b.cutoffValue == null ? null : Number(b.cutoffValue);
    if (b.requiresPreviousQualification != null && round.sequence > 1) {
      round.requiresPreviousQualification = !!b.requiresPreviousQualification;
    }
    if (b.assignmentMode) round.assignmentMode = b.assignmentMode === "MANUAL_ASSIGN" ? "MANUAL_ASSIGN" : "AUTO_QUALIFIED";
    if (b.assessmentId !== undefined) {
      if (b.assessmentId === null) round.assessmentId = null;
      else {
        const a = await Assessment.findOne({ _id: b.assessmentId, workspaceId: req.workspaceId });
        if (!a) return res.status(404).json({ success: false, message: "Test not found in this workspace." });
        round.assessmentId = a._id;
      }
    }
    await round.save();
    res.json({ success: true, data: round });
  } catch (err) {
    console.error("updateRound:", err);
    res.status(500).json({ success: false, message: "Failed to update round." });
  }
};

// PATCH /api/drives/:driveId/rounds/reorder   { order:[roundId,…] }
exports.reorderRounds = async (req, res) => {
  try {
    const order = Array.isArray(req.body?.order) ? req.body.order : [];
    if (!order.length) return res.status(400).json({ success: false, message: "No order supplied." });

    const rounds = await roundsOf(req.drive._id);
    if (order.length !== rounds.length) {
      return res.status(400).json({ success: false, message: "The new order must list every round exactly once." });
    }
    const known = new Set(rounds.map(r => String(r._id)));
    if (!order.every(id => known.has(String(id)))) {
      return res.status(400).json({ success: false, message: "The new order refers to a round that is not in this drive." });
    }
    // Reordering is blocked once any attempt exists — it would rewrite history.
    const busy = await Candidate.exists({
      driveId: req.drive._id, roundStatus: { $in: ["IN_PROGRESS", "COMPLETED", "QUALIFIED", "REJECTED"] },
    });
    if (busy) return res.status(409).json({ success: false, message: "Candidates have already attempted a round in this drive — the order can no longer change." });

    // Two-phase write: park on negative sequences so the unique index never trips.
    for (let i = 0; i < order.length; i++) {
      await Round.updateOne({ _id: order[i], driveId: req.drive._id }, { $set: { sequence: -(i + 1) } });
    }
    for (let i = 0; i < order.length; i++) {
      await Round.updateOne({ _id: order[i], driveId: req.drive._id },
        { $set: { sequence: i + 1, requiresPreviousQualification: i > 0 } });
    }
    res.json({ success: true, data: await roundsOf(req.drive._id) });
  } catch (err) {
    console.error("reorderRounds:", err);
    res.status(500).json({ success: false, message: "Failed to reorder rounds." });
  }
};

// DELETE /api/drives/:driveId/rounds/:roundId — only while it holds no results.
exports.deleteRound = async (req, res) => {
  try {
    const used = await Candidate.countDocuments({ roundId: req.round._id });
    if (used > 0) {
      return res.status(409).json({ success: false,
        message: `${used} candidate record(s) belong to this round. Close the round instead — deleting would destroy their results.` });
    }
    const seq = req.round.sequence;
    // Remove the round's own (unused) test container with it.
    if (req.round.assessmentId) {
      await Assessment.deleteOne({ _id: req.round.assessmentId, isTest: true, roundId: req.round._id });
    }
    await Round.deleteOne({ _id: req.round._id });
    // Close the gap so sequences stay contiguous.
    const after = await Round.find({ driveId: req.drive._id, sequence: { $gt: seq } }).sort({ sequence: 1 });
    for (const r of after) await Round.updateOne({ _id: r._id }, { $set: { sequence: r.sequence - 1 } });
    res.json({ success: true, message: "Round deleted." });
  } catch (err) {
    console.error("deleteRound:", err);
    res.status(500).json({ success: false, message: "Failed to delete round." });
  }
};
