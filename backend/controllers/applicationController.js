const mongoose = require("mongoose");
const Drive = require("../models/Drive");
const Round = require("../models/Round");
const Student = require("../models/Student");
const Candidate = require("../models/Candidate");
const CandidateApplication = require("../models/CandidateApplication");
const Workspace = require("../models/Workspace");
const { roundsOf, recomputeApplication, ensureParticipation, assertEligible } = require("../utils/recruitment");

/* =====================================================================
 *  CANDIDATE APPLICATIONS — the PEOPLE view.
 *
 *  Every endpoint here returns ONE ROW PER PERSON per drive, no matter how
 *  many rounds they have taken. Round filters narrow WHICH people are shown;
 *  they never multiply a person into several rows.
 * ===================================================================== */

const escapeRe = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const isEmail = (s) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(String(s || "").trim());

// GET /api/applications?driveId=&search=&roundId=&roundStatus=&qualification=&overallStatus=
exports.listApplications = async (req, res) => {
  try {
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const limit = Math.min(5000, parseInt(req.query.limit) || 20);

    const filter = { workspaceId: req.workspaceId };
    if (req.query.driveId && mongoose.isValidObjectId(req.query.driveId)) filter.driveId = req.query.driveId;
    if (req.query.overallStatus) filter.overallStatus = req.query.overallStatus;
    if (req.query.selected === "true") filter["finalSelection.selected"] = true;

    // Round-based filters resolve to a SET OF APPLICATION IDS first, so the
    // result stays one row per person.
    if (req.query.roundId || req.query.roundStatus || req.query.qualification) {
      const pFilter = { workspaceId: req.workspaceId, isPrimary: true };
      if (req.query.roundId && mongoose.isValidObjectId(req.query.roundId)) pFilter.roundId = req.query.roundId;
      if (req.query.roundStatus) pFilter.roundStatus = req.query.roundStatus;
      if (req.query.qualification) pFilter.qualification = req.query.qualification;
      const ids = await Candidate.find(pFilter).distinct("applicationId");
      filter._id = { $in: ids };
    }

    // Student-level search (name / email / phone / college) — also resolved to ids.
    if (req.query.search) {
      const re = new RegExp(escapeRe(String(req.query.search).trim()), "i");
      const sIds = await Student.find({ $or: [{ name: re }, { email: re }, { phone: re }, { college: re }] }).distinct("_id");
      filter.studentId = { $in: sIds };
    }
    if (req.query.college) {
      const sIds = await Student.find({ college: req.query.college }).distinct("_id");
      filter.studentId = filter.studentId
        ? { $in: (await Student.find({ college: req.query.college, _id: filter.studentId }).distinct("_id")) }
        : { $in: sIds };
    }

    const [rows, total] = await Promise.all([
      CandidateApplication.find(filter)
        .populate("studentId", "name email phone college course branch")
        .populate("currentRoundId", "name sequence")
        .populate("driveId", "name role")
        .sort({ createdAt: -1 }).skip((page - 1) * limit).limit(limit).lean(),
      CandidateApplication.countDocuments(filter),
    ]);

    // Attach a compact round summary per person (still one row each).
    const appIds = rows.map(r => r._id);
    const parts = await Candidate.find({ applicationId: { $in: appIds }, isPrimary: true })
      .select("applicationId roundId roundStatus qualification score totalMarks").lean();
    const byApp = {}; parts.forEach(p => { (byApp[String(p.applicationId)] ||= []).push(p); });

    res.json({ success: true, data: rows.map(a => {
      const s = a.studentId || {};
      const mine = byApp[String(a._id)] || [];
      return {
        _id: a._id,
        studentId: s._id,
        name: s.name, email: s.email, phone: s.phone,
        college: s.college, course: s.course, branch: s.branch,
        drive: a.driveId ? { _id: a.driveId._id, name: a.driveId.name, role: a.driveId.role } : null,
        overallStatus: a.overallStatus,
        currentRound: a.currentRoundId ? { _id: a.currentRoundId._id, name: a.currentRoundId.name, sequence: a.currentRoundId.sequence } : null,
        highestQualifiedSequence: a.highestQualifiedSequence,
        finallySelected: !!a.finalSelection?.selected,
        roundsTaken: mine.length,
        roundsQualified: mine.filter(p => p.qualification === "QUALIFIED").length,
        createdAt: a.createdAt,
      };
    }), pagination: { page, limit, total, pages: Math.ceil(total / limit) } });
  } catch (err) {
    console.error("listApplications:", err);
    res.status(500).json({ success: false, message: "Failed to load candidates." });
  }
};

