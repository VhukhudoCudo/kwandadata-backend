import { Router } from "express";
import { z } from "zod";
import { prisma } from "../lib/prisma.js";
import { requireAuth, AuthRequest } from "../middleware/auth.js";
import { checkReceiptMatchesBrand } from "../lib/receiptMatch.js";

const router = Router();

// Sweeps this user's own expired-but-still-pending entries and forfeits them to admin.
// Called lazily on every read of this wallet rather than via a cron job.
async function sweepExpiredEntries(userId: string) {
  const expired = await prisma.proofOfActionEntry.findMany({
    where: { userId, status: "pending", expiresAt: { lt: new Date() } },
  });
  if (expired.length === 0) return;

  const totalForfeited = expired.reduce((sum, e) => sum + Number(e.amount), 0);

  await prisma.$transaction([
    prisma.proofOfActionEntry.updateMany({
      where: { id: { in: expired.map((e) => e.id) } },
      data: { status: "forfeited", forfeitedAt: new Date() },
    }),
    prisma.wallet.update({
      where: { userId },
      data: { bonusBalance: { decrement: totalForfeited } },
    }),
  ]);
}

router.get("/", requireAuth, async (req: AuthRequest, res) => {
  await sweepExpiredEntries(req.userId!);

  const entries = await prisma.proofOfActionEntry.findMany({
    where: { userId: req.userId },
    orderBy: { createdAt: "desc" },
  });

  const wallet = await prisma.wallet.findUnique({ where: { userId: req.userId } });

  const referralTransactions = await prisma.transaction.findMany({
    where: { wallet: { userId: req.userId }, title: { startsWith: "Referral bonus:" } },
  });
  const referralTotal = referralTransactions.reduce((sum, t) => sum + Number(t.amount), 0);

  res.json({
    totalPending: wallet ? wallet.bonusBalance : 0,
    entries,
    referralStats: {
      usersReferred: referralTransactions.length,
      totalEarned: referralTotal,
    },
  });
});

const verifySchema = z.object({
  image: z.string().min(1),
  mediaType: z.enum(["image/jpeg", "image/png", "image/webp", "image/gif"]),
});

router.post("/:id/verify-receipt", requireAuth, async (req: AuthRequest, res) => {
  await sweepExpiredEntries(req.userId!);

  const parsed = verifySchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "Please attach a valid receipt photo." });
  }

  const entry = await prisma.proofOfActionEntry.findUnique({ where: { id: req.params.id } });
  if (!entry || entry.userId !== req.userId) {
    return res.status(404).json({ error: "Entry not found." });
  }
  if (entry.status !== "pending") {
    return res.status(400).json({ error: `This entry is already ${entry.status}.` });
  }

  const result = await checkReceiptMatchesBrand(parsed.data.image, parsed.data.mediaType, entry.brandName);

  if (!result.matches) {
    return res.status(400).json({
      error: `We couldn't confirm this receipt is from ${entry.brandName}. ${result.reason || ""}`.trim(),
    });
  }

  const wallet = await prisma.wallet.findUnique({ where: { userId: req.userId } });
  if (!wallet) {
    return res.status(404).json({ error: "Wallet not found." });
  }

  await prisma.$transaction([
    prisma.proofOfActionEntry.update({
      where: { id: entry.id },
      data: { status: "released", releasedAt: new Date() },
    }),
    prisma.wallet.update({
      where: { id: wallet.id },
      data: {
        balance: { increment: entry.amount },
        bonusBalance: { decrement: entry.amount },
      },
    }),
    prisma.transaction.create({
      data: {
        walletId: wallet.id,
        type: "earned",
        title: `Proof of Campaign Action: ${entry.brandName} receipt confirmed`,
        amount: entry.amount,
      },
    }),
  ]);

  res.json({ message: "Receipt confirmed! Funds moved to your Hello Wallet.", amount: entry.amount });
});

export default router;