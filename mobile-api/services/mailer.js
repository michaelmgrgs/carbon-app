/**
 * Sends transactional emails via SMTP (nodemailer).
 *
 * Requires these env vars in .env:
 *   SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, SMTP_FROM
 *
 * Quick option for testing: use a Gmail account with an "App Password"
 * (Google Account > Security > 2-Step Verification > App Passwords):
 *   SMTP_HOST=smtp.gmail.com
 *   SMTP_PORT=587
 *   SMTP_USER=youraddress@gmail.com
 *   SMTP_PASS=your-16-character-app-password
 *   SMTP_FROM="Carbon Gym <youraddress@gmail.com>"
 *
 * For production, a dedicated provider (Resend, SendGrid, Postmark, etc.)
 * is more reliable and has better deliverability than Gmail SMTP — swap
 * the transport config below when you're ready.
 */
const nodemailer = require('nodemailer');

let transporter = null;

function getTransporter() {
  if (transporter) return transporter;

  if (!process.env.SMTP_HOST || !process.env.SMTP_USER || !process.env.SMTP_PASS) {
    return null; // not configured yet
  }

  transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: parseInt(process.env.SMTP_PORT || '587', 10),
    secure: process.env.SMTP_PORT === '465',
    auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
  });
  return transporter;
}

async function sendPasswordResetCode(toEmail, firstName, code) {
  const t = getTransporter();
  if (!t) {
    // Not configured — log it so testing isn't blocked, but make it very
    // visible in the terminal that this isn't actually reaching the user.
    console.warn(
      `\n⚠️  SMTP not configured — password reset code for ${toEmail} is: ${code}\n` +
      `   Add SMTP_HOST/SMTP_USER/SMTP_PASS to .env to actually send emails.\n`
    );
    return { delivered: false };
  }

  await t.sendMail({
    from: process.env.SMTP_FROM || process.env.SMTP_USER,
    to: toEmail,
    subject: 'Your Carbon password reset code',
    html: `
      <div style="font-family: sans-serif; max-width: 480px; margin: 0 auto;">
        <h2 style="color:#141514;">Reset your password</h2>
        <p>Hi ${firstName || 'there'},</p>
        <p>Use this code in the Carbon app to reset your password. It expires in 15 minutes.</p>
        <div style="background:#141514; color:#fff; font-size:32px; font-weight:800; letter-spacing:8px; text-align:center; padding:20px; border-radius:12px; margin:20px 0;">
          ${code}
        </div>
        <p style="color:#888; font-size:13px;">If you didn't request this, you can safely ignore this email.</p>
      </div>
    `,
  });
  return { delivered: true };
}

module.exports = { sendPasswordResetCode };
