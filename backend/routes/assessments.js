const router = require("express").Router();
const {
  createAssessment, listAssessments, getAssessment, updateAssessment, deleteAssessment,
  uploadCandidates, scheduleEmails,
  listCandidates, candidateStats, listColleges, updateCandidateStatus, deleteCandidate,
} = require("../controllers/assessmentController");
const { authAdmin } = require("../middleware/auth");

// All admin-only (campus drive management)
router.get   ("/",            authAdmin, listAssessments);
router.post  ("/",            authAdmin, createAssessment);
router.get   ("/colleges",    authAdmin, listColleges);
router.get   ("/candidates",  authAdmin, listCandidates);
router.get   ("/candidate-stats", authAdmin, candidateStats);
router.post  ("/candidates",  authAdmin, uploadCandidates);
router.post  ("/schedule",    authAdmin, scheduleEmails);
router.patch ("/candidates/status", authAdmin, updateCandidateStatus);
router.delete("/candidates/:id",    authAdmin, deleteCandidate);
router.get   ("/:id",         authAdmin, getAssessment);
router.put   ("/:id",         authAdmin, updateAssessment);
router.delete("/:id",         authAdmin, deleteAssessment);

module.exports = router;
