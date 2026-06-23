const Assessment = require("../models/Assessment");
const Candidate  = require("../models/Candidate");
const { generateUniqueToken } = require("../utils/tokens");
const { buildLink } = require("../utils/emailQueue");
const { cloudinaryConfigured, uploadResume } = require("../utils/cloudinary");

const isEmail = (s) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(String(s || "").trim());

// Find a usable walk-in drive by test code, or return { error, code }.
async function findOpenWalkInDrive(testCode) {
  const code = String(testCode || "").trim().toUpperCase();
  if (!code) return { error: "Test code is required.", code: 400 };
  const drive = await Assessment.findOne({ testCode: code });
  if (!drive) return { error: "Invalid test code. Please check and try again.", code: 404 };
  if (drive.driveType !== "WALK_IN") return { error: "This test code is not valid for walk-in registration.", code: 400 };
  if (drive.status !== "ACTIVE") return { error: "This assessment is not currently active.", code: 403 };

  const now = Date.now();
  // NOTE: registration is allowed BEFORE the start time — students register early
  // and wait on the countdown. The assessment itself only opens at startAt
  // (enforced by the candidate engine). We only block after the window closes.
  if ((drive.endAt && now > new Date(drive.endAt).getTime()) ||
      (drive.deadline && now > new Date(drive.deadline).getTime()))
    return { error: "This assessment window has closed.", code: 410 };
  // NOTE: capacity is NOT checked here — returning candidates must be able to
  // resume even when the drive is full. Capacity is enforced for NEW registrations
  // only, inside registerWalkIn.
  return { drive };
}

function publicDrive(d) {
  return {
    assessmentName: d.name,
    durationMinutes: d.durationMinutes,
    college: d.college || "",
    startAt: d.startAt || null,
    endAt: d.endAt || null,
    capacity: d.maxCandidates != null ? { current: d.walkInCount, max: d.maxCandidates } : null,
  };
}

const MAX_RESUME_BYTES = 5 * 1024 * 1024; // 5 MB cap (Cloudinary handles storage)
// Parse an uploaded resume payload { filename, mime, data(dataURL or base64) }.
function parseResume(r) {
  if (!r || !r.data) return undefined;
  const data = String(r.data);
  const base64 = data.includes(",") ? data.split(",").pop() : data;
  const bytes = Math.floor(base64.length * 0.75);
  if (bytes > MAX_RESUME_BYTES) return { _tooBig: true };
  const filename = String(r.filename || "resume").slice(0, 200);
  const mime = String(r.mime || "application/octet-stream").slice(0, 100);
  const dataUrl = data.startsWith("data:") ? data : `data:${mime};base64,${base64}`;
  return { filename, mime, base64, dataUrl, size: bytes };
}

// Store a resume → Cloudinary if configured (url only), else base64 fallback in Mongo.
async function storeResume(parsed) {
  if (!parsed) return undefined;
  const base = { filename: parsed.filename, mime: parsed.mime, size: parsed.size, uploadedAt: new Date() };
  if (cloudinaryConfigured()) {
    try {
      const { url, publicId } = await uploadResume(parsed.dataUrl, parsed.filename);
      return { ...base, url, publicId };
    } catch (e) {
      console.warn("[walkin] Cloudinary upload failed, falling back to DB:", e.message);
    }
  }
  return { ...base, data: parsed.base64 }; // fallback
}

// POST /api/walkin/validate  { testCode }
exports.validateTestCode = async (req, res) => {
  try {
    const r = await findOpenWalkInDrive(req.body?.testCode);
    if (r.error) return res.status(r.code).json({ success: false, message: r.error });
    res.json({ success: true, data: publicDrive(r.drive) });
  } catch (err) {
    console.error("validateTestCode:", err);
    res.status(500).json({ success: false, message: "Server error." });
  }
};

// POST /api/walkin/resume  { testCode, email, aadhaar }
// Returning candidate enters only email + Aadhaar → fetch their existing attempt
// and hand back the token so they continue from where they left off.
exports.resumeWalkIn = async (req, res) => {
  try {
    const b = req.body || {};
    const email = String(b.email || "").trim().toLowerCase();
    const aadhaar = String(b.aadhaar || "").trim();
    if (!email && !aadhaar) return res.status(400).json({ success: false, message: "Enter your email or Aadhaar number." });

    const r = await findOpenWalkInDrive(b.testCode);
    if (r.error) return res.status(r.code).json({ success: false, message: r.error });
    const drive = r.drive;

    const cand = await Candidate.findOne({
      assessmentId: drive._id,
      $or: [...(email ? [{ email }] : []), ...(aadhaar ? [{ aadhaar }] : [])],
    });
    if (!cand) return res.status(404).json({ success: false, message: "No registration found for these details. Please register first." });
    if (["completed", "shortlisted", "rejected"].includes(cand.status)) {
      return res.status(409).json({ success: false, message: "You have already completed this assessment." });
    }
    if (cand.status === "disqualified") {
      return res.status(409).json({ success: false, message: "Your assessment session was terminated and cannot be resumed." });
    }
    return res.json({ success: true, token: cand.token, link: buildLink(cand.token), data: { name: cand.name, status: cand.status } });
  } catch (err) {
    console.error("resumeWalkIn:", err);
    res.status(500).json({ success: false, message: "Server error." });
  }
};

