const mongoose = require("mongoose");

const questionSchema = new mongoose.Schema({
  text:         { type: String, required: true, trim: true },
  options:      { type: [String], required: true, validate: v => v.length === 4 },
  correctIndex: { type: Number, required: true, min: 0, max: 3 },
  marks:        { type: Number, default: 1, min: 1 },
  section:      { type: String, required: true, trim: true, index: true }, // no enum — supports custom sections
  order:        { type: Number, default: 0 },
}, { timestamps: true });

questionSchema.index({ section: 1, order: 1 });

module.exports = mongoose.model("Question", questionSchema);
