-- Add configurable referral bonus amount to AppSettings
ALTER TABLE "AppSettings" ADD COLUMN "referralBonus" DECIMAL(10,2) NOT NULL DEFAULT 5;