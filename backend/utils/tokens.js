const crypto = require("crypto");

/*
 * Secure, non-guessable assessment tokens.
 *
 * 32 random bytes -> base64url -> ~43 chars. ~256 bits of entropy, so brute
 * forcing or guessing a valid candidate link is computationally infeasible.
 * These are opaque DB lookup keys (not JWTs) and carry no payload.
 */
function generateAssessmentToken() {
  return crypto.randomBytes(32).toString("base64url");
}

// Generate a token guaranteed unique against the Candidate collection.
async function generateUniqueToken(CandidateModel, maxTries = 5) {
  for (let i = 0; i < maxTries; i++) {
    const token = generateAssessmentToken();
    const exists = await CandidateModel.exists({ token });
    if (!exists) return token;
  }
  // Astronomically unlikely; widen entropy as a last resort.
  return crypto.randomBytes(48).toString("base64url");
}

module.exports = { generateAssessmentToken, generateUniqueToken };
