const mongoose = require("mongoose");

const userSchema = new mongoose.Schema({
  name:       { type: String, required: true, trim: true },
  email:      { type: String, required: true, unique: true, lowercase: true, trim: true },
  college:    { type: String, required: true, trim: true },
  rollNo:     { type: String, required: true, unique: true, trim: true },
  phone:      { type: String, required: true, trim: true },
  quizToken:  { type: String },                      // JWT for quiz access
  quizStarted:   { type: Boolean, default: false },
  quizCompleted: { type: Boolean, default: false },
  score:         { type: Number, default: null },
  totalMarks:    { type: Number, default: null },
}, { timestamps: true });

// Compound + single indexes for fast lookups
// (email & rollNo already get unique indexes from their field definitions)
userSchema.index({ score: -1 });
userSchema.index({ quizCompleted: 1 });
userSchema.index({ createdAt: -1 });

module.exports = mongoose.model("User", userSchema);
