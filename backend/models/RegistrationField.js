const mongoose = require("mongoose");

/*
 * RegistrationField = an admin-defined field on the candidate registration form.
 *
 * The six defaults (name, email, phone, college, course, branch) are seeded as
 * rows with isSystem:true — they are always mandatory and cannot be deleted,
 * but their label, placeholder, order and validation are editable.
 *
 * Adding CGPA / Graduation Year / LinkedIn / Resume later is an INSERT. No
 * schema change, no frontend edit, no deploy: the walk-in portal renders
 * whatever this collection returns for the drive.
 *
 * Scope: driveId = null  → applies to every drive in the workspace
 *        driveId = <id>  → applies to that drive only (overrides the default)
 */

const FIELD_TYPES = ["TEXT", "NUMBER", "EMAIL", "PHONE", "DROPDOWN", "DATE", "FILE", "TEXTAREA", "CHECKBOX", "RADIO"];

const fieldSchema = new mongoose.Schema({
  workspaceId: { type: mongoose.Schema.Types.ObjectId, ref: "Workspace", required: true, index: true },
  driveId:     { type: mongoose.Schema.Types.ObjectId, ref: "Drive", default: null, index: true },

  fieldKey:  { type: String, required: true, trim: true },   // "cgpa" — stable machine key
  fieldName: { type: String, required: true, trim: true },   // "CGPA" — shown to the student
  fieldType: { type: String, enum: FIELD_TYPES, default: "TEXT" },

  required:    { type: Boolean, default: false },
  order:       { type: Number, default: 100 },
  placeholder: { type: String, default: "" },
  helpText:    { type: String, default: "" },
  options:     { type: [String], default: [] },   // DROPDOWN / RADIO / CHECKBOX

  validation: {
    min:       { type: Number, default: null },   // NUMBER / DATE lower bound
    max:       { type: Number, default: null },
    minLength: { type: Number, default: null },
    maxLength: { type: Number, default: null },
    regex:     { type: String, default: "" },
    message:   { type: String, default: "" },     // shown when validation fails
  },

  // The six defaults. Always required, never deletable, key never editable.
  isSystem: { type: Boolean, default: false },
  // Where a system field is stored on the Student document.
  mapsTo:   { type: String, default: "" },        // name | email | phone | college | course | branch

  isActive: { type: Boolean, default: true },
}, { timestamps: true });

fieldSchema.index({ workspaceId: 1, driveId: 1, fieldKey: 1 }, { unique: true });
fieldSchema.index({ workspaceId: 1, driveId: 1, order: 1 });

fieldSchema.statics.FIELD_TYPES = FIELD_TYPES;

// The six mandatory defaults, seeded for every new workspace.
fieldSchema.statics.SYSTEM_FIELDS = [
  { fieldKey: "name",    fieldName: "Full Name",      fieldType: "TEXT",  required: true, order: 1, isSystem: true, mapsTo: "name",    placeholder: "As per your college records" },
  { fieldKey: "email",   fieldName: "Email",          fieldType: "EMAIL", required: true, order: 2, isSystem: true, mapsTo: "email",   placeholder: "you@example.com" },
  { fieldKey: "phone",   fieldName: "Contact Number", fieldType: "PHONE", required: true, order: 3, isSystem: true, mapsTo: "phone",   placeholder: "10-digit mobile number",
    validation: { regex: "^[6-9]\\d{9}$", message: "Enter a valid 10-digit mobile number." } },
  { fieldKey: "college", fieldName: "College Name",   fieldType: "TEXT",  required: true, order: 4, isSystem: true, mapsTo: "college" },
  { fieldKey: "course",  fieldName: "Course",         fieldType: "TEXT",  required: true, order: 5, isSystem: true, mapsTo: "course",  placeholder: "e.g. BE, B.Tech, MCA" },
  { fieldKey: "branch",  fieldName: "Branch",         fieldType: "TEXT",  required: true, order: 6, isSystem: true, mapsTo: "branch",  placeholder: "e.g. Computer Science" },
];

module.exports = mongoose.model("RegistrationField", fieldSchema);
