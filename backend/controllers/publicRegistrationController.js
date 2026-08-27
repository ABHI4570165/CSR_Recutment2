const mongoose = require("mongoose");
const Workspace = require("../models/Workspace");
const Drive = require("../models/Drive");
const Round = require("../models/Round");
const Student = require("../models/Student");
const CandidateApplication = require("../models/CandidateApplication");
const Candidate = require("../models/Candidate");
const RegistrationField = require("../models/RegistrationField");
const { ensureParticipation, roundsOf } = require("../utils/recruitment");
const { cloudinaryConfigured, uploadResume } = require("../utils/cloudinary");

/*
 * PUBLIC SELF-REGISTRATION for a WORKSPACE drive.
 *
 *   /register/:workspaceSlug/:driveSlug
 *
 * The workspace is resolved from the URL slug and the drive must belong to it,
 * so a workspace or drive id supplied by the browser can never be used to
 * register into someone else's company. The flow is:
 *
 *   verify workspace + drive → load that workspace's field schema →
 *   validate server-side → find-or-create Student (global, one per person) →
 *   find-or-create CandidateApplication (unique per workspace+drive+student) →
 *   create the FIRST round's participation only → hand back its test token.
 *
 * Legacy drives are untouched: they keep using /api/walkin and their own flow.
 */

const isEmail = (s) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(String(s || "").trim());
const norm = (s) => String(s ?? "").trim();

/* ── Resolve workspace + drive + first round from the URL slugs ───────────── */
async function resolveTarget(req) {
  const workspace = await Workspace.findOne({
    slug: String(req.params.workspaceSlug || "").toLowerCase(), isActive: true,
  }).lean();
  if (!workspace) return { error: { code: 404, message: "Registration page not found." } };

  const drive = await Drive.findOne({
    workspaceId: workspace._id, slug: String(req.params.driveSlug || "").toLowerCase(),
  }).lean();
  // Ownership is proven by the query itself — the drive must belong to the
  // workspace named in the URL, never to one supplied in the request body.
  if (!drive) return { error: { code: 404, message: "Registration page not found." } };

  if (drive.status !== "ACTIVE") {
    return { error: { code: 403, state: "closed", message: "Registration for this drive is not open." } };
  }

  const rounds = await roundsOf(drive._id);
  const firstRound = rounds[0] || null;      // lowest sequence — never a hardcoded name
  if (!firstRound) {
    return { error: { code: 403, state: "closed", message: "This drive has no rounds configured yet." } };
  }
  if (firstRound.status !== "ACTIVE") {
    return { error: { code: 403, state: "closed", message: "Registration for this drive is not open yet." } };
  }
  return { workspace, drive, firstRound, rounds };
}

/* ── The workspace's field schema (drive-specific overrides the default) ──── */
async function fieldsFor(workspaceId, driveId) {
  const rows = await RegistrationField.find({
    workspaceId, driveId: { $in: [driveId, null] }, isActive: true,
  }).sort({ order: 1, createdAt: 1 }).lean();
  const byKey = {};
  rows.forEach(f => { const cur = byKey[f.fieldKey]; if (!cur || (f.driveId && !cur.driveId)) byKey[f.fieldKey] = f; });
  return Object.values(byKey).sort((a, b) => (a.order || 0) - (b.order || 0));
}

