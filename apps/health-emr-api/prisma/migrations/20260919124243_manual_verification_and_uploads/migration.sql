-- CreateEnum
CREATE TYPE "LicenceVerification" AS ENUM ('DOCUMENT', 'MANUAL');

-- AlterTable
ALTER TABLE "pharmacy_application_documents" ADD COLUMN     "uploadedByUserId" UUID,
ADD COLUMN     "uploadedNote" TEXT;

-- AlterTable
ALTER TABLE "provider_application_documents" ADD COLUMN     "uploadedByUserId" UUID,
ADD COLUMN     "uploadedNote" TEXT;

-- AlterTable
ALTER TABLE "provider_application_licenses" ADD COLUMN     "verifiedByUserId" UUID,
ADD COLUMN     "verifiedMethod" "LicenceVerification",
ADD COLUMN     "verifiedNote" TEXT;
