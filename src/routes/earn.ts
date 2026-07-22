import { Router } from "express";
import { prisma } from "../lib/prisma.js";
import { requireAuth, AuthRequest } from "../middleware/auth.js";

const router = Router();

router.get("/tasks", requireAuth, async (req: AuthRequest, res) => {
  const tasks = await prisma.task.findMany({
    where: { active: true },
    orderBy: { createdAt: "desc" },
  });

  const completed = await prisma.taskCompletion.findMany({
    where: { userId: req.userId },
    select: { taskId: true },
  });
  const completedIds = new Set(completed.map((c) => c.taskId));

  res.json({
    tasks: tasks.map((t) => ({
      ...t,
      completed: completedIds.has(t.id),
    })),
  });
});

router.post("/tasks/:id/complete", requireAuth, async (req: AuthRequest, res) => {
  const taskId = req.params.id;

  const task = await prisma.task.findUnique({ where: { id: taskId } });
  if (!task || !task.active) {
    return res.status(404).json({ error: "Task not found or no longer active." });
  }

  const existing = await prisma.taskCompletion.findUnique({
    where: { userId_taskId: { userId: req.userId!, taskId } },
  });
  if (existing) {
    return res.status(409).json({ error: "You've already completed this task." });
  }

  const wallet = await prisma.wallet.findUnique({ where: { userId: req.userId } });
  if (!wallet) {
    return res.status(404).json({ error: "Wallet not found." });
  }

  let campaign = null;
  if (task.campaignId) {
    campaign = await prisma.campaign.findUnique({ where: { id: task.campaignId } });
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

  const reward = Number(task.reward);
  const adminFee = reward * splitAdminPct;
  const dataShare = reward * splitDataPct;
  // Campaign tasks reserve a further 20% for the Campaign Objective Wallet (not admin-configurable);
  // generic tasks have no company to attribute that share to, so it all goes to the main wallet.
  const campaignShare = campaign ? reward * 0.20 : 0;
  const walletShare = reward - adminFee - dataShare - campaignShare;

  const result = await prisma.$transaction(async (tx) => {
    await tx.taskCompletion.create({
      data: { userId: req.userId!, taskId, payout: reward },
    });

    const updatedWallet = await tx.wallet.update({
      where: { id: wallet.id },
      data: {
        balance: { increment: walletShare },
        dataBalance: { increment: dataShare },
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