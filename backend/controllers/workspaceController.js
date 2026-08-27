const mongoose = require("mongoose");
const Workspace = require("../models/Workspace");
const Drive = require("../models/Drive");
const Round = require("../models/Round");
const Candidate = require("../models/Candidate");
const CandidateApplication = require("../models/CandidateApplication");
const RegistrationField = require("../models/RegistrationField");
const { allowedWorkspaces } = require("../middleware/workspace");

/* =====================================================================
 *  WORKSPACES — one per company. The top of the recruitment tree.
 * ===================================================================== */

const slugify = (s) => String(s || "").toLowerCase().trim()
  .replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60);

// GET /api/workspaces — the switcher list. Restricted to the admin's own set.
exports.listWorkspaces = async (req, res) => {
  try {
    const allowed = allowedWorkspaces(req);
    const filter = { isActive: true };
    if (allowed) filter._id = { $in: allowed };

    // GLOBAL LEVEL — company metadata ONLY. No student, candidate, application,
    // drive, round, score or result data is read or returned here; recruitment
    // data is reachable exclusively through a workspace-scoped request.
    const rows = await Workspace.find(filter)
      .select("name companyName slug logo branding isActive createdAt")
      .sort({ createdAt: 1 }).lean();

    res.json({ success: true, data: rows });
  } catch (err) {
    console.error("listWorkspaces:", err);
    res.status(500).json({ success: false, message: "Failed to load workspaces." });
  }
};

/*
 * GET /api/workspaces/overview — LEVEL 1 (global) statistics.
 *
 * This is NOT a workspace endpoint: it carries no workspaceId and aggregates
 * across every workspace the admin may access. It never creates anything, and
 * with zero workspaces it simply returns zeros.
 */
exports.globalOverview = async (req, res) => {
  try {
    const allowed = allowedWorkspaces(req);
    const wsFilter = { isActive: true };
    if (allowed) wsFilter._id = { $in: allowed };

    // Counting workspaces is the ONLY aggregate the global level performs.
    // It deliberately reads nothing from drives, rounds, students, applications
    // or candidates — recruitment data has no representation at this level.
    const totalWorkspaces = await Workspace.countDocuments(wsFilter);

    res.json({ success: true, data: { totalWorkspaces } });
  } catch (err) {
    console.error("globalOverview:", err.message);
    res.status(500).json({ success: false, message: "Failed to load overview." });
  }
};

// POST /api/workspaces — create a company and seed its six mandatory fields.
exports.createWorkspace = async (req, res) => {
  try {
    const b = req.body || {};
    const name = String(b.name || "").trim();
    if (!name) return res.status(400).json({ success: false, message: "Workspace name is required." });

    let slug = slugify(b.slug || name);
    if (!slug) return res.status(400).json({ success: false, message: "Could not build a URL key from that name." });
    // Keep slugs unique without failing the request.
    let n = 1;
    while (await Workspace.exists({ slug })) slug = `${slugify(b.slug || name)}-${++n}`;

    const ws = await Workspace.create({
      name,
      companyName: String(b.companyName || name).trim(),
      slug,
      logo: b.logo && b.logo.url ? { url: b.logo.url, publicId: b.logo.publicId } : undefined,
      details: b.details || {},
      branding: b.branding || {},
      createdBy: req.admin?.username || "",
    });

    // Seed the six default mandatory registration fields for this workspace.
    await RegistrationField.insertMany(
      RegistrationField.SYSTEM_FIELDS.map(f => ({ ...f, workspaceId: ws._id, driveId: null })),
      { ordered: false }
    );

    res.status(201).json({ success: true, data: ws });
  } catch (err) {
    if (err.code === 11000) return res.status(409).json({ success: false, message: "A workspace with that URL key already exists." });
    console.error("createWorkspace:", err);
    res.status(500).json({ success: false, message: "Failed to create workspace." });
  }
};

