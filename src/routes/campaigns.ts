import { Router } from "express";
import { prisma } from "../lib/prisma.js";
import { requireAuth, requireRole, AuthRequest } from "../middleware/auth.js";

const router = Router();

// Create a draft campaign (advertiser only)
router.post("/", requireAuth, requireRole("ADVERTISER"), async (req: AuthRequest, res) => {
  const { title, description, targeting, budget } = req.body;

  if (!title || !description || !targeting || budget == null) {
    return res.status(400).json({ error: "title, description, targeting, and budget are required." });
  }

  const budgetNum = Number(budget);
  if (isNaN(budgetNum) || budgetNum <= 0) {
    return res.status(400).json({ error: "budget must be a positive number." });
  }

const adminFee = budgetNum * 0.20;
  const vat = budgetNum * 0.15;
  const totalCharged = budgetNum + adminFee + vat;

  const campaign = await prisma.campaign.create({
    data: {
      advertiserId: req.userId!,
      title,
      description,
      targeting,
      budget: budgetNum,
      adminFee,
      vat,
      totalCharged,
    },
  });

  res.status(201).json({ campaign });
});

// List the advertiser's own campaigns
router.get("/", requireAuth, requireRole("ADVERTISER"), async (req: AuthRequest, res) => {
  const campaigns = await prisma.campaign.findMany({
    where: { advertiserId: req.userId },
    include: { tasks: true },
    orderBy: { createdAt: "desc" },
  });

  res.json({ campaigns });
});

// Real performance analytics across the advertiser's own campaigns
router.get("/analytics", requireAuth, requireRole("ADVERTISER"), async (req: AuthRequest, res) => {
  const campaigns = await prisma.campaign.findMany({
    where: { advertiserId: req.userId },
    include: {
      tasks: {
        include: {
          completions: { select: { id: true, createdAt: true } },
        },
      },
    },
    orderBy: { createdAt: "desc" },
  });

  let totalCompletions = 0;
  let totalSpent = 0;
  let totalBudget = 0;
  const completionsByDay: Record<string, number> = {};

  const perCampaign = campaigns.map((c) => {
    const campCompletions = c.tasks.reduce((sum, t) => sum + t.completions.length, 0);
    totalCompletions += campCompletions;
    totalSpent += Number(c.spent);
    totalBudget += Number(c.budget);

    for (const t of c.tasks) {
      for (const comp of t.completions) {
        const day = comp.createdAt.toISOString().slice(0, 10);
        completionsByDay[day] = (completionsByDay[day] || 0) + 1;
      }
    }

    return {
      id: c.id,
      title: c.title,
      status: c.status,
      budget: Number(c.budget),
      spent: Number(c.spent),
      completions: campCompletions,
    };
  });

  res.json({
    totals: {
      totalCampaigns: campaigns.length,
      activeCampaigns: campaigns.filter((c) => c.status === "active").length,
      totalCompletions,
      totalSpent,
      totalBudget,
    },
    completionsByDay,
    campaigns: perCampaign,
  });
});

// Downloadable list of users who completed any of the advertiser's campaign tasks
router.get("/participants", requireAuth, requireRole("ADVERTISER"), async (req: AuthRequest, res) => {
  const completions = await prisma.taskCompletion.findMany({
    where: { task: { campaign: { advertiserId: req.userId } } },
    include: {
      user: { select: { firstName: true, lastName: true, province: true } },
      task: { select: { title: true, type: true, campaign: { select: { title: true } } } },
    },
    orderBy: { createdAt: "desc" },
  });

  res.json({
    participants: completions.map((c) => ({
      name: `${c.user.firstName} ${c.user.lastName}`,
      province: c.user.province,
      campaignTitle: c.task.campaign?.title,
      taskTitle: c.task.title,
      taskType: c.task.type,
      payout: c.payout,
      completedAt: c.createdAt,
    })),
  });
});

// Get a single campaign (must belong to the requesting advertiser)
router.get("/:id", requireAuth, requireRole("ADVERTISER"), async (req: AuthRequest, res) => {
  const campaign = await prisma.campaign.findUnique({
    where: { id: req.params.id },
    include: { tasks: true },
  });

  if (!campaign || campaign.advertiserId !== req.userId) {
    return res.status(404).json({ error: "Campaign not found." });
  }

  res.json({ campaign });
});

