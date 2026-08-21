import { Router } from "express";
import { prisma } from "../lib/prisma.js";
import { requireAuth, AuthRequest } from "../middleware/auth.js";
import { z } from "zod";
import { orderAirtimeVoucher, checkVoucherUsed } from "../lib/airtime.js";
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

  // Airtime is fulfilled for real, instantly, via AllNetAirtime — no admin approval step.
  // We place the real order BEFORE touching the wallet, so a failed order never costs the user anything.
  if (type === "airtime") {
    const order = await orderAirtimeVoucher(Math.round(amount));
    if (!order.success) {
      return res.status(502).json({ error: order.error || "Could not process this airtime redemption right now." });
    }

    const redemption = await prisma.$transaction(async (tx) => {
      const newRedemption = await tx.redemption.create({
        data: {
          userId: req.userId!,
          type,
          amount,
          details: { ...(details || {}), reference: order.reference, vouchers: order.vouchers } as any,
          status: "fulfilled",
          fulfilledAt: new Date(),
          fulfillmentNote: "Auto-fulfilled via AllNetAirtime",
        },
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

    return res.status(201).json({ message: "Airtime voucher issued!", redemption });
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

  // Lazily check a handful of recent, still-unmasked airtime vouchers against AllNetAirtime
  // to see if they've actually been dialed yet — masking the PIN once confirmed redeemed.
  // Capped at 5 per request so this never turns one page load into an unbounded number of
  // outbound API calls.
  const toCheck = redemptions
    .filter((r) => r.type === "airtime" && r.details && (r.details as any).vouchers && !(r.details as any).used)
    .slice(0, 5);

  for (const r of toCheck) {
    const details = r.details as any;
    if (!details.reference) continue;
    const used = await checkVoucherUsed(details.reference);
    if (used === true) {
      const maskedVouchers = details.vouchers.map((v: any) => ({
        ...v,
        pin: typeof v.pin === "string" && v.pin.length > 4
          ? "•".repeat(v.pin.length - 4) + v.pin.slice(-4)
          : v.pin,
      }));
      const newDetails = { ...details, used: true, vouchers: maskedVouchers };
      await prisma.redemption.update({ where: { id: r.id }, data: { details: newDetails } });
      r.details = newDetails;
    }
  }

  res.json({ redemptions });
});
export default router;