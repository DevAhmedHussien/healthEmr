-- CreateEnum
CREATE TYPE "AccountStatus" AS ENUM ('ACTIVE', 'SUSPENDED');

-- CreateEnum
CREATE TYPE "RevenueSource" AS ENUM ('TENANT_QUOTED', 'PLATFORM_PRICED');

-- CreateEnum
CREATE TYPE "ApplicationSource" AS ENUM ('SELF_SERVE', 'SUPER_ADMIN');

-- CreateEnum
CREATE TYPE "EarningStatus" AS ENUM ('PENDING', 'APPROVED_FOR_PAYOUT', 'PAID', 'VOID');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "AuditAction" ADD VALUE 'ADMIN_CREATED';
ALTER TYPE "AuditAction" ADD VALUE 'INVITE_SENT';
ALTER TYPE "AuditAction" ADD VALUE 'INVITE_ACCEPTED';
ALTER TYPE "AuditAction" ADD VALUE 'APPLICATION_DECIDED';
ALTER TYPE "AuditAction" ADD VALUE 'ACCOUNT_SUSPENDED';
ALTER TYPE "AuditAction" ADD VALUE 'ACCOUNT_REACTIVATED';
ALTER TYPE "AuditAction" ADD VALUE 'PROVIDER_REASSIGNED';
ALTER TYPE "AuditAction" ADD VALUE 'VIEW_AS_TENANT';

-- AlterTable
ALTER TABLE "invoices" ADD COLUMN     "source" "RevenueSource" NOT NULL DEFAULT 'TENANT_QUOTED';

-- AlterTable
ALTER TABLE "pharmacies" ADD COLUMN     "primaryTenantId" UUID,
ADD COLUMN     "status" "AccountStatus" NOT NULL DEFAULT 'ACTIVE',
ADD COLUMN     "suspendedAt" TIMESTAMPTZ(6),
ADD COLUMN     "suspendedByUserId" UUID,
ADD COLUMN     "suspendedReason" TEXT;

-- AlterTable
ALTER TABLE "pharmacy_applications" ADD COLUMN     "categorySlugs" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "enteredByUserId" UUID,
ADD COLUMN     "integrationType" "PharmacyPlatform" NOT NULL DEFAULT 'GENERIC_HTTP',
ADD COLUMN     "source" "ApplicationSource" NOT NULL DEFAULT 'SELF_SERVE';

-- AlterTable
ALTER TABLE "pharmacy_orders" ADD COLUMN     "costOfGoodsCents" INTEGER,
ADD COLUMN     "costSourceProductId" UUID;

-- AlterTable
ALTER TABLE "prescription_request_items" ADD COLUMN     "quotedPriceCents" INTEGER;

-- AlterTable
ALTER TABLE "provider_applications" ADD COLUMN     "enteredByUserId" UUID,
ADD COLUMN     "source" "ApplicationSource" NOT NULL DEFAULT 'SELF_SERVE';

-- AlterTable
ALTER TABLE "provider_profiles" ADD COLUMN     "primaryTenantId" UUID,
ADD COLUMN     "status" "AccountStatus" NOT NULL DEFAULT 'ACTIVE',
ADD COLUMN     "suspendedAt" TIMESTAMPTZ(6),
ADD COLUMN     "suspendedByUserId" UUID,
ADD COLUMN     "suspendedReason" TEXT;

-- AlterTable
ALTER TABLE "tenants" ADD COLUMN     "contactPhone" VARCHAR(40),
ADD COLUMN     "ownerName" VARCHAR(200);

