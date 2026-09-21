-- DropIndex
DROP INDEX "prescription_requests_queue_keyset_idx";

-- CreateIndex
CREATE INDEX "prescription_requests_queue_keyset_idx" ON "prescription_requests"("assignedProviderId", "createdAt", "id");
