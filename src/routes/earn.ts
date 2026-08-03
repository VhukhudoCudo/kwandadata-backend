import { Router } from "express";
import { prisma } from "../lib/prisma.js";
import { requireAuth, AuthRequest } from "../middleware/auth.js";

const router = Router();
router.get("/tasks", requireAuth, async (req: AuthRequest, res) => {
  const completed = await prisma.taskCompletion.findMany({
    where: { userId: req.userId },
    select: { taskId: true },
  });
  const completedIds = completed.map((c) => c.taskId);

  const tasks = await prisma.task.findMany({
    where: {
      OR: [
        { active: true },
        { id: { in: completedIds } },
      ],
    },
    include: {
      campaign: {
        select: {
          id: true,
          title: true,
         advertiser: { select: { company: true, firstName: true, lastName: true } },
        },
      },
    },
    orderBy: { createdAt: "desc" },
  });
  const completedIdSet = new Set(completedIds);

  res.json({
    tasks: tasks.map((t) => ({
      ...t,
      completed: completedIdSet.has(t.id),
    })),
  });
});
router.post("/tasks/:id/complete", requireAuth, async (req: AuthRequest, res) => {
  const taskId = req.params.id;

  const task = await prisma.task.findUnique({ where: { id: taskId } });
  if (!task || !task.active) {
    return res.status(404).json({ error: "Task not found or no longer active." });
  }

  const isVideo = task.type === "video";
  let priorCompletionCount = 0;

  if (isVideo) {
    const maxTotal = task.maxTotal ?? 5;
    const maxPerWindow = task.maxPerWindow ?? 1;
    const windowMs = 24 * 60 * 60 * 1000;

    const myCompletions = await prisma.taskCompletion.findMany({
      where: { userId: req.userId, taskId },
      select: { createdAt: true },
      orderBy: { createdAt: "desc" },
    });
    priorCompletionCount = myCompletions.length;

    if (priorCompletionCount >= maxTotal) {
      return res.status(400).json({ error: `You've reached the maximum of ${maxTotal} watches for this video.` });
    }

    const windowStart = new Date(Date.now() - windowMs);
    const inWindow = myCompletions.filter((c) => c.createdAt >= windowStart).length;
    if (inWindow >= maxPerWindow) {
      return res.status(400).json({ error: `You've reached today's limit of ${maxPerWindow} watch${maxPerWindow === 1 ? "" : "es"} for this video. Try again after 24 hours.` });
    }
  } else {
    const existing = await prisma.taskCompletion.findFirst({
      where: { userId: req.userId, taskId },
    });
    if (existing) {
      return res.status(409).json({ error: "You've already completed this task." });
    }

    priorCompletionCount = await prisma.taskCompletion.count({ where: { taskId } });
    if (priorCompletionCount >= 2) {
      await prisma.task.update({ where: { id: taskId }, data: { active: false } });
      return res.status(400).json({ error: "This activity has already reached its maximum number of participants." });
    }
  }

  const wallet = await prisma.wallet.findUnique({ where: { userId: req.userId } });
  if (!wallet) {
    return res.status(404).json({ error: "Wallet not found." });
  }

  let campaign = null;
  if (task.campaignId) {
    campaign = await prisma.campaign.findUnique({
      where: { id: task.campaignId },
      include: { advertiser: { select: { company: true, firstName: true, lastName: true } } },
    });
    if (!campaign || campaign.status !== "active") {
      return res.status(400).json({ error: "This campaign is no longer active." });
    }
    const remaining = Number(campaign.budget) - Number(campaign.spent);
    if (remaining < Number(task.reward)) {
      return res.status(400).json({ error: "This campaign's budget has been exhausted." });
    }
  }

  const settings = await prisma.appSettings.findUnique({ where: { id: "singleton" } });
  const splitAdminPct = settings ? settings.splitAdmin / 100 : 0.20;
  const splitDataPct = settings ? settings.splitData / 100 : 0.20;
const splitCampaignPct = settings ? settings.splitCampaignObjective / 100 : 0.20;
  const splitProofOfActionPct = settings ? settings.splitProofOfAction / 100 : 0.10;

  const reward = Number(task.reward);
  const adminFee = reward * splitAdminPct;
  const dataShare = reward * splitDataPct;
  // Campaign tasks reserve a further share for the Campaign Objective Wallet;
  // generic tasks have no company to attribute that share to, so it all goes to the main wallet.
  const campaignShare = campaign ? reward * splitCampaignPct : 0;
  // Campaign VIDEO tasks additionally carve out a Proof of Campaign Action share, held pending
  // until the user uploads a matching purchase receipt (or it expires after 30 days).
  const proofShare = campaign && isVideo ? reward * splitProofOfActionPct : 0;
  const walletShare = reward - adminFee - dataShare - campaignShare - proofShare;

  const result = await prisma.$transaction(async (tx) => {
    await tx.taskCompletion.create({
      data: { userId: req.userId!, taskId, payout: reward },
    });

    if (!isVideo && priorCompletionCount + 1 >= 2) {
      await tx.task.update({ where: { id: taskId }, data: { active: false } });
    }
const updatedWallet = await tx.wallet.update({
      where: { id: wallet.id },
      data: {
        balance: { increment: walletShare },
        dataBalance: { increment: dataShare },
        bonusBalance: { increment: proofShare },
      },
    });

    await tx.transaction.create({
      data: {
        walletId: wallet.id,
        type: "earned",
        title: task.title,
        amount: walletShare,
      },
    });
    await tx.activityLog.create({
      data: {
        userId: req.userId!,
        action: "task_completed",
        meta: { taskId, taskTitle: task.title, reward },
      },
    });

if (campaign) {
      await tx.campaignWallet.upsert({
        where: { userId_advertiserId: { userId: req.userId!, advertiserId: campaign.advertiserId } },
        create: { userId: req.userId!, advertiserId: campaign.advertiserId, balance: campaignShare },
        update: { balance: { increment: campaignShare } },
      });

      if (isVideo && proofShare > 0) {
        const brandName = campaign.advertiser.company
          || `${campaign.advertiser.firstName} ${campaign.advertiser.lastName}`;
        await tx.proofOfActionEntry.create({
          data: {
            userId: req.userId!,
            campaignId: campaign.id,
            advertiserId: campaign.advertiserId,
            brandName,
            amount: proofShare,
            expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
          },
        });
      }

      const newSpent = Number(campaign.spent) + reward;
      const isExhausted = newSpent >= Number(campaign.budget);

      await tx.campaign.update({
        where: { id: campaign.id },
        data: {
          spent: newSpent,
          status: isExhausted ? "completed" : campaign.status,
        },
      });

      if (isExhausted) {
        await tx.task.updateMany({
          where: { campaignId: campaign.id },
          data: { active: false },
        });
      }
    }

    return updatedWallet;
  });
  res.json({
    message: "Task completed!",
    walletShare,
    dataShare,
    adminFee,
    campaignShare,
    wallet: result,
  });
});

export default router;