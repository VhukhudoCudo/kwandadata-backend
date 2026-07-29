import { Router } from "express";
import { prisma } from "../lib/prisma.js";
import { requireAuth, requireRole, AuthRequest } from "../middleware/auth.js";

const router = Router();

// List redemptions, optionally filtered by status
router.get("/redemptions", requireAuth, requireRole("ADMIN"), async (req: AuthRequest, res) => {
  const status = typeof req.query.status === "string" ? req.query.status : undefined;

  const redemptions = await prisma.redemption.findMany({
    where: status ? { status } : undefined,
    include: {
      user: {
        select: { id: true, firstName: true, lastName: true, email: true, phone: true },
      },
    },
    orderBy: { createdAt: "desc" },
  });

  res.json({ redemptions });
});

// Approve a pending redemption
router.patch("/redemptions/:id/approve", requireAuth, requireRole("ADMIN"), async (req: AuthRequest, res) => {
  const redemption = await prisma.redemption.findUnique({ where: { id: req.params.id } });

  if (!redemption) {
    return res.status(404).json({ error: "Redemption not found." });
  }
  if (redemption.status !== "pending") {
    return res.status(400).json({ error: "Only pending redemptions can be approved." });
  }

  const note = typeof req.body?.fulfillmentNote === "string" ? req.body.fulfillmentNote : null;

  const updated = await prisma.redemption.update({
    where: { id: redemption.id },
    data: {
      status: "fulfilled",
      fulfilledAt: new Date(),
      fulfillmentNote: note,
    },
  });

  res.json({ message: "Redemption approved.", redemption: updated });
});

// Reject a pending redemption (refunds the user's balance)
router.patch("/redemptions/:id/reject", requireAuth, requireRole("ADMIN"), async (req: AuthRequest, res) => {
  const redemption = await prisma.redemption.findUnique({ where: { id: req.params.id } });

  if (!redemption) {
    return res.status(404).json({ error: "Redemption not found." });
  }
  if (redemption.status !== "pending") {
    return res.status(400).json({ error: "Only pending redemptions can be rejected." });
  }

  const wallet = await prisma.wallet.findUnique({ where: { userId: redemption.userId } });
  if (!wallet) {
    return res.status(404).json({ error: "Wallet not found for this user." });
  }

  const balanceField = redemption.type === "data" ? "dataBalance" : "balance";
  const amount = Number(redemption.amount);

  const result = await prisma.$transaction(async (tx) => {
    const updatedRedemption = await tx.redemption.update({
      where: { id: redemption.id },
      data: { status: "rejected" },
    });

    await tx.wallet.update({
      where: { id: wallet.id },
      data: { [balanceField]: { increment: amount } },
    });

    await tx.transaction.create({
      data: {
        walletId: wallet.id,
        type: "refund",
        title: `Refund: rejected ${redemption.type} redemption`,
        amount,
      },
    });

    return updatedRedemption;
  });

  res.json({ message: "Redemption rejected and balance refunded.", redemption: result });
});

