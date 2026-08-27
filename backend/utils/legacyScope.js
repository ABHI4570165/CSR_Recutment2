const mongoose = require("mongoose");

/*
 * The original admin screens (Campus Drives, Rounds, All Candidates, Questions,
 * Cutoff) now live INSIDE a workspace rather than beside it. Their controllers
 * were written before workspaces existed, so this helper gives them the same
 * scoping rule without rewriting their queries:
 *
 *   request carries an active workspace  → return only that workspace's records
 *   no active workspace                  → return only records not yet linked
 *
 * Isolation still holds: with a workspace selected, another workspace's records
 * simply do not match the filter.
 */
function legacyScope(req) {
  const raw = req && req.get && req.get("X-Workspace-Id");
  if (raw && mongoose.isValidObjectId(raw)) {
    return { workspaceId: new mongoose.Types.ObjectId(raw) };
  }
  return { workspaceId: { $exists: false } };
}

module.exports = { legacyScope };
