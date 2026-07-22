import { Router } from "express";
import { prisma } from "../lib/prisma.js";
import { requireAuth, requireRole, AuthRequest } from "../middleware/auth.js";
import { z } from "zod";

const router = Router();

function generateCode() {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // no ambiguous chars (0/O, 1/I)
  let code = "KW-";
  for (let i = 0; i < 6; i++) {
    code += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return code;
}

// List the current user's Campaign Wallet balances, one per advertiser
router.get("/", requireAuth, async (req: AuthRequest, res) => {
  const wallets = await prisma.campaignWallet.findMany({
    where: { userId: req.userId },
    include: {
      advertiser: { select: { id: true, firstName: true, lastName: true } },
    },
    orderBy: { updatedAt: "desc" },
  });

  res.json({ wallets });
});

// List the current user's own Campaign Wallet redemption codes
router.get("/codes", requireAuth, async (req: AuthRequest, res) => {
  const codes = await prisma.campaignCode.findMany({
    where: { userId: req.userId },
    orderBy: { createdAt: "desc" },
  });

  res.json({ codes });
});

const redeemSchema = z.object({
  advertiserId: z.string(),
  amount: z.number().positive(),
});

// Redeem part of a Campaign Wallet balance for a code (min R20)
router.post("/redeem", requireAuth, async (req: AuthRequest, res) => {
  const parsed = redeemSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.flatten() });
  }
  const { advertiserId, amount } = parsed.data;

  if (amount < 20) {
    return res.status(400).json({ error: "Minimum redemption amount is R20." });
  }

  const wallet = await prisma.campaignWallet.findUnique({
    where: { userId_advertiserId: { userId: req.userId!, advertiserId } },
  });

  if (!wallet || Number(wallet.balance) < amount) {
    return res.status(400).json({ error: "Insufficient Campaign Wallet balance." });
  }

  const code = await prisma.$transaction(async (tx) => {
    await tx.campaignWallet.update({
      where: { id: wallet.id },
      data: { balance: { decrement: amount } },
    });

    return tx.campaignCode.create({
      data: {
        code: generateCode(),
        userId: req.userId!,
        advertiserId,
        amount,
        status: "pending",
      },
    });
  });

  res.status(201).json({ message: "Code generated.", code });
});

// Advertiser confirms a code in-store, marking it redeemed
router.patch("/codes/:code/confirm", requireAuth, requireRole("ADVERTISER"), async (req: AuthRequest, res) => {
  const code = await prisma.campaignCode.findUnique({ where: { code: req.params.code } });

  if (!code || code.advertiserId !== req.userId) {
    return res.status(404).json({ error: "Code not found." });
  }
  if (code.status !== "pending") {
    return res.status(400).json({ error: "This code has already been redeemed." });
  }

  const updated = await prisma.campaignCode.update({
    where: { id: code.id },
    data: { status: "redeemed", redeemedAt: new Date() },
  });

  res.json({ message: "Code confirmed and redeemed.", code: updated });
});

export default router;