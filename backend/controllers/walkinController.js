const Assessment = require("../models/Assessment");
const Candidate  = require("../models/Candidate");
const { generateUniqueToken } = require("../utils/tokens");
const { buildLink } = require("../utils/emailQueue");

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
  if (drive.maxCandidates != null && drive.walkInCount >= drive.maxCandidates)
    return { error: "Registration Closed. Maximum candidate limit reached.", code: 409 };

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

const MAX_RESUME_BYTES = 2 * 1024 * 1024; // 2 MB cap (stored as base64 in Mongo)
// Validate/normalize an uploaded resume payload { filename, mime, data(base64 dataURL or raw) }.
function normalizeResume(r) {
  if (!r || !r.data) return undefined;
  const data = String(r.data);
  // accept data URLs ("data:application/pdf;base64,....") or raw base64
  const base64 = data.includes(",") ? data.split(",").pop() : data;
  const bytes = Math.floor(base64.length * 0.75);
  if (bytes > MAX_RESUME_BYTES) return { _tooBig: true };
  return {
    filename: String(r.filename || "resume").slice(0, 200),
    mime: String(r.mime || "application/octet-stream").slice(0, 100),
    data: base64,
    size: bytes,
    uploadedAt: new Date(),
  };
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

    const resume = normalizeResume(b.resume);
    if (resume && resume._tooBig) return res.status(413).json({ success: false, message: "Resume is too large (max 2 MB)." });

    const r = await findOpenWalkInDrive(b.testCode);
    if (r.error) return res.status(r.code).json({ success: false, message: r.error });
    const drive = r.drive;

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
        return res.status(409).json({ success: false, message: "This email is already registered for this assessment." });
      }
      throw err;
    }
  } catch (err) {
    console.error("registerWalkIn:", err);
    res.status(500).json({ success: false, message: "Registration failed. Please try again." });
  }
};
