import { Router } from "express";
import { prisma } from "../lib/prisma.js";
import { requireAuth, requireRole, AuthRequest } from "../middleware/auth.js";
import { z } from "zod";

const router = Router();

const sendSchema = z.object({
  title: z.string().trim().min(1),
  message: z.string().trim().min(1),
  audience: z.enum(["users", "advertisers", "all"]),
});

// Admin: send a new announcement
router.post("/", requireAuth, requireRole("ADMIN"), async (req: AuthRequest, res) => {
  const parsed = sendSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.flatten() });
  }

  const admin = await prisma.user.findUnique({ where: { id: req.userId } });

  const announcement = await prisma.announcement.create({
    data: {
      title: parsed.data.title,
      message: parsed.data.message,
      audience: parsed.data.audience,
      sentBy: admin ? `${admin.firstName} ${admin.lastName}` : "Admin",
    },
  });

  res.status(201).json({ message: "Announcement sent.", announcement });
});

// List announcements relevant to the requesting user's role (admins see everything)
router.get("/", requireAuth, async (req: AuthRequest, res) => {
  const audienceFilter =
    req.userRole === "ADMIN"
      ? undefined
      : req.userRole === "ADVERTISER"
      ? { audience: { in: ["advertisers", "all"] } }
      : { audience: { in: ["users", "all"] } };

  const announcements = await prisma.announcement.findMany({
    where: audienceFilter,
    orderBy: { createdAt: "desc" },
  });

  res.json({ announcements });
});

export default router;