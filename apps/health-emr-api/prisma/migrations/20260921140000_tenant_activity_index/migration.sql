-- "When did this client last send us anything" is a MAX over that client's
-- visits, and there was no index ordering them by date within a tenant — so it
-- read every visit the tenant had ever sent. That single subquery was the whole
-- 289ms of the client-accounts list at a million visits.
--
-- Ordered descending because the query wants the newest row, which then becomes
-- the first entry the planner reads rather than the last.
CREATE INDEX IF NOT EXISTS "prescription_requests_tenant_created_idx"
  ON "prescription_requests" ("tenantId", "createdAt" DESC);

-- The same shape on orders, which the month-to-date count walks.
CREATE INDEX IF NOT EXISTS "pharmacy_orders_tenant_created_idx"
  ON "pharmacy_orders" ("tenantId", "createdAt" DESC);
