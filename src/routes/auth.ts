import { Router } from "express";
import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";
import { z } from "zod";
import { prisma } from "../lib/prisma.js";

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
      wallet: { create: {} },
    },
  });

  const token = jwt.sign({ userId: user.id, role: user.role }, process.env.JWT_SECRET!, {
    expiresIn: "7d",
  });

  const { passwordHash: _, ...safeUser } = user;
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

export default router;