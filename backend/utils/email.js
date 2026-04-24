const nodemailer = require("nodemailer");

let transporter = null;

function getTransporter() {
  if (transporter) return transporter;
  transporter = nodemailer.createTransport({
    host:   process.env.EMAIL_HOST || "smtp.gmail.com",
    port:   parseInt(process.env.EMAIL_PORT) || 587,
    secure: false,
    auth: {
      user: process.env.EMAIL_USER,
      pass: process.env.EMAIL_PASS,
    },
    pool: true,
    maxConnections: 5,
    rateDelta: 1000,
    rateLimit: 5,
  });
  return transporter;
}

async function sendQuizLink(to, name, quizLink) {
  try {
    const t = getTransporter();
    await t.sendMail({
      from:    process.env.EMAIL_FROM || "Mandi Hariyanna Academy <noreply@mha.com>",
      to,
      subject: "Your Quiz Link — Mandi Hariyanna Academy",
      html: `
        <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;background:#fff;border-radius:12px;overflow:hidden;border:1px solid #e5e7eb;">
          <div style="background:linear-gradient(135deg,#1a56db,#1e40af);padding:32px 28px;text-align:center;">
            <h1 style="color:#fff;margin:0;font-size:22px;letter-spacing:-0.5px;">Mandi Hariyanna Academy</h1>
            <p style="color:rgba(255,255,255,0.8);margin:6px 0 0;font-size:13px;">Mandi Harish Foundation®</p>
          </div>
          <div style="padding:32px 28px;">
            <h2 style="color:#111827;font-size:18px;margin:0 0 12px;">Hello, ${name}! 👋</h2>
            <p style="color:#4b5563;font-size:14px;line-height:1.6;margin:0 0 20px;">
              You have successfully registered for the online quiz. Click the button below to start your quiz.
            </p>
            <div style="text-align:center;margin:28px 0;">
              <a href="${quizLink}" style="background:#1a56db;color:#fff;padding:14px 36px;border-radius:8px;text-decoration:none;font-weight:700;font-size:15px;display:inline-block;">
                Start Quiz →
              </a>
            </div>
            <div style="background:#f9fafb;border:1px solid #e5e7eb;border-radius:8px;padding:16px;margin-top:20px;">
              <p style="color:#6b7280;font-size:12px;margin:0;"><strong>Important:</strong></p>
              <ul style="color:#6b7280;font-size:12px;margin:8px 0 0 16px;line-height:1.8;">
                <li>This link is unique to you — do not share it.</li>
                <li>You can only attempt the quiz once.</li>
                <li>Ensure a stable internet connection during the quiz.</li>
              </ul>
            </div>
            <p style="color:#9ca3af;font-size:12px;margin:24px 0 0;text-align:center;">
              Or copy this link: <span style="color:#1a56db;">${quizLink}</span>
            </p>
          </div>
        </div>
      `,
    });
    return true;
  } catch (err) {
    console.error("Email send error:", err.message);
    return false;
  }
}

module.exports = { sendQuizLink };