// Platform-wide analytics summary
router.get("/analytics", requireAuth, requireRole("ADMIN"), async (req: AuthRequest, res) => {
  const [
    totalUsers,
    totalAdvertisers,
    totalCampaigns,
    activeCampaigns,
    pendingRedemptions,
    walletTotals,
    campaignTotals,
    campaignWalletTotals,
    goalTotals,
    pendingCampaignCodes,
    totalTaskCompletions,
    recentUsers,
  ] = await Promise.all([
    prisma.user.count({ where: { role: "USER" } }),
    prisma.user.count({ where: { role: "ADVERTISER" } }),
    prisma.campaign.count(),
    prisma.campaign.count({ where: { status: "active" } }),
    prisma.redemption.count({ where: { status: "pending" } }),
    prisma.wallet.aggregate({
      _sum: { balance: true, dataBalance: true },
    }),
    prisma.campaign.aggregate({
      _sum: { totalCharged: true, spent: true, budget: true },
    }),
    prisma.campaignWallet.aggregate({
      _sum: { balance: true },
    }),
    prisma.goal.aggregate({
      _sum: { saved: true, target: true },
    }),
    prisma.campaignCode.count({ where: { status: "pending" } }),
    prisma.taskCompletion.count(),
    prisma.user.findMany({
      where: { role: "USER", createdAt: { gte: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000) } },
      select: { createdAt: true },
    }),
  ]);

  // Bucket the last 30 days of registrations by day, for the chart
  const registrationsByDay: Record<string, number> = {};
  for (const u of recentUsers) {
    const day = u.createdAt.toISOString().slice(0, 10);
    registrationsByDay[day] = (registrationsByDay[day] || 0) + 1;
  }

  res.json({
    users: {
      totalUsers,
      totalAdvertisers,
    },
    campaigns: {
      totalCampaigns,
      activeCampaigns,
      totalRevenue: campaignTotals._sum.totalCharged ?? 0,
      totalSpentOnUsers: campaignTotals._sum.spent ?? 0,
      totalBudget: campaignTotals._sum.budget ?? 0,
    },
    redemptions: {
      pendingRedemptions,
      pendingCampaignCodes,
    },
    campaignWallets: {
      totalHeld: campaignWalletTotals._sum.balance ?? 0,
    },
    goals: {
      totalSaved: goalTotals._sum.saved ?? 0,
      totalTargeted: goalTotals._sum.target ?? 0,
    },
    taskCompletions: {
      total: totalTaskCompletions,
    },
    registrationsByDay,
    wallets: {
      totalCashHeld: walletTotals._sum.balance ?? 0,
      totalDataHeld: walletTotals._sum.dataBalance ?? 0,
    },
  });
});

// List/search users
router.get("/users", requireAuth, requireRole("ADMIN"), async (req: AuthRequest, res) => {
  const search = typeof req.query.search === "string" ? req.query.search : undefined;
  const role = typeof req.query.role === "string" ? req.query.role : undefined;

  const users = await prisma.user.findMany({
    where: {
      ...(role ? { role: role as any } : {}),
      ...(search
        ? {
            OR: [
              { firstName: { contains: search, mode: "insensitive" } },
              { lastName: { contains: search, mode: "insensitive" } },
              { email: { contains: search, mode: "insensitive" } },
            ],
          }
        : {}),
    },
select: {
      id: true,
      firstName: true,
      lastName: true,
      email: true,
      phone: true,
      role: true,
      suspended: true,
      company: true,
      industry: true,
      province: true,
      createdAt: true,
      wallet: { select: { balance: true, dataBalance: true } },
    },
    orderBy: { createdAt: "desc" },
  });

  res.json({ users });
});

// Suspend a user
router.patch("/users/:id/suspend", requireAuth, requireRole("ADMIN"), async (req: AuthRequest, res) => {
  const user = await prisma.user.findUnique({ where: { id: req.params.id } });
  if (!user) {
    return res.status(404).json({ error: "User not found." });
  }

  const updated = await prisma.user.update({
    where: { id: user.id },
    data: { suspended: true },
    select: { id: true, email: true, suspended: true },
  });

  res.json({ message: "User suspended.", user: updated });
});

// Reinstate a suspended user
router.patch("/users/:id/reinstate", requireAuth, requireRole("ADMIN"), async (req: AuthRequest, res) => {
  const user = await prisma.user.findUnique({ where: { id: req.params.id } });
  if (!user) {
    return res.status(404).json({ error: "User not found." });
  }

  const updated = await prisma.user.update({
    where: { id: user.id },
    data: { suspended: false },
    select: { id: true, email: true, suspended: true },
  });

  res.json({ message: "User reinstated.", user: updated });
});