// GET /api/applications/:applicationId — profile + the FULL dynamic journey.
exports.getApplication = async (req, res) => {
  try {
    const app = req.application;
    const [student, rounds, parts] = await Promise.all([
      Student.findById(app.studentId).lean(),
      roundsOf(app.driveId),
      Candidate.find({ applicationId: app._id })
        .select("roundId isPrimary roundStatus qualification qualificationSource override score totalMarks startedAt completedAt status violations cutoffAtDecision")
        .lean(),
    ]);

    const byRound = {};
    parts.forEach(p => { (byRound[String(p.roundId)] ||= []).push(p); });

    // The journey is generated FROM THE CONFIGURED ROUNDS. If the drive has 2
    // rounds it shows 2; if it has 10 it shows 10. A round the candidate never
    // took is reported as NOT_ATTEMPTED — no row is invented for it.
    const journey = rounds.map(r => {
      const all = byRound[String(r._id)] || [];
      const p = all.find(x => x.isPrimary) || all[0];
      if (!p) {
        return {
          roundId: r._id, name: r.name, sequence: r.sequence, roundType: r.roundType,
          cutoff: r.cutoff || null,
          roundStatus: "NOT_ATTEMPTED", qualification: null,
          score: null, totalMarks: null, percentage: null,
          startedAt: null, completedAt: null, attempts: 0,
        };
      }
      return {
        roundId: r._id, name: r.name, sequence: r.sequence, roundType: r.roundType,
        cutoff: r.cutoff || null,
        roundStatus: p.roundStatus || "NOT_STARTED",
        qualification: p.qualification || null,
        qualificationSource: p.qualificationSource || null,
        override: p.override?.at ? p.override : null,
        score: p.score, totalMarks: p.totalMarks,
        percentage: (p.score != null && p.totalMarks) ? Math.round((p.score / p.totalMarks) * 1000) / 10 : null,
        startedAt: p.startedAt || null, completedAt: p.completedAt || null,
        violations: p.violations?.total || 0,
        attempts: all.length,
        participationId: p._id,
      };
    });

    const finalRound = rounds.length ? rounds[rounds.length - 1] : null;
    res.json({ success: true, data: {
      application: {
        _id: app._id, overallStatus: app.overallStatus,
        highestQualifiedSequence: app.highestQualifiedSequence,
        finalSelection: app.finalSelection, source: app.source,
        registrationData: app.registrationData,
        createdAt: app.createdAt,
      },
      student,
      drive: { _id: req.drive._id, name: req.drive.name, role: req.drive.role },
      currentStage: app.finalSelection?.selected ? "Final Selection"
        : (rounds.find(r => r.sequence > app.highestQualifiedSequence)?.name || (finalRound ? "Final Selection" : "—")),
      totalRounds: rounds.length,
      journey,
    }});
  } catch (err) {
    console.error("getApplication:", err);
    res.status(500).json({ success: false, message: "Failed to load candidate." });
  }
};

