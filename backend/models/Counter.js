const mongoose = require("mongoose");

/*
 * Atomic global sequence generator (e.g. walk-in test codes).
 * One document per named sequence; `seq` is incremented atomically so codes
 * are always unique and never reused, regardless of concurrency.
 */
const counterSchema = new mongoose.Schema({
  _id: { type: String },      // sequence name, e.g. "testCode"
  seq: { type: Number, default: 0 },
});

// Returns the next integer in the named sequence (atomic, upserts on first use).
counterSchema.statics.next = async function (name) {
  const doc = await this.findOneAndUpdate(
    { _id: name },
    { $inc: { seq: 1 } },
    { new: true, upsert: true }
  );
  return doc.seq;
};

module.exports = mongoose.model("Counter", counterSchema);
