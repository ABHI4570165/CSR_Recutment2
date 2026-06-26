const cloudinary = require("cloudinary").v2;

/*
 * Cloudinary config. Supports either:
 *   - CLOUDINARY_URL=cloudinary://<api_key>:<api_secret>@<cloud_name>   (single var)
 *   - or CLOUDINARY_CLOUD_NAME / CLOUDINARY_API_KEY / CLOUDINARY_API_SECRET
 */
let configured = false;
(function init() {
  try {
    if (process.env.CLOUDINARY_URL) {
      cloudinary.config({ secure: true }); // SDK auto-reads CLOUDINARY_URL from env
      configured = true;
    } else if (process.env.CLOUDINARY_CLOUD_NAME && process.env.CLOUDINARY_API_KEY && process.env.CLOUDINARY_API_SECRET) {
      cloudinary.config({
        cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
        api_key:    process.env.CLOUDINARY_API_KEY,
        api_secret: process.env.CLOUDINARY_API_SECRET,
        secure: true,
      });
      configured = true;
    }
  } catch { configured = false; }
})();

function cloudinaryConfigured() { return configured; }

// Upload a resume (data URL) to Cloudinary as a raw file. Returns { url, publicId, ext }.
// IMPORTANT: keep the original extension in the public_id so the delivery URL ends
// in .pdf/.doc/.docx — otherwise browsers receive octet-stream and the file is
// downloaded without an extension (unreadable). Fixes the resume-viewing bug.
async function uploadResume(dataUrl, filename = "resume") {
  const m = String(filename).match(/\.([a-z0-9]+)$/i);
  const ext = m ? `.${m[1].toLowerCase()}` : "";
  const base = String(filename).replace(/\.[^.]+$/, "").replace(/[^a-z0-9]+/gi, "_").slice(0, 60) || "resume";
  const res = await cloudinary.uploader.upload(dataUrl, {
    resource_type: "raw",                // PDFs/DOCs delivered as the original file
    folder: process.env.CLOUDINARY_FOLDER || "mh_resumes",
    public_id: `${Date.now()}_${base}${ext}`,   // keep extension on the URL
    use_filename: false,
    overwrite: false,
  });
  return { url: res.secure_url, publicId: res.public_id, ext: ext.replace(".", "") };
}

async function deleteResume(publicId) {
  if (!publicId) return;
  try { await cloudinary.uploader.destroy(publicId, { resource_type: "raw" }); } catch { /* ignore */ }
}

module.exports = { cloudinaryConfigured, uploadResume, deleteResume };
