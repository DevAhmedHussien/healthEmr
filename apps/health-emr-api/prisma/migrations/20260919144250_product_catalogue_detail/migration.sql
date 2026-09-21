-- AlterTable
ALTER TABLE "pharmacy_products" ADD COLUMN     "defaultSig" TEXT,
ADD COLUMN     "dispenseQuantity" VARCHAR(40),
ADD COLUMN     "dispenseUnit" VARCHAR(40),
ADD COLUMN     "pharmacyNotes" TEXT,
ADD COLUMN     "refills" INTEGER NOT NULL DEFAULT 0;
