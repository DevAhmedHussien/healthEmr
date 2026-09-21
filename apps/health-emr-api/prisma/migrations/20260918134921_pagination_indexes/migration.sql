-- DropIndex
DROP INDEX "pharmacy_applications_status_created_idx";

-- DropIndex
DROP INDEX "provider_applications_status_created_idx";

-- CreateIndex
CREATE INDEX "pharmacy_applications_status_created_idx" ON "pharmacy_applications"("status", "createdAt", "id");

-- CreateIndex
CREATE INDEX "prescription_requests_queue_keyset_idx" ON "prescription_requests"("assignedProviderId", "status", "createdAt", "id");

-- CreateIndex
CREATE INDEX "prescription_requests_master_idx" ON "prescription_requests"("externalMasterId");

-- CreateIndex
CREATE INDEX "provider_applications_status_created_idx" ON "provider_applications"("status", "createdAt", "id");