// POST /api/drives/:driveId/candidates   { candidates:[{name,email,phone,college,course,branch,...}] }
// Creates the master student (or reuses it) and ONE application per student.
// Re-uploading the same person NEVER creates a second candidate.
exports.addCandidates = async (req, res) => {
  try {
    const rows = Array.isArray(req.body?.candidates) ? req.body.candidates : [];
    if (!rows.length) return res.status(400).json({ success: false, message: "No candidates supplied." });
    if (rows.length > 2000) return res.status(413).json({ success: false, message: "Upload at most 2000 candidates at a time." });

    const firstRound = await Round.findOne({ driveId: req.drive._id }).sort({ sequence: 1 });

    let created = 0, reusedStudent = 0, duplicate = 0, invalid = 0;
    const errors = [];
    for (const r of rows) {
      const email = String(r.email || "").trim().toLowerCase();
      const name = String(r.name || "").trim();
      if (!name || !isEmail(email)) { invalid++; if (errors.length < 10) errors.push({ row: r, reason: "Name and a valid email are required." }); continue; }

      // Master student — one per human, shared across companies.
      let student = await Student.findOne({ $or: [{ email }, { alternateEmails: email }] });
      if (student) {
        reusedStudent++;
        // Fill blanks without overwriting what the student already has.
        ["phone", "college", "course", "branch"].forEach(k => {
          if (!student[k] && r[k]) student[k] = String(r[k]).trim();
        });
        await student.save();
      } else {
        student = await Student.create({
          email, name,
          phone: String(r.phone || "").trim(),
          college: String(r.college || "").trim(),
          course: String(r.course || "").trim(),
          branch: String(r.branch || "").trim(),
        });
      }

      // ONE application per (workspace, drive, student) — enforced by the index.
      const existing = await CandidateApplication.findOne({
        workspaceId: req.workspaceId, driveId: req.drive._id, studentId: student._id,
      });
      if (existing) { duplicate++; continue; }

      const app = await CandidateApplication.create({
        workspaceId: req.workspaceId, driveId: req.drive._id, studentId: student._id,
        source: r.source === "WALK_IN" ? "WALK_IN" : "PRE_REGISTERED",
        registrationData: r.customFields || {},
      });
      // Put them straight into the first round, if one is configured.
      if (firstRound) {
        try {
          await assertEligible(app, firstRound, { ignoreRoundStatus: true });
          await ensureParticipation(app, firstRound, { assignedBy: req.admin?.username || "admin", student });
        } catch { /* first round not open to them — application still exists */ }
      }
      await recomputeApplication(app._id);
      created++;
    }
    res.status(201).json({ success: true, data: { received: rows.length, created, duplicate, reusedStudent, invalid, errors } });
  } catch (err) {
    if (err.code === 11000) return res.status(409).json({ success: false, message: "That candidate already exists in this drive." });
    console.error("addCandidates:", err);
    res.status(500).json({ success: false, message: "Failed to add candidates." });
  }
};

// GET /api/drives/:driveId/final-selection
// The final round is whichever round has the highest sequence — never assumed.
exports.finalSelection = async (req, res) => {
  try {
    const rounds = await roundsOf(req.drive._id);
    if (!rounds.length) return res.json({ success: true, data: { finalRound: null, candidates: [] } });
    const last = rounds[rounds.length - 1];

    const apps = await CandidateApplication.find({
      driveId: req.drive._id, workspaceId: req.workspaceId, "finalSelection.selected": true,
    }).populate("studentId", "name email phone college course branch").sort({ createdAt: 1 }).lean();

    res.json({ success: true, data: {
      finalRound: { _id: last._id, name: last.name, sequence: last.sequence },
      totalRounds: rounds.length,
      drive: { _id: req.drive._id, name: req.drive.name, role: req.drive.role },
      candidates: apps.map(a => ({
        applicationId: a._id,
        name: a.studentId?.name, email: a.studentId?.email, phone: a.studentId?.phone,
        college: a.studentId?.college, course: a.studentId?.course, branch: a.studentId?.branch,
        role: a.finalSelection?.roleOffered || req.drive.role || "",
        selectedAt: a.finalSelection?.selectedAt,
      })),
    }});
  } catch (err) {
    console.error("finalSelection:", err);
    res.status(500).json({ success: false, message: "Failed to load final selection." });
  }
};

// GET /api/public/selection/:workspaceSlug/:driveSlug — the decorated page.
// Public, read-only, and only when the admin has published it.
exports.publicSelection = async (req, res) => {
  try {
    const ws = await Workspace.findOne({ slug: String(req.params.workspaceSlug || "").toLowerCase(), isActive: true }).lean();
    if (!ws) return res.status(404).json({ success: false, message: "Page not found." });
    const drive = await Drive.findOne({ workspaceId: ws._id, slug: String(req.params.driveSlug || "").toLowerCase() }).lean();
    if (!drive || !drive.publishSelection) return res.status(404).json({ success: false, message: "Page not found." });

    const apps = await CandidateApplication.find({ driveId: drive._id, "finalSelection.selected": true })
      .populate("studentId", "name college course branch").sort({ createdAt: 1 }).lean();

    res.json({ success: true, data: {
      workspace: { name: ws.name, companyName: ws.companyName, logo: ws.logo, branding: ws.branding, details: ws.details },
      drive: { name: drive.name, role: drive.role, description: drive.description },
      candidates: apps.map(a => ({
        name: a.studentId?.name, college: a.studentId?.college,
        course: a.studentId?.course, branch: a.studentId?.branch,
        role: a.finalSelection?.roleOffered || drive.role || "",
        status: "Selected",
      })),
    }});
  } catch (err) {
    console.error("publicSelection:", err);
    res.status(500).json({ success: false, message: "Failed to load page." });
  }
};
