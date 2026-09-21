-- The line assignment becomes a real relation. SetNull rather than Cascade:
-- losing who was going to review a line must never take the line — and the
-- patient's order — with it.
ALTER TABLE "prescription_request_items"
  ADD CONSTRAINT "prescription_request_items_assignedProviderId_fkey"
  FOREIGN KEY ("assignedProviderId") REFERENCES "provider_profiles"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