// PUT /api/workspaces/:workspaceId
exports.updateWorkspace = async (req, res) => {
  try {
    const b = req.body || {};
    const update = {};
    ["name", "companyName"].forEach(k => { if (b[k] != null) update[k] = String(b[k]).trim(); });
    if (b.logo !== undefined) update.logo = b.logo && b.logo.url ? { url: b.logo.url, publicId: b.logo.publicId } : undefined;
    if (b.details) update.details = b.details;
    if (b.branding) update.branding = b.branding;
    if (b.isActive != null) update.isActive = !!b.isActive;

    const ws = await Workspace.findByIdAndUpdate(req.workspaceId, { $set: update }, { new: true });
    if (!ws) return res.status(404).json({ success: false, message: "Workspace not found." });
    res.json({ success: true, data: ws });
  } catch (err) {
    console.error("updateWorkspace:", err);
    res.status(500).json({ success: false, message: "Failed to update workspace." });
  }
};

// GET /api/workspaces/current/dashboard — stats for THIS workspace only.
exports.workspaceDashboard = async (req, res) => {
  try {
    const wsId = req.workspaceId;
    const driveFilter = req.query.driveId && mongoose.isValidObjectId(req.query.driveId)
      ? { workspaceId: wsId, driveId: new mongoose.Types.ObjectId(req.query.driveId) }
      : { workspaceId: wsId };

    const [, appAgg, rounds, partAgg] = await Promise.all([
      Promise.resolve(null),
      CandidateApplication.aggregate([
        { $match: driveFilter },
        { $group: { _id: "$overallStatus", n: { $sum: 1 } } },
      ]),
      Round.find(driveFilter.driveId ? { driveId: driveFilter.driveId } : { workspaceId: wsId })
        .sort({ sequence: 1 }).lean(),
      Candidate.aggregate([
        { $match: { ...driveFilter, isPrimary: true } },
        { $group: { _id: { r: "$roundId", s: "$roundStatus", q: "$qualification" }, n: { $sum: 1 } } },
      ]),
    ]);

    const statusCounts = {}; appAgg.forEach(a => { statusCounts[a._id] = a.n; });
    const totalCandidates = Object.values(statusCounts).reduce((a, b) => a + b, 0);

    // Round-wise statistics, generated from the configured rounds — any number.
    const roundStats = rounds.map(r => {
      const rows = partAgg.filter(p => String(p._id.r) === String(r._id));
      const sum = (fn) => rows.filter(fn).reduce((t, x) => t + x.n, 0);
      const eligible = sum(() => true);
      return {
        roundId: r._id, name: r.name, sequence: r.sequence, roundType: r.roundType, status: r.status,
        eligible,
        started:      sum(x => x._id.s === "IN_PROGRESS"),
        completed:    sum(x => ["COMPLETED", "QUALIFIED", "REJECTED"].includes(x._id.s)),
        qualified:    sum(x => x._id.q === "QUALIFIED"),
        rejected:     sum(x => x._id.q === "REJECTED"),
        pending:      sum(x => x._id.q === "PENDING"),
        notAttempted: sum(x => ["NOT_STARTED", "NOT_ATTEMPTED"].includes(x._id.s)),
      };
    });

    res.json({ success: true, data: {
      workspace: { _id: req.workspace._id, name: req.workspace.name, companyName: req.workspace.companyName, logo: req.workspace.logo },
      totals: {
        // A workspace runs ONE recruitment process, so its shape is students and
        // rounds — there is no drive count to report.
        rounds: rounds.length,
        students: totalCandidates,
        candidates: totalCandidates,   // kept for existing callers
        qualified: statusCounts.SHORTLISTED || 0,
        rejected: statusCounts.REJECTED || 0,
        pending: (statusCounts.REGISTERED || 0) + (statusCounts.IN_PROGRESS || 0),
        finallySelected: statusCounts.FINALLY_SELECTED || 0,
      },
      byStatus: statusCounts,
      rounds: roundStats,
    }});
  } catch (err) {
    console.error("workspaceDashboard:", err);
    res.status(500).json({ success: false, message: "Failed to load dashboard." });
  }
};

/* =====================================================================
 *  DYNAMIC REGISTRATION FIELDS
 * ===================================================================== */

