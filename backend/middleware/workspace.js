const mongoose = require("mongoose");
const Workspace = require("../models/Workspace");
const Drive = require("../models/Drive");
const Round = require("../models/Round");
const CandidateApplication = require("../models/CandidateApplication");
const Candidate = require("../models/Candidate");

/*
 * WORKSPACE ISOLATION — enforced here, on the server, for every admin request.
 *
 * Two independent layers, both of which must pass:
 *
 *   1. resolveWorkspace  — the active workspace comes from the X-Workspace-Id
 *      header, is verified to exist, and is checked against the workspaces the
 *      authenticated admin may access. req.workspaceId is then the ONLY value
 *      controllers are allowed to filter by. A workspaceId sent in a body or
 *      query string is never trusted and never used.
 *
 *   2. loadDrive / loadRound / loadApplication / loadParticipation — every id in
 *      a path is walked up its ownership chain (participation → round → drive →
 *      workspace). A document belonging to another workspace returns 404, not a
 *      filtered-out row, so ids cannot be probed for existence.
 *
 * Result: Company A cannot reach Company B's data by editing an id in a request.
 */

// Which workspaces may this admin touch? The current auth model has a single
// admin account, so an empty/absent claim means "all workspaces". When
// per-admin scoping is introduced, the claim is populated at login and this
// function starts restricting without any controller changing.
function allowedWorkspaces(req) {
  const w = req.admin?.workspaces;
  return Array.isArray(w) && w.length ? w.map(String) : null;   // null = unrestricted
}

const bad = (res, code, message) => res.status(code).json({ success: false, message });

// Resolve + authorise the active workspace. Attach it to the request.
async function resolveWorkspace(req, res, next) {
  try {
    const raw = req.get("X-Workspace-Id") || req.params.workspaceId;
    if (!raw) return bad(res, 400, "No workspace selected.");
    if (!mongoose.isValidObjectId(raw)) return bad(res, 400, "Invalid workspace.");

    const allowed = allowedWorkspaces(req);
    if (allowed && !allowed.includes(String(raw))) {
      // Do not reveal whether the workspace exists.
      return bad(res, 404, "Workspace not found.");
    }

    const ws = await Workspace.findById(raw).lean();
    if (!ws || ws.isActive === false) return bad(res, 404, "Workspace not found.");

    req.workspace = ws;
    req.workspaceId = ws._id;
    next();
  } catch (err) {
    console.error("[resolveWorkspace]", err.message);
    bad(res, 500, "Server error.");
  }
}

// Optional variant: used by endpoints that legitimately span workspaces
// (the workspace list itself). Never grants access to scoped data.
async function optionalWorkspace(req, _res, next) {
  const raw = req.get("X-Workspace-Id");
  if (raw && mongoose.isValidObjectId(raw)) {
    const ws = await Workspace.findById(raw).lean();
    if (ws) { req.workspace = ws; req.workspaceId = ws._id; }
  }
  next();
}

// ── Ownership loaders. Each verifies the FULL chain up to req.workspaceId. ────

function loadDrive(param = "driveId") {
  return async (req, res, next) => {
    try {
      const id = req.params[param];
      if (!mongoose.isValidObjectId(id)) return bad(res, 404, "Drive not found.");
      const drive = await Drive.findOne({ _id: id, workspaceId: req.workspaceId });
      if (!drive) return bad(res, 404, "Drive not found.");
      req.drive = drive;
      next();
    } catch (err) { console.error("[loadDrive]", err.message); bad(res, 500, "Server error."); }
  };
}

function loadRound(param = "roundId") {
  return async (req, res, next) => {
    try {
      const id = req.params[param];
      if (!mongoose.isValidObjectId(id)) return bad(res, 404, "Round not found.");
      const round = await Round.findOne({ _id: id, workspaceId: req.workspaceId });
      if (!round) return bad(res, 404, "Round not found.");
      // round → drive → workspace
      const drive = req.drive && String(req.drive._id) === String(round.driveId)
        ? req.drive
        : await Drive.findOne({ _id: round.driveId, workspaceId: req.workspaceId });
      if (!drive) return bad(res, 404, "Round not found.");
      req.round = round;
      req.drive = drive;
      next();
    } catch (err) { console.error("[loadRound]", err.message); bad(res, 500, "Server error."); }
  };
}

function loadApplication(param = "applicationId") {
  return async (req, res, next) => {
    try {
      const id = req.params[param];
      if (!mongoose.isValidObjectId(id)) return bad(res, 404, "Candidate not found.");
      const app = await CandidateApplication.findOne({ _id: id, workspaceId: req.workspaceId });
      if (!app) return bad(res, 404, "Candidate not found.");
      const drive = await Drive.findOne({ _id: app.driveId, workspaceId: req.workspaceId });
      if (!drive) return bad(res, 404, "Candidate not found.");
      req.application = app;
      req.drive = drive;
      next();
    } catch (err) { console.error("[loadApplication]", err.message); bad(res, 500, "Server error."); }
  };
}

function loadParticipation(param = "id") {
  return async (req, res, next) => {
    try {
      const id = req.params[param];
      if (!mongoose.isValidObjectId(id)) return bad(res, 404, "Result not found.");
      const p = await Candidate.findOne({ _id: id, workspaceId: req.workspaceId });
      if (!p) return bad(res, 404, "Result not found.");
      // participation → round → drive → workspace
      const round = await Round.findOne({ _id: p.roundId, workspaceId: req.workspaceId });
      if (!round || String(round.driveId) !== String(p.driveId)) return bad(res, 404, "Result not found.");
      const app = await CandidateApplication.findOne({ _id: p.applicationId, workspaceId: req.workspaceId });
      if (!app || String(app.driveId) !== String(p.driveId)) return bad(res, 404, "Result not found.");
      req.participation = p;
      req.round = round;
      req.application = app;
      next();
    } catch (err) { console.error("[loadParticipation]", err.message); bad(res, 500, "Server error."); }
  };
}

module.exports = {
  resolveWorkspace, optionalWorkspace,
  loadDrive, loadRound, loadApplication, loadParticipation,
  allowedWorkspaces,
};
