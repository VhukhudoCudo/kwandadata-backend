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
  network: z.string().min(1),
  dob: z.string(),
  gender: z.string().min(1),
  language: z.string().min(1),
  province: z.string().min(1),
  region: z.string().min(1),
  employment: z.string().min(1),
  usedReferralOf: z.string().optional(),
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
      dob: new Date(data.dob),
      gender: data.gender,
      language: data.language,
      province: data.province,
      region: data.region,
      employment: data.employment,
      referralCode: generateReferralCode(data.firstName, data.lastName),
      usedReferralOf: data.usedReferralOf,
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

  const token = jwt.sign({ userId: user.id, role: user.role }, process.env.JWT_SECRET!, {
    expiresIn: "7d",
  });

  const { passwordHash: _, ...safeUser } = user;
  res.json({ user: safeUser, token });
});

export default router;