// Add a task to a draft campaign (advertiser only, must own the campaign)
router.post("/:id/tasks", requireAuth, requireRole("ADVERTISER"), async (req: AuthRequest, res) => {
  const campaign = await prisma.campaign.findUnique({ where: { id: req.params.id } });

  if (!campaign || campaign.advertiserId !== req.userId) {
    return res.status(404).json({ error: "Campaign not found." });
  }

  if (campaign.status !== "draft") {
    return res.status(400).json({ error: "Tasks can only be added while the campaign is in draft." });
  }
const { title, description, type, reward, content } = req.body;

  if (!title || !description || !type || reward == null) {
    return res.status(400).json({ error: "title, description, type, and reward are required." });
  }

  const rewardNum = Number(reward);
  if (isNaN(rewardNum) || rewardNum <= 0) {
    return res.status(400).json({ error: "reward must be a positive number." });
  }

 if (!content || typeof content.link !== "string" || !content.link.trim()) {
    return res.status(400).json({ error: "A link is required for this activity." });
  }
  const task = await prisma.task.create({
    data: {
      title,
      description,
      type,
      reward: rewardNum,
      content: content ?? undefined,
      campaignId: campaign.id,
      active: false, // stays inactive until the campaign launches
    },
  });

  res.status(201).json({ task });
});

// Submit a campaign for admin review: draft -> pending (does not go live yet)
router.patch("/:id/launch", requireAuth, requireRole("ADVERTISER"), async (req: AuthRequest, res) => {
  const campaign = await prisma.campaign.findUnique({
    where: { id: req.params.id },
    include: { tasks: true },
  });

  if (!campaign || campaign.advertiserId !== req.userId) {
    return res.status(404).json({ error: "Campaign not found." });
  }

  if (campaign.status !== "draft") {
    return res.status(400).json({ error: "Only draft campaigns can be submitted." });
  }

  if (campaign.tasks.length === 0) {
    return res.status(400).json({ error: "Add at least one task before submitting." });
  }

  const updated = await prisma.campaign.update({
    where: { id: campaign.id },
    data: { status: "pending" },
    include: { tasks: true },
  });

  res.json({ campaign: updated });
});

// Advertiser pauses their own active campaign
router.patch("/:id/pause", requireAuth, requireRole("ADVERTISER"), async (req: AuthRequest, res) => {
  const campaign = await prisma.campaign.findUnique({ where: { id: req.params.id } });

  if (!campaign || campaign.advertiserId !== req.userId) {
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

  res.json({ campaign: updated });
});

// Advertiser resumes their own paused campaign
router.patch("/:id/resume", requireAuth, requireRole("ADVERTISER"), async (req: AuthRequest, res) => {
  const campaign = await prisma.campaign.findUnique({ where: { id: req.params.id } });

  if (!campaign || campaign.advertiserId !== req.userId) {
    return res.status(404).json({ error: "Campaign not found." });
  }

  if (campaign.status !== "paused") {
    return res.status(400).json({ error: "Only paused campaigns can be resumed." });
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

  res.json({ campaign: updated });
});

// Billing summary across all of the advertiser's campaigns
router.get("/billing/summary", requireAuth, requireRole("ADVERTISER"), async (req: AuthRequest, res) => {
  const campaigns = await prisma.campaign.findMany({
    where: { advertiserId: req.userId },
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      title: true,
      status: true,
      budget: true,
      adminFee: true,
      vat: true,
      totalCharged: true,
      spent: true,
      createdAt: true,
    },
  });

  const totals = campaigns.reduce(
    (acc, c) => {
      acc.totalBudget += Number(c.budget);
      acc.totalAdminFee += Number(c.adminFee);
      acc.totalVat += Number(c.vat);
      acc.totalCharged += Number(c.totalCharged);
      acc.totalSpent += Number(c.spent);
      return acc;
    },
    { totalBudget: 0, totalAdminFee: 0, totalVat: 0, totalCharged: 0, totalSpent: 0 }
  );

  res.json({ totals, campaigns });
});

// Detailed statement for a single campaign (must belong to the requesting advertiser)
router.get("/:id/statement", requireAuth, requireRole("ADVERTISER"), async (req: AuthRequest, res) => {
  const campaign = await prisma.campaign.findUnique({
    where: { id: req.params.id },
    include: { tasks: true },
  });

  if (!campaign || campaign.advertiserId !== req.userId) {
    return res.status(404).json({ error: "Campaign not found." });
  }

  const spent = Number(campaign.spent);
  const budget = Number(campaign.budget);

  res.json({
    statement: {
      campaignId: campaign.id,
      title: campaign.title,
      status: campaign.status,
      createdAt: campaign.createdAt,
      budget,
      adminFee: Number(campaign.adminFee),
      vat: Number(campaign.vat),
      totalCharged: Number(campaign.totalCharged),
      spent,
      remainingBudget: Math.max(0, budget - spent),
      taskCount: campaign.tasks.length,
    },
  });
});

export default router;