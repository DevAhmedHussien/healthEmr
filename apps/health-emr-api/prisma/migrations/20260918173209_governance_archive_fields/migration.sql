-- AlterEnum
ALTER TYPE "AccountStatus" ADD VALUE 'ARCHIVED';

-- AlterTable
ALTER TABLE "pharmacies" ADD COLUMN     "archivedAt" TIMESTAMPTZ(6),
ADD COLUMN     "archivedByUserId" UUID,
ADD COLUMN     "archivedReason" TEXT,
ADD COLUMN     "statesServed" TEXT[] DEFAULT ARRAY[]::TEXT[];

-- AlterTable
ALTER TABLE "provider_profiles" ADD COLUMN     "archivedAt" TIMESTAMPTZ(6),
ADD COLUMN     "archivedByUserId" UUID,
ADD COLUMN     "archivedReason" TEXT;

-- AlterTable
ALTER TABLE "tenants" ADD COLUMN     "archivedAt" TIMESTAMPTZ(6),
ADD COLUMN     "archivedByUserId" UUID,
ADD COLUMN     "archivedReason" TEXT;

-- The application already asked which states a pharmacy ships into; provisioning
-- dropped the answer. Carry it across for pharmacies created before this column
-- existed, so routing has it for everyone rather than only new approvals.
UPDATE "pharmacies" p
SET "statesServed" = a."statesServed"
FROM "pharmacy_applications" a
WHERE a."pharmacyId" = p."id"
  AND cardinality(p."statesServed") = 0
  AND cardinality(a."statesServed") > 0;
