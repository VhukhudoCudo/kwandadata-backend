import { Router } from "express";
import { prisma } from "../lib/prisma.js";
import { requireAuth, AuthRequest } from "../middleware/auth.js";

const router = Router();

router.get("/balance", requireAuth, async (req: AuthRequest, res) => {
  const wallet = await prisma.wallet.findUnique({
    where: { userId: req.userId },
  });

  if (!wallet) {
    return res.status(404).json({ error: "Wallet not found." });
  }

  res.json({
    balance: wallet.balance,
    bonusBalance: wallet.bonusBalance,
    dataBalance: wallet.dataBalance,
  });
});

router.get("/transactions", requireAuth, async (req: AuthRequest, res) => {
  const filter = req.query.type as string | undefined;

  const wallet = await prisma.wallet.findUnique({
    where: { userId: req.userId },
  });

  if (!wallet) {
    return res.status(404).json({ error: "Wallet not found." });
  }

  const transactions = await prisma.transaction.findMany({
    where: {
      walletId: wallet.id,
      ...(filter && filter !== "all" ? { type: filter } : {}),
    },
    orderBy: { createdAt: "desc" },
  });

  res.json({ transactions });
});

export default router;