/* ── Server-side validation driven entirely by the field configuration ───── */
function validate(fields, body) {
  const errors = [];
  const values = {};

  for (const f of fields) {
    const raw = body[f.fieldKey];
    const isFile = f.fieldType === "FILE";
    const empty = isFile
      ? !(raw && (raw.data || raw.url))
      : (raw === undefined || raw === null || norm(raw) === "");

    if (empty) {
      if (f.required) errors.push({ fieldKey: f.fieldKey, fieldName: f.fieldName, message: `${f.fieldName} is required.` });
      continue;
    }

    const v = isFile ? raw : norm(raw);
    const val = f.validation || {};
    const fail = (message) => errors.push({ fieldKey: f.fieldKey, fieldName: f.fieldName, message });

    switch (f.fieldType) {
      case "EMAIL":
        if (!isEmail(v)) fail(val.message || `Enter a valid email address.`);
        break;
      case "PHONE": {
        const digits = String(v).replace(/\D/g, "");
        const re = val.regex ? new RegExp(val.regex) : /^[6-9]\d{9}$/;
        if (!re.test(digits)) fail(val.message || `Enter a valid 10-digit mobile number.`);
        break;
      }
      case "NUMBER": {
        const n = Number(v);
        if (Number.isNaN(n)) fail(val.message || `${f.fieldName} must be a number.`);
        else {
          if (val.min != null && n < val.min) fail(val.message || `${f.fieldName} must be at least ${val.min}.`);
          if (val.max != null && n > val.max) fail(val.message || `${f.fieldName} must be at most ${val.max}.`);
        }
        break;
      }
      case "DATE":
        if (Number.isNaN(new Date(v).getTime())) fail(val.message || `Enter a valid date.`);
        break;
      case "DROPDOWN": case "RADIO":
        if ((f.options || []).length && !f.options.includes(v)) fail(val.message || `Choose one of the listed options.`);
        break;
      case "CHECKBOX":
        break;   // presence already checked above
      case "FILE":
        if (!v.filename) fail(`${f.fieldName} file is missing a name.`);
        break;
      default: {   // TEXT / TEXTAREA
        if (val.minLength != null && String(v).length < val.minLength) fail(val.message || `${f.fieldName} is too short.`);
        if (val.maxLength != null && String(v).length > val.maxLength) fail(val.message || `${f.fieldName} is too long.`);
        if (val.regex) { try { if (!new RegExp(val.regex).test(String(v))) fail(val.message || `${f.fieldName} is not in the expected format.`); } catch { /* bad pattern — skip */ } }
      }
    }
    values[f.fieldKey] = f.fieldType === "PHONE" ? String(v).replace(/\D/g, "").slice(-10) : v;
  }
  return { errors, values };
}

/* ── File handling: reuse the same Cloudinary path the walk-in portal uses ── */
const MAX_FILE_BYTES = 5 * 1024 * 1024;
async function storeFile(raw) {
  const data = String(raw.data || "");
  const base64 = data.includes(",") ? data.split(",").pop() : data;
  const bytes = Math.floor(base64.length * 0.75);
  if (bytes > MAX_FILE_BYTES) return { tooBig: true };
  const filename = String(raw.filename || "upload").slice(0, 200);
  const mime = String(raw.mime || "application/octet-stream").slice(0, 100);
  const m = filename.match(/\.([a-z0-9]+)$/i);
  const ext = m ? m[1].toLowerCase() : "";
  const base = { filename, ext, mime, size: bytes, uploadedAt: new Date() };
  if (cloudinaryConfigured()) {
    try {
      const dataUrl = data.startsWith("data:") ? data : `data:${mime};base64,${base64}`;
      const up = await uploadResume(dataUrl, filename);
      return { file: { ...base, ext: up.ext || ext, url: up.url, publicId: up.publicId } };
    } catch { /* fall through to inline storage */ }
  }
  return { file: { ...base, data: base64 } };
}

/* =====================================================================
 *  GET /api/public/register/:workspaceSlug/:driveSlug
 *  Branding + the field schema the page should render. No auth.
 * ===================================================================== */
exports.getRegistrationForm = async (req, res) => {
  try {
    const t = await resolveTarget(req);
    if (t.error) {
      return res.status(t.error.code).json({ success: false, state: t.error.state || "not-found", message: t.error.message });
    }
    const fields = await fieldsFor(t.workspace._id, t.drive._id);
    res.json({ success: true, data: {
      workspace: {
        name: t.workspace.name, companyName: t.workspace.companyName,
        logo: t.workspace.logo, branding: t.workspace.branding, details: t.workspace.details,
      },
      drive: { name: t.drive.name, role: t.drive.role, description: t.drive.description },
      firstRound: { name: t.firstRound.name, sequence: t.firstRound.sequence, roundType: t.firstRound.roundType },
      totalRounds: t.rounds.length,
      fields: fields.map(f => ({
        fieldKey: f.fieldKey, fieldName: f.fieldName, fieldType: f.fieldType,
        required: f.required, order: f.order, options: f.options || [],
        placeholder: f.placeholder || "", helpText: f.helpText || "",
        validation: f.validation || {},
      })),
    }});
  } catch (err) {
    console.error("getRegistrationForm:", err.message);
    res.status(500).json({ success: false, message: "Could not load the registration form." });
  }
};

/* =====================================================================
 *  POST /api/public/register/:workspaceSlug/:driveSlug
 *  Validate → Student → CandidateApplication → first-round participation.
 * ===================================================================== */
