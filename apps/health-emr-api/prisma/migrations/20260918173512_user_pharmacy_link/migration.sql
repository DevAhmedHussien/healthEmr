-- AlterTable
ALTER TABLE "users" ADD COLUMN     "pharmacyId" UUID;

-- CreateIndex
CREATE INDEX "users_pharmacy_idx" ON "users"("pharmacyId");

-- AddForeignKey
ALTER TABLE "users" ADD CONSTRAINT "users_pharmacyId_fkey" FOREIGN KEY ("pharmacyId") REFERENCES "pharmacies"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Backfill from the rule the code used until now, so existing pharmacy staff
-- keep working after the lookup changes.
UPDATE "users" u
SET "pharmacyId" = p."id"
FROM "pharmacies" p
WHERE u."pharmacyId" IS NULL
  AND u."role" = 'PHARMACY'
  AND p."contactEmail" = u."email";
