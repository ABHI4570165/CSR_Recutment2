const router = require("express").Router();
const {
  createAssessment, listAssessments, getAssessment, updateAssessment, deleteAssessment,
  uploadCandidates, scheduleEmails,
  listCandidates, candidateStats, overviewStats, listColleges, updateCandidateStatus, deleteCandidate, getCandidateResume,
  getCandidateAnswers, terminateCandidate, refreshTestCode,
  roundSummary, candidateJourney, moveToTechnical,
} = require("../controllers/assessmentController");
const { authAdmin, requireFullAdmin } = require("../middleware/auth");

// GET = readable by admin AND read-only viewer. Mutating = full admin only.
router.get   ("/",            authAdmin, listAssessments);
router.post  ("/",            authAdmin, requireFullAdmin, createAssessment);
router.get   ("/overview",    authAdmin, overviewStats);
router.get   ("/colleges",    authAdmin, listColleges);
router.get   ("/candidates",  authAdmin, listCandidates);
router.get   ("/candidate-stats", authAdmin, candidateStats);
router.post  ("/candidates",  authAdmin, requireFullAdmin, uploadCandidates);
router.post  ("/schedule",    authAdmin, requireFullAdmin, scheduleEmails);
router.patch ("/candidates/status", authAdmin, requireFullAdmin, updateCandidateStatus);
router.get   ("/candidates/:id/resume", authAdmin, getCandidateResume);
router.get   ("/candidates/:id/answers", authAdmin, getCandidateAnswers);
// ── Round segregation (Aptitude / Technical) ──
router.get   ("/rounds/summary",           authAdmin, roundSummary);
router.get   ("/candidates/:id/journey",   authAdmin, candidateJourney);
router.post  ("/rounds/move-to-technical", authAdmin, requireFullAdmin, moveToTechnical);
router.post  ("/candidates/:id/terminate", authAdmin, requireFullAdmin, terminateCandidate);
router.delete("/candidates/:id",    authAdmin, requireFullAdmin, deleteCandidate);
router.post  ("/:id/refresh-code", authAdmin, requireFullAdmin, refreshTestCode);
router.get   ("/:id",         authAdmin, getAssessment);
router.put   ("/:id",         authAdmin, requireFullAdmin, updateAssessment);
router.delete("/:id",         authAdmin, requireFullAdmin, deleteAssessment);

module.exports = router;
