/*
 * Seed the Trainers Recutment → Screening Round emails.
 *
 * This round hires a trainer FOR THE ACADEMY ITSELF, so nothing here mentions the
 * hiring partner the built-in emails carry ("Inference Labs Private Limited").
 * Only the academy's own name and logo appear.
 *
 * Three emails, and exactly ONE of them goes out when a candidate is added:
 *   ASSESSMENT_LINK  the invitation, carrying the test link and the time frame
 *   SUBMITTED        sent the moment the candidate finishes
 *   TERMINATED       sent if the session is auto-terminated
 * SHORTLIST is deliberately set to "send nothing", otherwise the built-in
 * shortlist email would go out alongside the invitation and the candidate would
 * receive two emails at the same moment.
 *
 * The date and times come from the DRIVE the candidate belongs to, through the
 * {{date}} / {{startTime}} / {{endTime}} placeholders — never hard-coded here.
 *
 *   node scripts/seedTrainerEmails.js            # apply
 *   node scripts/seedTrainerEmails.js --dry      # show what would change
 */
require("dotenv").config();
const mongoose = require("mongoose");
const EmailTemplate = require("../models/EmailTemplate");
const EmailWorkflow = require("../models/EmailWorkflow");
const Round = require("../models/Round");

const WORKSPACE = "6a9003330c14d3b176c2dfdb";   // Trainers Recutment
const ROUND     = "6a9003fa0c14d3b176c2e020";   // Screening Round

// The logo URL is baked into the stored HTML, so it must be the PUBLIC origin —
// not whatever this machine's .env happens to hold. Many mail clients will not
// follow a redirect for an image, so a redirecting host silently shows nothing.
const SITE = (process.argv.find(a => a.startsWith("--site=")) || "").split("=")[1]
          || "https://assessment.mandi-hariyanna-academy.com";
const LOGO = `${SITE.replace(/\/+$/, "")}/logo.png`;

// One shell so all three emails look like the same academy sent them.
const shell = (accent, heading, inner) => `
<div style="margin:0;padding:24px 12px;background:#f4f6fb;font-family:Arial,Helvetica,sans-serif;">
  <div style="max-width:600px;margin:0 auto;background:#ffffff;border-radius:14px;overflow:hidden;box-shadow:0 2px 10px rgba(16,24,40,.06);">
    <div style="background:${accent};padding:22px 24px;text-align:center;">
      <img src="${LOGO}" alt="{{brand}}" width="60" height="60" style="display:block;margin:0 auto 10px;border-radius:12px;background:#fff;padding:4px;" />
      <div style="color:#ffffff;font-size:19px;font-weight:700;letter-spacing:.3px;">{{brand}}</div>
      <div style="color:rgba(255,255,255,.85);font-size:13px;margin-top:2px;">${heading}</div>
    </div>
    <div style="padding:26px 24px;color:#1f2937;font-size:15px;line-height:1.65;">
${inner}
    </div>
    <div style="padding:16px 24px;background:#f8fafc;border-top:1px solid #eef2f7;color:#6b7280;font-size:12px;text-align:center;">
      This message was sent by {{brand}} regarding your application for the trainer role.<br/>
      Please do not reply to this email.
    </div>
  </div>
</div>`.trim();

