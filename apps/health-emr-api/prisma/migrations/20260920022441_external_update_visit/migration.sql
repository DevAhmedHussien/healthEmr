-- AlterTable
ALTER TABLE "prescription_requests" ADD COLUMN     "referralReason" TEXT,
ADD COLUMN     "referredAt" TIMESTAMPTZ(6),
ADD COLUMN     "rxRetryCount" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "tenants" ADD COLUMN     "rxRetryLimit" INTEGER NOT NULL DEFAULT 2;
