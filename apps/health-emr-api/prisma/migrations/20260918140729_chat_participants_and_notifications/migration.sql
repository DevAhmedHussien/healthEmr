/*
  Warnings:

  - You are about to drop the column `hasUnreadForPatient` on the `chat_threads` table. All the data in the column will be lost.
  - You are about to drop the column `hasUnreadForProvider` on the `chat_threads` table. All the data in the column will be lost.
  - You are about to drop the column `providerId` on the `chat_threads` table. All the data in the column will be lost.
  - Added the required column `kind` to the `chat_threads` table without a default value. This is not possible if the table is not empty.

*/
-- CreateEnum
CREATE TYPE "ChatThreadKind" AS ENUM ('PATIENT_PROVIDER', 'PHARMACY_SUPPORT', 'PROVIDER_SUPPORT', 'GENERAL');

-- CreateEnum
CREATE TYPE "NotificationChannel" AS ENUM ('IN_APP', 'EMAIL', 'SMS', 'WEBHOOK');

-- CreateEnum
CREATE TYPE "NotificationDeliveryStatus" AS ENUM ('PENDING', 'SENT', 'FAILED', 'SKIPPED');

-- DropForeignKey
ALTER TABLE "chat_threads" DROP CONSTRAINT "chat_threads_providerId_fkey";

-- DropIndex
DROP INDEX "chat_threads_tenant_last_idx";

-- DropIndex
DROP INDEX "chat_threads_tenant_patient_unique";

-- AlterTable
ALTER TABLE "chat_threads" DROP COLUMN "hasUnreadForPatient",
DROP COLUMN "hasUnreadForProvider",
DROP COLUMN "providerId",
ADD COLUMN     "containsPhi" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "kind" "ChatThreadKind" NOT NULL,
ADD COLUMN     "pharmacyOrderId" UUID,
ADD COLUMN     "prescriptionId" UUID,
ADD COLUMN     "subject" VARCHAR(250),
ALTER COLUMN "tenantId" DROP NOT NULL,
ALTER COLUMN "patientId" DROP NOT NULL;

-- CreateTable
CREATE TABLE "chat_participants" (
    "id" UUID NOT NULL,
    "threadId" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "role" "Role" NOT NULL,
    "joinedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastReadAt" TIMESTAMPTZ(6),
    "leftAt" TIMESTAMPTZ(6),

    CONSTRAINT "chat_participants_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notifications" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "tenantId" UUID,
    "kind" VARCHAR(80) NOT NULL,
    "title" VARCHAR(200) NOT NULL,
    "body" TEXT NOT NULL,
    "data" JSONB,
    "entityType" VARCHAR(80),
    "entityId" VARCHAR(120),
    "readAt" TIMESTAMPTZ(6),
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "notifications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notification_deliveries" (
    "id" UUID NOT NULL,
    "notificationId" UUID NOT NULL,
    "channel" "NotificationChannel" NOT NULL,
    "status" "NotificationDeliveryStatus" NOT NULL DEFAULT 'PENDING',
    "target" VARCHAR(400),
    "renderedBody" TEXT,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "sentAt" TIMESTAMPTZ(6),
    "failedAt" TIMESTAMPTZ(6),
    "error" TEXT,
    "externalId" VARCHAR(160),
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "notification_deliveries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "communication_consents" (
    "id" UUID NOT NULL,
    "patientId" UUID NOT NULL,
    "emailPhiConsent" BOOLEAN NOT NULL DEFAULT false,
    "smsPhiConsent" BOOLEAN NOT NULL DEFAULT false,
    "consentText" TEXT,
    "consentedAt" TIMESTAMPTZ(6),
    "revokedAt" TIMESTAMPTZ(6),
    "capturedIp" VARCHAR(64),
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "communication_consents_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "chat_participants_user_idx" ON "chat_participants"("userId", "leftAt");

-- CreateIndex
CREATE UNIQUE INDEX "chat_participants_thread_user_unique" ON "chat_participants"("threadId", "userId");

-- CreateIndex
CREATE INDEX "notifications_user_unread_idx" ON "notifications"("userId", "readAt", "createdAt");

-- CreateIndex
CREATE INDEX "notification_deliveries_status_idx" ON "notification_deliveries"("status", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "communication_consents_patientId_key" ON "communication_consents"("patientId");

-- CreateIndex
CREATE INDEX "chat_threads_kind_last_idx" ON "chat_threads"("kind", "lastMessageAt");

-- CreateIndex
CREATE INDEX "chat_threads_patient_last_idx" ON "chat_threads"("patientId", "lastMessageAt");

-- CreateIndex
CREATE INDEX "chat_threads_order_idx" ON "chat_threads"("pharmacyOrderId");

-- AddForeignKey
ALTER TABLE "chat_threads" ADD CONSTRAINT "chat_threads_prescriptionId_fkey" FOREIGN KEY ("prescriptionId") REFERENCES "prescriptions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "chat_threads" ADD CONSTRAINT "chat_threads_pharmacyOrderId_fkey" FOREIGN KEY ("pharmacyOrderId") REFERENCES "pharmacy_orders"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "chat_participants" ADD CONSTRAINT "chat_participants_threadId_fkey" FOREIGN KEY ("threadId") REFERENCES "chat_threads"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "chat_participants" ADD CONSTRAINT "chat_participants_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notification_deliveries" ADD CONSTRAINT "notification_deliveries_notificationId_fkey" FOREIGN KEY ("notificationId") REFERENCES "notifications"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "communication_consents" ADD CONSTRAINT "communication_consents_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES "patients"("id") ON DELETE CASCADE ON UPDATE CASCADE;
