-- CreateEnum
CREATE TYPE "SellPriceSource" AS ENUM ('PRODUCT', 'TENANT_OVERRIDE');

-- AlterTable
ALTER TABLE "pharmacy_orders" ADD COLUMN     "sellPriceCents" INTEGER,
ADD COLUMN     "sellPriceSource" "SellPriceSource";

-- AlterTable
ALTER TABLE "pharmacy_products" ADD COLUMN     "sellPriceCents" INTEGER;
