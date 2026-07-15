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

  const adminFee = budgetNum * 0.15;
  const vat = (budgetNum + adminFee) * 0.15;
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

  const { title, description, type, reward } = req.body;

  if (!title || !description || !type || reward == null) {
    return res.status(400).json({ error: "title, description, type, and reward are required." });
  }

  const rewardNum = Number(reward);
  if (isNaN(rewardNum) || rewardNum <= 0) {
    return res.status(400).json({ error: "reward must be a positive number." });
  }

  const task = await prisma.task.create({
    data: {
      title,
      description,
      type,
      reward: rewardNum,
      campaignId: campaign.id,
      active: false, // stays inactive until the campaign launches
    },
  });

  res.status(201).json({ task });
});

// Launch a campaign: draft -> active (activates all its tasks)
router.patch("/:id/launch", requireAuth, requireRole("ADVERTISER"), async (req: AuthRequest, res) => {
  const campaign = await prisma.campaign.findUnique({
    where: { id: req.params.id },
    include: { tasks: true },
  });

  if (!campaign || campaign.advertiserId !== req.userId) {
    return res.status(404).json({ error: "Campaign not found." });
  }

  if (campaign.status !== "draft") {
    return res.status(400).json({ error: "Only draft campaigns can be launched." });
  }

  if (campaign.tasks.length === 0) {
    return res.status(400).json({ error: "Add at least one task before launching." });
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

export default router;