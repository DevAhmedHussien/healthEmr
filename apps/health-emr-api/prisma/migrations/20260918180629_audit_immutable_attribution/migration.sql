-- AlterTable
ALTER TABLE "audit_logs" ADD COLUMN     "actorEmail" VARCHAR(255),
ADD COLUMN     "tenantSlug" VARCHAR(120);

-- Backfill from the rows the foreign keys still point at. Entries whose actor
-- was already deleted keep a null email — that information is genuinely gone,
-- and inventing it would be worse than recording the gap.
UPDATE "audit_logs" a SET "actorEmail" = u."email" FROM "users" u WHERE u."id" = a."actorUserId";
UPDATE "audit_logs" a SET "tenantSlug" = t."slug" FROM "tenants" t WHERE t."id" = a."tenantId";
