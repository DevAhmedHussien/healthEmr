-- CreateEnum
CREATE TYPE "AdministrationRoute" AS ENUM ('SUBCUTANEOUS', 'INTRAMUSCULAR', 'ORAL', 'SUBLINGUAL', 'TOPICAL', 'NASAL', 'OTHER');

-- AlterTable
ALTER TABLE "prescriptions" ADD COLUMN     "frequency" VARCHAR(120),
ADD COLUMN     "patientNote" TEXT,
ADD COLUMN     "route" "AdministrationRoute",
ADD COLUMN     "site" VARCHAR(200);