-- CreateTable
CREATE TABLE "user_invites" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "invitedByUserId" UUID,
    "expiresAt" TIMESTAMPTZ(6) NOT NULL,
    "acceptedAt" TIMESTAMPTZ(6),
    "revokedAt" TIMESTAMPTZ(6),
    "resendCount" INTEGER NOT NULL DEFAULT 0,
    "lastSentAt" TIMESTAMPTZ(6),
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "user_invites_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "provider_fee_schedules" (
    "id" UUID NOT NULL,
    "providerId" UUID,
    "categoryId" UUID,
    "amountCents" INTEGER NOT NULL DEFAULT 100,
    "effectiveFrom" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "effectiveTo" TIMESTAMPTZ(6),
    "note" TEXT,
    "createdByUserId" UUID,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "provider_fee_schedules_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "provider_earnings" (
    "id" UUID NOT NULL,
    "providerId" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "requestId" UUID NOT NULL,
    "amountCents" INTEGER NOT NULL,
    "feeScheduleId" UUID,
    "outcome" "RequestStatus" NOT NULL,
    "status" "EarningStatus" NOT NULL DEFAULT 'PENDING',
    "earnedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "paidAt" TIMESTAMPTZ(6),
    "payoutReference" VARCHAR(120),
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "provider_earnings_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "user_invites_tokenHash_key" ON "user_invites"("tokenHash");

-- CreateIndex
CREATE INDEX "user_invites_user_accepted_idx" ON "user_invites"("userId", "acceptedAt");

-- CreateIndex
CREATE INDEX "user_invites_expires_idx" ON "user_invites"("expiresAt");

-- CreateIndex
CREATE INDEX "provider_fee_schedules_lookup_idx" ON "provider_fee_schedules"("providerId", "categoryId", "effectiveFrom");

-- CreateIndex
CREATE UNIQUE INDEX "provider_earnings_requestId_key" ON "provider_earnings"("requestId");

-- CreateIndex
CREATE INDEX "provider_earnings_provider_earned_idx" ON "provider_earnings"("providerId", "earnedAt");

-- CreateIndex
CREATE INDEX "provider_earnings_payout_idx" ON "provider_earnings"("status", "earnedAt");

-- CreateIndex
CREATE INDEX "provider_earnings_tenant_earned_idx" ON "provider_earnings"("tenantId", "earnedAt");

-- CreateIndex
CREATE INDEX "invoice_lines_medication_idx" ON "invoice_lines"("medicationId");

-- CreateIndex
CREATE INDEX "pharmacies_primary_status_idx" ON "pharmacies"("primaryTenantId", "status");

-- CreateIndex
CREATE INDEX "pharmacy_orders_pharmacy_fulfilment_idx" ON "pharmacy_orders"("pharmacyId", "status", "shippedAt");

-- CreateIndex
CREATE INDEX "prescription_requests_provider_stats_idx" ON "prescription_requests"("assignedProviderId", "status", "decidedAt");

-- CreateIndex
CREATE INDEX "prescriptions_provider_signed_idx" ON "prescriptions"("providerId", "signedAt");

-- CreateIndex
CREATE INDEX "provider_profiles_primary_status_idx" ON "provider_profiles"("primaryTenantId", "status");

-- CreateIndex
CREATE INDEX "qa_submissions_tenant_state_idx" ON "qa_submissions"("tenantId", "patientStateAtSubmission");

-- AddForeignKey
ALTER TABLE "provider_profiles" ADD CONSTRAINT "provider_profiles_primaryTenantId_fkey" FOREIGN KEY ("primaryTenantId") REFERENCES "tenants"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pharmacies" ADD CONSTRAINT "pharmacies_primaryTenantId_fkey" FOREIGN KEY ("primaryTenantId") REFERENCES "tenants"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_invites" ADD CONSTRAINT "user_invites_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_invites" ADD CONSTRAINT "user_invites_invitedByUserId_fkey" FOREIGN KEY ("invitedByUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "provider_fee_schedules" ADD CONSTRAINT "provider_fee_schedules_providerId_fkey" FOREIGN KEY ("providerId") REFERENCES "provider_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "provider_fee_schedules" ADD CONSTRAINT "provider_fee_schedules_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "categories"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "provider_earnings" ADD CONSTRAINT "provider_earnings_providerId_fkey" FOREIGN KEY ("providerId") REFERENCES "provider_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "provider_earnings" ADD CONSTRAINT "provider_earnings_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "provider_earnings" ADD CONSTRAINT "provider_earnings_requestId_fkey" FOREIGN KEY ("requestId") REFERENCES "prescription_requests"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "provider_earnings" ADD CONSTRAINT "provider_earnings_feeScheduleId_fkey" FOREIGN KEY ("feeScheduleId") REFERENCES "provider_fee_schedules"("id") ON DELETE SET NULL ON UPDATE CASCADE;
