import { Router } from "express";
import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";
import crypto from "crypto";
import { z } from "zod";
import { prisma } from "../lib/prisma.js";
import { sendVerificationEmail } from "../lib/email.js";
import { requireAuth, AuthRequest } from "../middleware/auth.js";

const router = Router();
const registerSchema = z.object({
  firstName: z.string().min(1),
  lastName: z.string().min(1),
  email: z.string().email(),
  password: z.string().min(6),
  phone: z.string().min(1),
  network: z.string().min(1).optional(),
  dob: z.string().optional(),
  gender: z.string().min(1).optional(),
  language: z.string().min(1).optional(),
  province: z.string().min(1).optional(),
  region: z.string().min(1).optional(),
  employment: z.string().min(1).optional(),
  company: z.string().min(1).optional(),
  industry: z.string().min(1).optional(),
  usedReferralOf: z.string().optional(),
  role: z.enum(["USER", "ADVERTISER"]).optional(),
});

function generateReferralCode(first: string, last: string) {
  const prefix = (first[0] + last[0]).toUpperCase();
  const random = Math.floor(1000 + Math.random() * 9000);
  return `KW${prefix}${random}`;
}

router.post("/register", async (req, res) => {
  const parsed = registerSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.flatten() });
  }
  const data = parsed.data;
  const isAdvertiser = data.role === "ADVERTISER";

  if (isAdvertiser) {
    if (!data.company || !data.industry) {
      return res.status(400).json({ error: "company and industry are required for advertiser accounts." });
    }
  } else {
    if (!data.network || !data.dob || !data.gender || !data.language || !data.province || !data.region || !data.employment) {
      return res.status(400).json({ error: "network, dob, gender, language, province, region, and employment are required." });
    }
  }

  const existing = await prisma.user.findUnique({ where: { email: data.email } });
  if (existing) {
    return res.status(409).json({ error: "An account with this email already exists." });
  }

  const passwordHash = await bcrypt.hash(data.password, 12);
  const verificationToken = crypto.randomBytes(32).toString("hex");
  const verificationExpires = new Date(Date.now() + 24 * 60 * 60 * 1000);

  const user = await prisma.user.create({
    data: {
      firstName: data.firstName,
      lastName: data.lastName,
      email: data.email,
      passwordHash,
      phone: data.phone,
      network: data.network,
      dob: data.dob ? new Date(data.dob) : undefined,
      gender: data.gender,
      language: data.language,
      province: data.province,
      region: data.region,
      employment: data.employment,
      company: data.company,
      industry: data.industry,
      referralCode: generateReferralCode(data.firstName, data.lastName),
      usedReferralOf: data.usedReferralOf,
      role: data.role ?? "USER",
      verificationToken,
      verificationExpires,
      wallet: { create: {} },
    },
  });

  await sendVerificationEmail(user.email, user.firstName, verificationToken);

  const token = jwt.sign({ userId: user.id, role: user.role }, process.env.JWT_SECRET!, {
    expiresIn: "7d",
  });

  const { passwordHash: _, verificationToken: __, ...safeUser } = user;
  res.status(201).json({ user: safeUser, token });
});

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

router.post("/login", async (req, res) => {
  const parsed = loginSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.flatten() });
  }
  const { email, password } = parsed.data;

  const user = await prisma.user.findUnique({ where: { email } });
  if (!user) {
    return res.status(401).json({ error: "Incorrect email or password." });
  }

  const valid = await bcrypt.compare(password, user.passwordHash);
  if (!valid) {
    return res.status(401).json({ error: "Incorrect email or password." });
  }

  if (user.suspended) {
    return res.status(403).json({ error: "This account has been suspended. Contact support for assistance." });
  }

  const token = jwt.sign({ userId: user.id, role: user.role }, process.env.JWT_SECRET!, {
    expiresIn: "7d",
  });

  const { passwordHash: _, ...safeUser } = user;
  res.json({ user: safeUser, token });
});

// Verify a user's email using the token from their verification link
router.get("/verify-email", async (req, res) => {
  const token = typeof req.query.token === "string" ? req.query.token : undefined;
  if (!token) {
    return res.status(400).json({ error: "Verification token is required." });
  }

  const user = await prisma.user.findUnique({ where: { verificationToken: token } });
  if (!user || !user.verificationExpires || user.verificationExpires < new Date()) {
    return res.status(400).json({ error: "This verification link is invalid or has expired." });
  }

  await prisma.user.update({
    where: { id: user.id },
    data: { emailVerified: true, verificationToken: null, verificationExpires: null },
  });

  res.json({ message: "Email verified successfully." });
});

// Resend the verification email (for a logged-in but unverified user)
router.post("/resend-verification", requireAuth, async (req: AuthRequest, res) => {
  const user = await prisma.user.findUnique({ where: { id: req.userId } });
  if (!user) {
    return res.status(404).json({ error: "User not found." });
  }
  if (user.emailVerified) {
    return res.status(400).json({ error: "Your email is already verified." });
  }

  const verificationToken = crypto.randomBytes(32).toString("hex");
  const verificationExpires = new Date(Date.now() + 24 * 60 * 60 * 1000);

  await prisma.user.update({
    where: { id: user.id },
    data: { verificationToken, verificationExpires },
  });

  await sendVerificationEmail(user.email, user.firstName, verificationToken);

  res.json({ message: "Verification email sent." });
});

export default router;