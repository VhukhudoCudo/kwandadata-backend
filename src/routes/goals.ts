import { Router } from "express";
import { prisma } from "../lib/prisma.js";
import { requireAuth, AuthRequest } from "../middleware/auth.js";
import { z } from "zod";

const router = Router();

function generateCode() {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let code = "KW-";
  for (let i = 0; i < 6; i++) {
    code += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return code;
}

// List the current user's goals
router.get("/", requireAuth, async (req: AuthRequest, res) => {
  const goals = await prisma.goal.findMany({
    where: { userId: req.userId },
    orderBy: { createdAt: "desc" },
  });
  res.json({ goals });
});

const createGoalSchema = z.object({
  name: z.string().trim().min(1),
  target: z.number().positive(),
});

// Create a new goal
router.post("/", requireAuth, async (req: AuthRequest, res) => {
  const parsed = createGoalSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.flatten() });
  }

  const goal = await prisma.goal.create({
    data: { userId: req.userId!, name: parsed.data.name, target: parsed.data.target },
  });

  res.status(201).json({ goal });
});

const fundSchema = z.object({ amount: z.number().positive() });

// Transfer from the main wallet into a goal
router.post("/:id/fund", requireAuth, async (req: AuthRequest, res) => {
  const parsed = fundSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.flatten() });
  }
  const { amount } = parsed.data;

  const goal = await prisma.goal.findUnique({ where: { id: req.params.id } });
  if (!goal || goal.userId !== req.userId) {
    return res.status(404).json({ error: "Goal not found." });
  }

  const remaining = Number(goal.target) - Number(goal.saved);
  if (amount > remaining) {
    return res.status(400).json({ error: `That would go over the goal target. Only R${remaining.toFixed(2)} more needed.` });
  }

  const wallet = await prisma.wallet.findUnique({ where: { userId: req.userId } });
  if (!wallet || Number(wallet.balance) < amount) {
    return res.status(400).json({ error: "Insufficient wallet balance." });
  }

  const updated = await prisma.$transaction(async (tx) => {
    await tx.wallet.update({
      where: { id: wallet.id },
      data: { balance: { decrement: amount } },
    });

    await tx.transaction.create({
      data: {
        walletId: wallet.id,
        type: "transferred",
        title: `Transferred to goal: ${goal.name}`,
        amount: -amount,
      },
    });

    return tx.goal.update({
      where: { id: goal.id },
      data: { saved: { increment: amount } },
    });
  });

  res.json({ goal: updated });
});

// Delete a goal, refunding its saved balance to the main wallet
router.delete("/:id", requireAuth, async (req: AuthRequest, res) => {
  const goal = await prisma.goal.findUnique({ where: { id: req.params.id } });
  if (!goal || goal.userId !== req.userId) {
    return res.status(404).json({ error: "Goal not found." });
  }

  const wallet = await prisma.wallet.findUnique({ where: { userId: req.userId } });
  if (!wallet) {
    return res.status(404).json({ error: "Wallet not found." });
  }

  const saved = Number(goal.saved);

  await prisma.$transaction(async (tx) => {
    if (saved > 0) {
      await tx.wallet.update({
        where: { id: wallet.id },
        data: { balance: { increment: saved } },
      });

      await tx.transaction.create({
        data: {
          walletId: wallet.id,
          type: "earned",
          title: `Goal deleted, refunded: ${goal.name}`,
          amount: saved,
        },
      });
    }

    await tx.goal.delete({ where: { id: goal.id } });
  });

  res.json({ message: "Goal deleted and balance refunded." });
});

const redeemCodeSchema = z.object({ amount: z.number().positive() });

// Redeem part of a goal's saved balance for an informational code (no merchant confirmation)
router.post("/:id/redeem", requireAuth, async (req: AuthRequest, res) => {
  const parsed = redeemCodeSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.flatten() });
  }
  const { amount } = parsed.data;

  const goal = await prisma.goal.findUnique({ where: { id: req.params.id } });
  if (!goal || goal.userId !== req.userId) {
    return res.status(404).json({ error: "Goal not found." });
  }
  if (amount > Number(goal.saved)) {
    return res.status(400).json({ error: "Not enough saved for this goal." });
  }

  const code = await prisma.$transaction(async (tx) => {
    await tx.goal.update({
      where: { id: goal.id },
      data: { saved: { decrement: amount } },
    });

    return tx.goalCode.create({
      data: {
        code: generateCode(),
        userId: req.userId!,
        goalId: goal.id,
        goalName: goal.name,
        amount,
      },
    });
  });

  res.status(201).json({ message: "Code generated.", code });
});

const redeemBankSchema = z.object({
  amount: z.number().positive(),
  bankName: z.string().trim().min(1),
  accountHolder: z.string().trim().min(1),
  accountNumber: z.string().trim().min(1),
});

// Redeem part of a goal's saved balance as a bank/e-wallet payout request.
// Reuses the existing Redemption/admin-approval flow (type: "goal_payout").
router.post("/:id/redeem-bank", requireAuth, async (req: AuthRequest, res) => {
  const parsed = redeemBankSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.flatten() });
  }
  const { amount, bankName, accountHolder, accountNumber } = parsed.data;

  const goal = await prisma.goal.findUnique({ where: { id: req.params.id } });
  if (!goal || goal.userId !== req.userId) {
    return res.status(404).json({ error: "Goal not found." });
  }
  if (amount > Number(goal.saved)) {
    return res.status(400).json({ error: "Not enough saved for this goal." });
  }

  const redemption = await prisma.$transaction(async (tx) => {
    await tx.goal.update({
      where: { id: goal.id },
      data: { saved: { decrement: amount } },
    });

    return tx.redemption.create({
      data: {
        userId: req.userId!,
        type: "goal_payout",
        amount,
        status: "pending",
        details: {
          goalId: goal.id,
          goalName: goal.name,
          bankName,
          accountHolder,
          accountNumber,
        },
      },
    });
  });

  res.status(201).json({ message: "Payout requested.", redemption });
});

// List the current user's goal code redemptions
router.get("/redemptions/codes", requireAuth, async (req: AuthRequest, res) => {
  const codes = await prisma.goalCode.findMany({
    where: { userId: req.userId },
    orderBy: { createdAt: "desc" },
  });
  res.json({ codes });
});

export default router;