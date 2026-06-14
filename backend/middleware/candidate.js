const Candidate = require("../models/Candidate");

/*
 * Resolves the opaque assessment token in the URL to a Candidate document.
 * The token itself is the credential (256-bit, non-guessable). No JWT involved,
 * which keeps candidate endpoints fully stateless and load-balancer friendly.
 */
async function loadCandidate(req, res, next) {
  try {
    const token = req.params.token;
    if (!token || token.length < 20) {
      return res.status(404).json({ success: false, message: "Invalid assessment link." });
    }
    const candidate = await Candidate.findOne({ token });
    if (!candidate) {
      return res.status(404).json({ success: false, message: "Assessment link not found." });
    }
    req.candidate = candidate;
    next();
  } catch (err) {
    console.error("[loadCandidate]", err.message);
    res.status(500).json({ success: false, message: "Server error." });
  }
}

module.exports = { loadCandidate };
