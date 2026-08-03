-- AlterTable
ALTER TABLE "AppSettings" ADD COLUMN     "splitProofOfAction" INTEGER NOT NULL DEFAULT 10;

-- CreateTable
CREATE TABLE "ProofOfActionEntry" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "campaignId" TEXT NOT NULL,
    "advertiserId" TEXT NOT NULL,
    "brandName" TEXT NOT NULL,
    "amount" DECIMAL(10,2) NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "releasedAt" TIMESTAMP(3),
    "forfeitedAt" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProofOfActionEntry_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "ProofOfActionEntry" ADD CONSTRAINT "ProofOfActionEntry_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProofOfActionEntry" ADD CONSTRAINT "ProofOfActionEntry_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "Campaign"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
