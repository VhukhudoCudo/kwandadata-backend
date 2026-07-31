import { Router } from "express";
import { prisma } from "../lib/prisma.js";
import { requireAuth, requireRole, AuthRequest } from "../middleware/auth.js";
import { z } from "zod";

const router = Router();

async function getOrCreateSettings() {
  const existing = await prisma.appSettings.findUnique({ where: { id: "singleton" } });
  if (existing) return existing;
  return prisma.appSettings.create({ data: { id: "singleton" } });
}

// Public: current pricing, split, and maintenance state (used for maintenance banner, admin prefill)
router.get("/", async (_req, res) => {
  const settings = await getOrCreateSettings();
  res.json({ settings });
});

const pricingSchema = z.object({
  survey: z.number().positive(),
  video: z.number().positive(),
  quiz: z.number().positive(),
  download: z.number().positive(),
  signup: z.number().positive(),
});

// Admin: update campaign task pricing
router.patch("/pricing", requireAuth, requireRole("ADMIN"), async (req: AuthRequest, res) => {
  const parsed = pricingSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.flatten() });
  }

  await getOrCreateSettings();
  const settings = await prisma.appSettings.update({
    where: { id: "singleton" },
    data: { prices: parsed.data },
  });

  res.json({ message: "Pricing saved. New prices apply immediately.", settings });
});

const splitSchema = z.object({
  splitAdmin: z.number().min(0),
  splitData: z.number().min(0),
  vatRate: z.number().min(0).max(100).optional(),
});

// Admin: update the earnings split (wallet share is always the remainder)
router.patch("/splits", requireAuth, requireRole("ADMIN"), async (req: AuthRequest, res) => {
  const parsed = splitSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.flatten() });
  }
  const { splitAdmin, splitData, vatRate } = parsed.data;

  if (splitAdmin + splitData > 100) {
    return res.status(400).json({ error: "Admin fee and data split together can't exceed 100%." });
  }

  await getOrCreateSettings();
  const settings = await prisma.appSettings.update({
    where: { id: "singleton" },
    data: {
      splitAdmin,
      splitData,
      ...(vatRate !== undefined ? { vatRate } : {}),
    },
  });

  res.json({ message: "Earnings split saved. Applies immediately.", settings });
});

const referralBonusSchema = z.object({
  referralBonus: z.number().min(0),
});

// Admin: update how much a referrer earns when someone registers using their code
router.patch("/referral-bonus", requireAuth, requireRole("ADMIN"), async (req: AuthRequest, res) => {
  const parsed = referralBonusSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.flatten() });
  }

  await getOrCreateSettings();
  const settings = await prisma.appSettings.update({
    where: { id: "singleton" },
    data: { referralBonus: parsed.data.referralBonus },
  });

  res.json({ message: "Referral bonus saved.", settings });
});

const maintenanceSchema = z.object({
  enabled: z.boolean().optional(),
  message: z.string().optional(),
});

// Admin: toggle maintenance mode and/or update its message
router.patch("/maintenance", requireAuth, requireRole("ADMIN"), async (req: AuthRequest, res) => {
  const parsed = maintenanceSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.flatten() });
  }

  await getOrCreateSettings();
  const settings = await prisma.appSettings.update({
    where: { id: "singleton" },
    data: {
      ...(parsed.data.enabled !== undefined ? { maintenanceEnabled: parsed.data.enabled } : {}),
      ...(parsed.data.message !== undefined ? { maintenanceMessage: parsed.data.message } : {}),
    },
  });

  res.json({ message: "Maintenance settings saved.", settings });
});

export default router;