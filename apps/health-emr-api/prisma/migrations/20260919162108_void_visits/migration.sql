-- AlterTable
ALTER TABLE "prescription_requests" ADD COLUMN     "voidedAt" TIMESTAMPTZ(6),
ADD COLUMN     "voidedByUserId" UUID,
ADD COLUMN     "voidedReason" TEXT;

-- CreateIndex
CREATE INDEX "prescription_requests_voided_idx" ON "prescription_requests"("voidedAt");
