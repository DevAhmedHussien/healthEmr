-- AlterTable
ALTER TABLE "pharmacy_configs" ADD COLUMN     "apiNetworkId" VARCHAR(40),
ADD COLUMN     "defaultShippingService" VARCHAR(40),
ADD COLUMN     "isEnabled" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "locationId" VARCHAR(40),
ADD COLUMN     "practiceId" VARCHAR(40),
ADD COLUMN     "vendorId" VARCHAR(40);

-- AlterTable
ALTER TABLE "pharmacy_orders" ADD COLUMN     "externalRxNumber" VARCHAR(160);
