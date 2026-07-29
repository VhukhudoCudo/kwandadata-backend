import { Resend } from "resend";

const resend = new Resend(process.env.RESEND_API_KEY);
const FROM_EMAIL = process.env.EMAIL_FROM || "KwandaData <onboarding@resend.dev>";
const FRONTEND_URL = process.env.FRONTEND_URL || "https://kwandadata.netlify.app";

export async function sendVerificationEmail(to: string, firstName: string, token: string) {
  const link = `${FRONTEND_URL}/#verify-email?token=${token}`;
  try {
    await resend.emails.send({
      from: FROM_EMAIL,
      to,
      subject: "Verify your KwandaData account",
      html: `
        <p>Hi ${firstName},</p>
        <p>Welcome to KwandaData! Please verify your email address by clicking the link below:</p>
        <p><a href="${link}">Verify my email</a></p>
        <p>This link expires in 24 hours.</p>
        <p>— The KwandaData Team</p>
      `,
    });
  } catch (err) {
    console.error("Failed to send verification email:", err);
  }
}

export async function sendPasswordResetEmail(to: string, firstName: string, token: string) {
  const link = `${FRONTEND_URL}/#reset-password?token=${token}`;
  try {
    await resend.emails.send({
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
  } catch (err) {
    console.error("Failed to send password reset email:", err);
  }
}