exports.submitRegistration = async (req, res) => {
  try {
    const t = await resolveTarget(req);
    if (t.error) {
      return res.status(t.error.code).json({ success: false, state: t.error.state || "not-found", message: t.error.message });
    }
    const { workspace, drive, firstRound } = t;

    const fields = await fieldsFor(workspace._id, drive._id);
    const { errors, values } = validate(fields, req.body || {});
    if (errors.length) {
      return res.status(422).json({ success: false, state: "invalid", message: "Please correct the highlighted fields.", errors });
    }

    // System fields land on the master Student; everything else is per-drive.
    const sys = {}; const custom = {};
    for (const f of fields) {
      if (values[f.fieldKey] === undefined) continue;
      if (f.isSystem && f.mapsTo) sys[f.mapsTo] = values[f.fieldKey];
      else custom[f.fieldKey] = values[f.fieldKey];
    }
    const email = String(sys.email || "").toLowerCase().trim();
    if (!isEmail(email)) {
      return res.status(422).json({ success: false, state: "invalid", message: "A valid email is required.",
        errors: [{ fieldKey: "email", fieldName: "Email", message: "Enter a valid email address." }] });
    }

    // ── Student master: ONE per person, globally. Registering for a second
    // company reuses this record — it never creates a second student. ────────
    let student = await Student.findOne({ $or: [{ email }, { alternateEmails: email }] });
    if (student) {
      // Fill gaps without overwriting what the student already has.
      ["name", "phone", "college", "course", "branch"].forEach(k => {
        if (sys[k] && !student[k]) student[k] = sys[k];
      });
      await student.save();
    } else {
      student = await Student.create({
        email,
        name: sys.name || "Candidate",
        phone: sys.phone || "", college: sys.college || "",
        course: sys.course || "", branch: sys.branch || "",
      });
    }

    // ── Application: unique per (workspace, drive, student). A repeat
    // submission returns the SAME application — never a second one. ──────────
    let application = await CandidateApplication.findOne({
      workspaceId: workspace._id, driveId: drive._id, studentId: student._id,
    });
    let isNew = false;
    if (!application) {
      try {
        application = await CandidateApplication.create({
          workspaceId: workspace._id, driveId: drive._id, studentId: student._id,
          source: "WALK_IN", registrationData: custom, overallStatus: "REGISTERED",
        });
        isNew = true;
      } catch (e) {
        if (e.code !== 11000) throw e;
        // Two submissions raced — the unique index held; use the winner.
        application = await CandidateApplication.findOne({
          workspaceId: workspace._id, driveId: drive._id, studentId: student._id,
        });
      }
    } else {
      // Repeat registration: refresh the answers, keep the single application.
      const merged = application.registrationData instanceof Map
        ? Object.fromEntries(application.registrationData) : (application.registrationData || {});
      application.registrationData = { ...merged, ...custom };
      await application.save();
    }

    // ── First round ONLY. Later rounds are created when the candidate
    // qualifies and an admin advances them. ─────────────────────────────────
    const participation = await ensureParticipation(application, firstRound, {
      assignedBy: "self-registration", student: student.toObject ? student.toObject() : student,
    });

    // A FILE answer (e.g. resume) is stored on the participation, so the
    // existing admin resume viewer works with no changes.
    const fileField = fields.find(f => f.fieldType === "FILE" && req.body?.[f.fieldKey]?.data);
    if (fileField) {
      const stored = await storeFile(req.body[fileField.fieldKey]);
      if (stored.tooBig) {
        return res.status(413).json({ success: false, state: "invalid",
          message: `${fileField.fieldName} is too large (max 5 MB).`,
          errors: [{ fieldKey: fileField.fieldKey, fieldName: fileField.fieldName, message: "File must be 5 MB or smaller." }] });
      }
      if (stored.file) { participation.resume = stored.file; await participation.save(); }
    }

    // Keep the participation's denormalised identity in step with the student.
    let touched = false;
    ["name", "email", "college", "phone", "course", "branch"].forEach(k => {
      const v = k === "email" ? student.email : student[k];
      if (v && participation[k] !== v) { participation[k] = v; touched = true; }
    });
    if (touched) await participation.save();

    res.status(isNew ? 201 : 200).json({ success: true, data: {
      alreadyRegistered: !isNew,
      student: { name: student.name, email: student.email },
      drive: { name: drive.name, role: drive.role },
      firstRound: { name: firstRound.name, sequence: firstRound.sequence, roundType: firstRound.roundType },
      // The candidate's own test link — the SAME token mechanism the existing
      // quiz engine already uses. Never another candidate's token.
      token: participation.token,
      testUrl: `/assessment/${participation.token}`,
    }});
  } catch (err) {
    if (err.code === 11000) {
      return res.status(409).json({ success: false, message: "You are already registered for this drive." });
    }
    console.error("submitRegistration:", err.message);
    res.status(500).json({ success: false, message: "Registration failed. Please try again." });
  }
};
