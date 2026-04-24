const mongoose = require("mongoose");

const sectionSchema = new mongoose.Schema({
  name:          { type: String, required: true, trim: true },   // internal key e.g. "aptitude"
  displayName:   { type: String, required: true, trim: true },   // shown to user e.g. "Aptitude"
  questionCount: { type: Number, default: 20, min: 1 },
  color:         { type: String, default: "#4F46E5" },            // hex color for UI
}, { _id: false });

const configSchema = new mongoose.Schema({
  timeLimitMinutes: { type: Number, default: 40, min: 1, max: 300 },
  passingScore:     { type: Number, default: 30 },
  sections: {
    type: [sectionSchema],
    default: [
      { name:"aptitude", displayName:"Aptitude",          questionCount:20, color:"#4F46E5" },
      { name:"logical",  displayName:"Logical Reasoning", questionCount:20, color:"#7C3AED" },
      { name:"english",  displayName:"English",           questionCount:20, color:"#0891B2" },
    ],
  },
  isActive: { type: Boolean, default: true },
}, { timestamps: true });

module.exports = mongoose.model("QuizConfig", configSchema);