// GET /api/workspaces/current/registration-fields?driveId=
exports.listFields = async (req, res) => {
  try {
    const driveId = req.query.driveId && mongoose.isValidObjectId(req.query.driveId) ? req.query.driveId : null;
    const rows = await RegistrationField.find({
      workspaceId: req.workspaceId,
      driveId: { $in: [driveId, null] },
    }).sort({ order: 1, createdAt: 1 }).lean();

    // A drive-specific field overrides the workspace default with the same key.
    const byKey = {};
    rows.forEach(f => { const cur = byKey[f.fieldKey]; if (!cur || (f.driveId && !cur.driveId)) byKey[f.fieldKey] = f; });
    res.json({ success: true, data: Object.values(byKey).sort((a, b) => a.order - b.order) });
  } catch (err) {
    console.error("listFields:", err);
    res.status(500).json({ success: false, message: "Failed to load registration fields." });
  }
};

// POST /api/workspaces/current/registration-fields
exports.createField = async (req, res) => {
  try {
    const b = req.body || {};
    const fieldName = String(b.fieldName || "").trim();
    if (!fieldName) return res.status(400).json({ success: false, message: "Field name is required." });
    const fieldKey = slugify(b.fieldKey || fieldName).replace(/-/g, "_");
    if (!fieldKey) return res.status(400).json({ success: false, message: "Could not build a field key." });
    if (!RegistrationField.FIELD_TYPES.includes(b.fieldType || "TEXT")) {
      return res.status(400).json({ success: false, message: "Unsupported field type." });
    }

    const doc = await RegistrationField.create({
      workspaceId: req.workspaceId,
      driveId: b.driveId && mongoose.isValidObjectId(b.driveId) ? b.driveId : null,
      fieldKey, fieldName,
      fieldType: b.fieldType || "TEXT",
      required: !!b.required,
      order: b.order != null ? Number(b.order) : 100,
      placeholder: b.placeholder || "", helpText: b.helpText || "",
      options: Array.isArray(b.options) ? b.options.filter(Boolean) : [],
      validation: b.validation || {},
      isSystem: false,
    });
    res.status(201).json({ success: true, data: doc });
  } catch (err) {
    if (err.code === 11000) return res.status(409).json({ success: false, message: "A field with that key already exists." });
    console.error("createField:", err);
    res.status(500).json({ success: false, message: "Failed to create field." });
  }
};

// PUT /api/workspaces/current/registration-fields/:id
exports.updateField = async (req, res) => {
  try {
    const f = await RegistrationField.findOne({ _id: req.params.id, workspaceId: req.workspaceId });
    if (!f) return res.status(404).json({ success: false, message: "Field not found." });

    const b = req.body || {};
    ["fieldName", "placeholder", "helpText"].forEach(k => { if (b[k] != null) f[k] = String(b[k]); });
    if (b.order != null) f.order = Number(b.order);
    if (Array.isArray(b.options)) f.options = b.options.filter(Boolean);
    if (b.validation) f.validation = { ...f.validation, ...b.validation };
    if (b.isActive != null && !f.isSystem) f.isActive = !!b.isActive;
    // System fields stay mandatory and keep their key and type.
    if (!f.isSystem) {
      if (b.required != null) f.required = !!b.required;
      if (b.fieldType && RegistrationField.FIELD_TYPES.includes(b.fieldType)) f.fieldType = b.fieldType;
    }
    await f.save();
    res.json({ success: true, data: f });
  } catch (err) {
    console.error("updateField:", err);
    res.status(500).json({ success: false, message: "Failed to update field." });
  }
};

// DELETE /api/workspaces/current/registration-fields/:id
exports.deleteField = async (req, res) => {
  try {
    const f = await RegistrationField.findOne({ _id: req.params.id, workspaceId: req.workspaceId });
    if (!f) return res.status(404).json({ success: false, message: "Field not found." });
    if (f.isSystem) return res.status(400).json({ success: false, message: "This is a default mandatory field and cannot be deleted." });
    await RegistrationField.deleteOne({ _id: f._id });
    res.json({ success: true, message: "Field removed." });
  } catch (err) {
    console.error("deleteField:", err);
    res.status(500).json({ success: false, message: "Failed to delete field." });
  }
};
