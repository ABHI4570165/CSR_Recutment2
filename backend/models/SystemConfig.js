const mongoose = require("mongoose");

/*
 * Singleton system/runtime config — currently holds "Assessment Active Mode"
 * (Render keep-awake) state + a small rolling audit log. One document only.
 */
const logEntrySchema = new mongoose.Schema({
  action: { type: String },          // enabled | disabled | auto-disabled | extended | heartbeat
  by:     { type: String },          // admin username (or "system")
  at:     { type: Date, default: Date.now },
}, { _id: false });

const systemConfigSchema = new mongoose.Schema({
  _id:           { type: String, default: "singleton" },
  activeMode:    { type: Boolean, default: false },
  activatedAt:   { type: Date },
  autoOffAt:     { type: Date },     // server auto-disables Active Mode at this time
  lastHeartbeat: { type: Date },
  updatedBy:     { type: String },
  log:           { type: [logEntrySchema], default: [] },
}, { timestamps: true });

systemConfigSchema.statics.getSingleton = async function () {
  let doc = await this.findById("singleton");
  if (!doc) doc = await this.create({ _id: "singleton" });
  return doc;
};

module.exports = mongoose.model("SystemConfig", systemConfigSchema);
