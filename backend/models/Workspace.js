const mongoose = require("mongoose");

/*
 * Workspace = one company / recruiting organisation.
 *
 * The top of the whole recruitment tree:
 *   Workspace → Drive → Round → Assessment(test) → Candidate attempt → Result
 *
 * Every workspace is fully isolated. Nothing in this collection is shared, and
 * every downstream document carries workspaceId so the backend can scope reads
 * without ever trusting an id supplied by the browser.
 */

const workspaceSchema = new mongoose.Schema({
  name:        { type: String, required: true, trim: true },   // "Inference Labs Pvt Ltd"
  companyName: { type: String, trim: true, default: "" },      // legal / display name
  slug:        { type: String, required: true, unique: true, lowercase: true, trim: true },

  // Company logo — reuses the existing Cloudinary util (falls back to a data URL).
  logo: {
    url:      { type: String },
    publicId: { type: String },
  },

  // Free-form company details shown on the final-selection page.
  details: {
    website:  { type: String, trim: true, default: "" },
    industry: { type: String, trim: true, default: "" },
    location: { type: String, trim: true, default: "" },
    contactEmail: { type: String, trim: true, default: "" },
    about:    { type: String, trim: true, default: "" },
  },

  // Branding for the decorated final-selection page.
  branding: {
    primaryColor: { type: String, default: "#4F46E5" },
    accentColor:  { type: String, default: "#0891B2" },
  },

  isActive:  { type: Boolean, default: true, index: true },
  createdBy: { type: String, default: "" },   // admin username
}, { timestamps: true });

workspaceSchema.index({ isActive: 1, createdAt: -1 });

module.exports = mongoose.model("Workspace", workspaceSchema);
