-- A visit whose medications span categories no single clinician covers is split
-- line by line, so each line records who is responsible for deciding it.
ALTER TABLE "prescription_request_items"
  ADD COLUMN "assignedProviderId" UUID,
  ADD COLUMN "assignedAt" TIMESTAMPTZ(6);

CREATE INDEX "prescription_request_items_assignee_idx"
  ON "prescription_request_items" ("assignedProviderId", "decision");

-- Existing visits were decided as a whole: every line belongs to the provider
-- the visit was routed to.
UPDATE "prescription_request_items" i
   SET "assignedProviderId" = r."assignedProviderId",
       "assignedAt"         = r."assignedAt"
  FROM "prescription_requests" r
 WHERE r."id" = i."requestId"
   AND r."assignedProviderId" IS NOT NULL;

-- A split visit pays each reviewing clinician once, so the replay guard moves
-- from the visit to the (visit, clinician) pair.
DROP INDEX "provider_earnings_requestId_key";

CREATE UNIQUE INDEX "provider_earnings_request_provider_key"
  ON "provider_earnings" ("requestId", "providerId");