// Real per-advertiser financial breakdown for admin Financial Control
router.get("/advertisers/financial", requireAuth, requireRole("ADMIN"), async (req: AuthRequest, res) => {
  const advertisers = await prisma.user.findMany({
    where: { role: "ADVERTISER" },
    select: {
      id: true,
      firstName: true,
      lastName: true,
      email: true,
      company: true,
      campaigns: {
        select: { budget: true, adminFee: true, vat: true, totalCharged: true, spent: true },
      },
    },
    orderBy: { createdAt: "desc" },
  });

  const statements = advertisers.map((a) => {
    const totals = a.campaigns.reduce(
      (acc, c) => {
        acc.totalCharged += Number(c.totalCharged);
        acc.totalAdminFee += Number(c.adminFee);
        acc.totalVat += Number(c.vat);
        acc.totalSpent += Number(c.spent);
        return acc;
      },
      { totalCharged: 0, totalAdminFee: 0, totalVat: 0, totalSpent: 0 }
    );

    return {
      id: a.id,
      name: `${a.firstName} ${a.lastName}`,
      email: a.email,
      company: a.company,
      campaignCount: a.campaigns.length,
      ...totals,
    };
  });

  res.json({ statements });
});

// List all campaigns platform-wide (admin oversight)

// List all campaigns platform-wide (admin oversight)
router.get("/campaigns", requireAuth, requireRole("ADMIN"), async (req: AuthRequest, res) => {
  const status = typeof req.query.status === "string" ? req.query.status : undefined;

  const campaigns = await prisma.campaign.findMany({
    where: status ? { status } : undefined,
    include: {
      advertiser: {
        select: { id: true, firstName: true, lastName: true, email: true },
      },
      tasks: {
        select: { id: true, title: true, type: true, reward: true, active: true },
      },
    },
    orderBy: { createdAt: "desc" },
  });

  res.json({ campaigns });
});

// Admin can pause any campaign (e.g. policy violation, fraud concern)
router.patch("/campaigns/:id/pause", requireAuth, requireRole("ADMIN"), async (req: AuthRequest, res) => {
  const campaign = await prisma.campaign.findUnique({ where: { id: req.params.id } });
  if (!campaign) {
    return res.status(404).json({ error: "Campaign not found." });
  }
  if (campaign.status !== "active") {
    return res.status(400).json({ error: "Only active campaigns can be paused." });
  }

  const updated = await prisma.$transaction(async (tx) => {
    await tx.task.updateMany({
      where: { campaignId: campaign.id },
      data: { active: false },
    });

    return tx.campaign.update({
      where: { id: campaign.id },
      data: { status: "paused" },
      include: { tasks: true },
    });
  });

  res.json({ message: "Campaign paused by admin.", campaign: updated });
});

// Admin approves a pending campaign: pending -> active (activates all its tasks)
router.patch("/campaigns/:id/approve", requireAuth, requireRole("ADMIN"), async (req: AuthRequest, res) => {
  const campaign = await prisma.campaign.findUnique({ where: { id: req.params.id }, include: { tasks: true } });
  if (!campaign) {
    return res.status(404).json({ error: "Campaign not found." });
  }
  if (campaign.status !== "pending") {
    return res.status(400).json({ error: "Only pending campaigns can be approved." });
  }
  if (campaign.tasks.length === 0) {
    return res.status(400).json({ error: "This campaign has no tasks to activate." });
  }

  const updated = await prisma.$transaction(async (tx) => {
    await tx.task.updateMany({
      where: { campaignId: campaign.id },
      data: { active: true },
    });

    return tx.campaign.update({
      where: { id: campaign.id },
      data: { status: "active" },
      include: { tasks: true },
    });
  });

  res.json({ message: "Campaign approved and is now live.", campaign: updated });
});

// Admin rejects a pending campaign: pending -> rejected
router.patch("/campaigns/:id/reject", requireAuth, requireRole("ADMIN"), async (req: AuthRequest, res) => {
  const campaign = await prisma.campaign.findUnique({ where: { id: req.params.id } });
  if (!campaign) {
    return res.status(404).json({ error: "Campaign not found." });
  }
  if (campaign.status !== "pending") {
    return res.status(400).json({ error: "Only pending campaigns can be rejected." });
  }

  const updated = await prisma.campaign.update({
    where: { id: campaign.id },
    data: { status: "rejected" },
  });

  res.json({ message: "Campaign rejected.", campaign: updated });
});

export default router;