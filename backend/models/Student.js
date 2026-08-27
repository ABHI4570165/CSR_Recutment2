const mongoose = require("mongoose");

/*
 * Student = the MASTER PERSON. One document per human being, globally.
 *
 * A student is NOT owned by a workspace — the same person may apply to several
 * companies. What keeps those histories separate is the CandidateApplication:
 * one per (workspace, drive, student). Nothing about Company A's process is
 * readable from Company B's application.
 *
 *   Student(Rahul)
 *     ├── Application → Workspace A / Drive A   (its own round results)
 *     └── Application → Workspace B / Drive B   (its own round results)
 */

const studentSchema = new mongoose.Schema({
  // Identity. Email is the canonical key; phone is the secondary identifier.
  email: { type: String, required: true, unique: true, lowercase: true, trim: true },
  alternateEmails: { type: [String], default: [] },   // merged duplicates, never discarded
  phone: { type: String, trim: true, index: true },

  // The six default mandatory fields (see models/RegistrationField.js).
  name:    { type: String, required: true, trim: true },
  college: { type: String, trim: true, default: "" },
  course:  { type: String, trim: true, default: "" },
  branch:  { type: String, trim: true, default: "" },

  // Answers to admin-defined registration fields, keyed by fieldKey.
  // Adding "cgpa" or "graduationYear" needs no schema change.
  customFields: { type: Map, of: mongoose.Schema.Types.Mixed, default: () => ({}) },

  needsReview:  { type: Boolean, default: false, index: true },
  reviewReason: { type: String, default: "" },
}, { timestamps: true });

studentSchema.index({ name: 1 });
studentSchema.index({ college: 1 });

module.exports = mongoose.model("Student", studentSchema);
