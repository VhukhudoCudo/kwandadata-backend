import { Resend } from "resend";

const RESEND_KEY = process.env.RESEND_API_KEY;
const resend = RESEND_KEY ? new Resend(RESEND_KEY) : null;
if (!resend) {
  console.warn("RESEND_API_KEY is not set — emails will be skipped instead of sent.");
}
const FROM_EMAIL = process.env.EMAIL_FROM || "KwandaData <onboarding@resend.dev>";
const FRONTEND_URL = process.env.FRONTEND_URL || "https://kwandadata.netlify.app";

export async function sendPasswordResetEmail(to: string, firstName: string, token: string) {
  if (!resend) {
    console.warn("Skipping password reset email (RESEND_API_KEY not set):", to);
    return;
  }
  const link = `${FRONTEND_URL}/#reset-password?token=${token}`;
  try {
    const result = await resend.emails.send({
      from: FROM_EMAIL,
      to,
      subject: "Reset your KwandaData password",
      html: `
        <p>Hi ${firstName},</p>
        <p>We received a request to reset your password. Click the link below to set a new one:</p>
        <p><a href="${link}">Reset my password</a></p>
        <p>This link expires in 1 hour. If you didn't request this, you can safely ignore this email.</p>
        <p>— The KwandaData Team</p>
      `,
    });
    if (result.error) {
      console.error("Resend rejected the password reset email:", result.error);
    } else {
      console.log("Password reset email sent, id:", result.data?.id);
    }
  } catch (err) {
    console.error("Failed to send password reset email:", err);
  }
}

export async function sendRedemptionCodeEmail(to: string, firstName: string, code: string, description: string, amount: number) {
  if (!resend) {
    console.warn("Skipping redemption code email (RESEND_API_KEY not set):", to);
    return;
  }
  try {
    const result = await resend.emails.send({
      from: FROM_EMAIL,
      to,
      subject: `Your KwandaData redemption code: ${code}`,
      html: `
        <p>Hi ${firstName},</p>
        <p>Here's your redemption code, as a backup in case you need it later:</p>
        <p style="font-size:24px;font-weight:bold;letter-spacing:2px;">${code}</p>
        <p>${description} — R ${amount.toFixed(2)}</p>
        <p>Keep this email for your records.</p>
        <p>— The KwandaData Team</p>
      `,
    });
    if (result.error) {
      console.error("Resend rejected the redemption code email:", result.error);
    } else {
      console.log("Redemption code email sent, id:", result.data?.id);
    }
  } catch (err) {
    console.error("Failed to send redemption code email:", err);
  }
}