import express from "express";
import cors from "cors";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import dotenv from "dotenv";
import authRoutes from "./routes/auth.js";
import walletRoutes from "./routes/wallet.js";
import earnRoutes from "./routes/earn.js";
import redeemRoutes from "./routes/redeem.js";
import campaignRoutes  from "./routes/campaigns.js";
import adminRoutes from "./routes/admin.js";
import campaignWalletRoutes from "./routes/campaign-wallet.js";
import goalsRoutes from "./routes/goals.js";
import settingsRoutes from "./routes/settings.js";
import announcementsRoutes from "./routes/announcements.js";

dotenv.config();

// Fail fast if the server is misconfigured rather than issuing unverifiable tokens
if (!process.env.JWT_SECRET) {
  console.error("FATAL: JWT_SECRET is not set. Refusing to start.");
  process.exit(1);
}

const app = express();

app.use(helmet());

const allowedOrigins = [
  "https://kwandadata.netlify.app",
  "http://localhost:3000",
  "http://localhost:5173",
];
app.use(cors({
  origin(origin, callback) {
    // Allow requests with no origin (curl, Thunder Client, mobile apps)
    if (!origin || allowedOrigins.includes(origin)) {
      return callback(null, true);
    }
    return callback(new Error("Not allowed by CORS"));
  },
}));

app.use(express.json());

// Global rate limit for the whole API
const globalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 300,
  standardHeaders: true,
  legacyHeaders: false,
});
app.use("/api", globalLimiter);

// Stricter limit on auth routes to slow down credential stuffing / brute force
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many auth attempts. Please try again later." },
});
app.use("/api/auth", authLimiter);

app.get("/health", (_req, res) => res.json({ status: "ok" }));

app.use("/api/auth", authRoutes);
app.use("/api/redeem", redeemRoutes);
app.use("/api/wallet", walletRoutes);
app.use("/api/earn", earnRoutes);
app.use("/api/campaigns", campaignRoutes);
app.use("/api/admin", adminRoutes);
app.use("/api/campaign-wallet", campaignWalletRoutes);
app.use("/api/goals", goalsRoutes);
app.use("/api/settings", settingsRoutes);
app.use("/api/announcements", announcementsRoutes);

// Global error handler — must be registered last, after all routes
app.use((err: any, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error(err);
  if (res.headersSent) return;
  res.status(err?.status || 500).json({ error: "Something went wrong. Please try again." });
});

const PORT = process.env.PORT || 4000;
app.listen(PORT, () => console.log(`KwandaData API running on port ${PORT}`));