const TEMPLATES = [
  {
    key: "invite",
    name: "Trainer Screening — Assessment Invitation",
    trigger: "ASSESSMENT_LINK",
    subject: "Your {{roundName}} assessment link — {{brand}}",
    html: shell("#4F46E5", "Trainer Recruitment", `
      <p style="margin:0 0 14px;">Dear {{name}},</p>
      <p style="margin:0 0 14px;">
        Thank you for applying for the <strong>Trainer</strong> role at {{brand}}.
        Your screening assessment is ready and you can begin using the button below.
      </p>
      <table role="presentation" cellpadding="0" cellspacing="0" style="width:100%;margin:18px 0;border-collapse:collapse;background:#f8fafc;border:1px solid #e5e7eb;border-radius:10px;">
        <tr><td style="padding:10px 14px;color:#6b7280;font-size:13px;">Assessment date</td>
            <td style="padding:10px 14px;font-weight:700;text-align:right;">{{date}}</td></tr>
        <tr><td style="padding:10px 14px;color:#6b7280;font-size:13px;border-top:1px solid #eef2f7;">Portal opens</td>
            <td style="padding:10px 14px;font-weight:700;text-align:right;border-top:1px solid #eef2f7;">{{startTime}}</td></tr>
        <tr><td style="padding:10px 14px;color:#6b7280;font-size:13px;border-top:1px solid #eef2f7;">Portal closes</td>
            <td style="padding:10px 14px;font-weight:700;text-align:right;border-top:1px solid #eef2f7;">{{endTime}}</td></tr>
      </table>
      <p style="text-align:center;margin:26px 0;">
        <a href="{{link}}" style="background:#4F46E5;color:#ffffff;padding:13px 34px;border-radius:8px;text-decoration:none;font-weight:700;display:inline-block;">Start assessment</a>
      </p>
      <p style="margin:0 0 10px;color:#6b7280;font-size:13px;">
        If the button does not work, copy this link into your browser:<br/>
        <span style="word-break:break-all;">{{link}}</span>
      </p>
      <p style="margin:16px 0 0;font-size:13px;color:#6b7280;">
        Please use a laptop or desktop with a working webcam and a stable connection,
        and finish the assessment in one sitting once you begin.
      </p>`),
  },
  {
    key: "completed",
    name: "Trainer Screening — Assessment Completed",
    trigger: "SUBMITTED",
    subject: "We have received your {{roundName}} assessment — {{brand}}",
    html: shell("#059669", "Trainer Recruitment", `
      <p style="margin:0 0 14px;">Dear {{name}},</p>
      <p style="margin:0 0 14px;">
        Thank you for completing the <strong>{{roundName}}</strong> assessment for the Trainer role at {{brand}}.
        Your responses have been recorded successfully.
      </p>
      <p style="margin:0 0 14px;">
        Our team will review your submission and contact you about the next stage.
        No further action is needed from you at this point.
      </p>
      <p style="margin:22px 0 0;">Warm regards,<br/><strong>{{brand}}</strong></p>`),
  },
  {
    key: "terminated",
    name: "Trainer Screening — Session Terminated",
    trigger: "TERMINATED",
    subject: "Your {{roundName}} assessment session was terminated — {{brand}}",
    html: shell("#DC2626", "Trainer Recruitment", `
      <p style="margin:0 0 14px;">Dear {{name}},</p>
      <p style="margin:0 0 14px;">
        Your <strong>{{roundName}}</strong> assessment session for the Trainer role at {{brand}}
        was <strong>terminated automatically</strong> because activity outside the assessment
        guidelines was detected during the test.
      </p>
      <p style="margin:0 0 14px;">
        Your session has been closed and cannot be resumed. If you believe this was a
        technical problem rather than a guideline breach, reply to the team that
        contacted you and we will look into it.
      </p>
      <p style="margin:22px 0 0;">Regards,<br/><strong>{{brand}}</strong></p>`),
  },
];

// SHORTLIST is silenced so only ONE email reaches the candidate when they are added.
const WORKFLOW = [
  { trigger: "SHORTLIST",       key: null },
  { trigger: "ASSESSMENT_LINK", key: "invite" },
  { trigger: "SUBMITTED",       key: "completed" },
  { trigger: "TERMINATED",      key: "terminated" },
];

(async () => {
  const dry = process.argv.includes("--dry");
  if (!process.env.MONGO_URI) { console.error("MONGO_URI not set"); process.exit(1); }
  await mongoose.connect(process.env.MONGO_URI, { serverSelectionTimeoutMS: 15000 });

  const round = await Round.findById(ROUND).lean();
  if (!round) { console.error("Screening Round not found"); process.exit(1); }
  console.log(`Round: ${round.name}   logo: ${LOGO}\n`);

  const ids = {};
  for (const t of TEMPLATES) {
    const existing = await EmailTemplate.findOne({ roundId: ROUND, name: t.name });
    if (dry) { console.log(`  ${existing ? "update" : "create"}  ${t.name}`); ids[t.key] = existing?._id || null; continue; }
    const doc = await EmailTemplate.findOneAndUpdate(
      { roundId: ROUND, name: t.name },
      { $set: { workspaceId: WORKSPACE, roundId: ROUND, name: t.name, trigger: t.trigger,
                subject: t.subject, html: t.html, enabled: true } },
      { new: true, upsert: true, setDefaultsOnInsert: true });
    ids[t.key] = doc._id;
    console.log(`  ${existing ? "updated" : "created"}  ${t.name}`);
  }

  console.log("");
  for (const w of WORKFLOW) {
    const templateId = w.key ? ids[w.key] : null;
    const label = w.key ? TEMPLATES.find(t => t.key === w.key).name : "send nothing";
    if (dry) { console.log(`  ${w.trigger.padEnd(16)} -> ${label}`); continue; }
    await EmailWorkflow.findOneAndUpdate(
      { roundId: ROUND, trigger: w.trigger },
      { $set: { workspaceId: WORKSPACE, roundId: ROUND, trigger: w.trigger,
                templateId, enabled: !!templateId } },
      { new: true, upsert: true, setDefaultsOnInsert: true });
    console.log(`  ${w.trigger.padEnd(16)} -> ${label}`);
  }

  await mongoose.disconnect();
  console.log(dry ? "\n(dry run — nothing written)" : "\nDone.");
})().catch((e) => { console.error(e); process.exit(1); });
