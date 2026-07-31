-- Admin-configurable VAT rate, wired into real campaign billing (creation + top-up)
ALTER TABLE "AppSettings" ADD COLUMN "vatRate" DECIMAL(5,2) NOT NULL DEFAULT 15;