// POST /api/walkin/register  { testCode, name, email, college, usn, phone, gender, dob, aadhaar, location }
exports.registerWalkIn = async (req, res) => {
  try {
    const b = req.body || {};
    const name = String(b.name || "").trim();
    const email = String(b.email || "").trim().toLowerCase();
    const college = String(b.college || "").trim();
    if (!name) return res.status(400).json({ success: false, message: "Full name is required." });
    if (!isEmail(email)) return res.status(400).json({ success: false, message: "A valid email is required." });
    if (!college) return res.status(400).json({ success: false, message: "College name is required." });

    const parsedResume = parseResume(b.resume);
    if (parsedResume && parsedResume._tooBig) return res.status(413).json({ success: false, message: "Resume is too large (max 5 MB)." });

    const r = await findOpenWalkInDrive(b.testCode);
    if (r.error) return res.status(r.code).json({ success: false, message: r.error });
    const drive = r.drive;

    // ── RE-ENTRY / RESUME ──────────────────────────────────────────────────────
    // If this person already registered for this drive (matched by email OR Aadhaar)
    // and hasn't finished, return their EXISTING token so they resume the same
    // attempt — instead of forcing a new registration. This is the professional
    // recovery path after a crash / closed tab / network drop.
    const aadhaar = String(b.aadhaar || "").trim();
    const existing = await Candidate.findOne({
      assessmentId: drive._id,
      $or: [{ email }, ...(aadhaar ? [{ aadhaar }] : [])],
    });
    if (existing) {
      if (["completed", "shortlisted", "rejected"].includes(existing.status)) {
        return res.status(409).json({ success: false, message: "You have already completed this assessment. It can only be taken once." });
      }
      if (existing.status === "disqualified") {
        return res.status(409).json({ success: false, message: "Your assessment session was terminated and cannot be resumed." });
      }
      // Resumable (invited / in-progress) → hand back the same token. No new row, no capacity change.
      return res.status(200).json({ success: true, resumed: true, token: existing.token, link: buildLink(existing.token), data: { name: existing.name } });
    }

    // Atomic capacity claim — guarantees we never exceed maxCandidates under load.
    if (drive.maxCandidates != null) {
      const claimed = await Assessment.findOneAndUpdate(
        { _id: drive._id, driveType: "WALK_IN", status: "ACTIVE", walkInCount: { $lt: drive.maxCandidates } },
        { $inc: { walkInCount: 1 } },
        { new: true }
      );
      if (!claimed) return res.status(409).json({ success: false, message: "Registration Closed. Maximum candidate limit reached." });
    } else {
      await Assessment.updateOne({ _id: drive._id }, { $inc: { walkInCount: 1 } });
    }

    // Upload resume (Cloudinary preferred) before creating the candidate.
    const resume = await storeResume(parsedResume);

    // Create the candidate (reuses the SAME assessment engine via the token flow).
    try {
      const token = await generateUniqueToken(Candidate);
      const cand = await Candidate.create({
        assessmentId: drive._id,
        name, email, college,
        candidateSource: "WALK_IN",
        usn: b.usn, phone: b.phone, gender: b.gender, dob: b.dob, aadhaar: b.aadhaar, location: b.location,
        course: b.course, branch: b.branch,
        ...(resume ? { resume } : {}),
        token,
        tokenExpiresAt: drive.endAt || drive.deadline || undefined,
        status: "invited",
        emailStatus: "pending", // walk-ins get thank-you/termination only — no link email
      });
      return res.status(201).json({ success: true, token, link: buildLink(token), data: { name: cand.name } });
    } catch (err) {
      // Roll the capacity counter back on failure (e.g. duplicate email in this drive).
      if (drive.maxCandidates != null) await Assessment.updateOne({ _id: drive._id }, { $inc: { walkInCount: -1 } });
      if (err.code === 11000) {
        // Race: someone registered this email a moment ago — resume that attempt.
        const dup = await Candidate.findOne({ assessmentId: drive._id, email });
        if (dup && !["completed", "shortlisted", "rejected", "disqualified"].includes(dup.status)) {
          return res.status(200).json({ success: true, resumed: true, token: dup.token, link: buildLink(dup.token), data: { name: dup.name } });
        }
        return res.status(409).json({ success: false, message: "This email is already registered for this assessment." });
      }
      throw err;
    }
  } catch (err) {
    console.error("registerWalkIn:", err);
    res.status(500).json({ success: false, message: "Registration failed. Please try again." });
  }
};
