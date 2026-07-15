import { Router } from "express";
import { prisma } from "../lib/prisma.js";
import { requireAuth, AuthRequest } from "../middleware/auth.js";
import { z } from "zod";

const router = Router();

const redeemSchema = z.object({
  type: z.enum(["airtime", "data", "cash"]),
  amount: z.number().positive(),
  details: z.record(z.string()).optional(),
});

router.post("/", requireAuth, async (req: AuthRequest, res) => {
  const parsed = redeemSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.flatten() });
  }
  const { type, amount, details } = parsed.data;

  const wallet = await prisma.wallet.findUnique({ where: { userId: req.userId } });
  if (!wallet) {
    return res.status(404).json({ error: "Wallet not found." });
  }

  const balanceField = type === "data" ? "dataBalance" : "balance";
  const available = Number(wallet[balanceField]);

  if (amount > available) {
    return res.status(400).json({ error: "Insufficient balance for this redemption." });
  }

  const redemption = await prisma.$transaction(async (tx) => {
    const newRedemption = await tx.redemption.create({
      data: { userId: req.userId!, type, amount, details, status: "pending" },
    });

    await tx.wallet.update({
      where: { id: wallet.id },
      data: { [balanceField]: { decrement: amount } },
    });

    await tx.transaction.create({
      data: {
        walletId: wallet.id,
        type: "redeemed",
        title: `Redeemed: ${type}`,
        amount: -amount,
      },
    });

    return newRedemption;
  });

  res.status(201).json({ message: "Redemption submitted!", redemption });
});

router.get("/", requireAuth, async (req: AuthRequest, res) => {
  const redemptions = await prisma.redemption.findMany({
    where: { userId: req.userId },
    orderBy: { createdAt: "desc" },
  });
  res.json({ redemptions });
});

export default router;