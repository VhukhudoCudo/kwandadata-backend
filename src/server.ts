import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import authRoutes from "./routes/auth.js";
import walletRoutes from "./routes/wallet.js";
import earnRoutes from "./routes/earn.js";
import redeemRoutes from "./routes/redeem.js";
import campaignRoutes  from "./routes/campaigns.js";
import adminRoutes from "./routes/admin.js";

dotenv.config();

const app = express();

app.use(cors());
app.use(express.json());

app.get("/health", (_req, res) => res.json({ status: "ok" }));

app.use("/api/auth", authRoutes);
app.use("/api/redeem", redeemRoutes);
app.use("/api/wallet", walletRoutes);
app.use("/api/earn", earnRoutes);
app.use("/api/campaigns", campaignRoutes);
app.use("/api/admin", adminRoutes);

const PORT = process.env.PORT || 4000;
app.listen(PORT, () => console.log(`KwandaData API running on port ${PORT}`));