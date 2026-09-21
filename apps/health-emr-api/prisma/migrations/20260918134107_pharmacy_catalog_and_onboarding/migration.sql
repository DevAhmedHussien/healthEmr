-- CreateEnum
CREATE TYPE "ApplicationStatus" AS ENUM ('SUBMITTED', 'UNDER_REVIEW', 'INFO_REQUESTED', 'APPROVED', 'REJECTED', 'WITHDRAWN');

-- CreateEnum
CREATE TYPE "PharmacyDocumentKind" AS ENUM ('STATE_PHARMACY_LICENSE', 'NONRESIDENT_PHARMACY_LICENSE', 'DEA_REGISTRATION', 'NCPDP_ASSIGNMENT', 'NABP_VAWD_ACCREDITATION', 'STERILE_COMPOUNDING_503A', 'OUTSOURCING_FACILITY_503B', 'FDA_REGISTRATION', 'LIABILITY_INSURANCE', 'BUSINESS_LICENSE', 'W9', 'CERTIFICATE_OF_ANALYSIS', 'OTHER');

-- CreateEnum
CREATE TYPE "ProviderDocumentKind" AS ENUM ('STATE_MEDICAL_LICENSE', 'DEA_REGISTRATION', 'BOARD_CERTIFICATION', 'MALPRACTICE_INSURANCE', 'CURRICULUM_VITAE', 'GOVERNMENT_ID', 'NPI_CONFIRMATION', 'OTHER');

-- CreateEnum
CREATE TYPE "DocumentReviewStatus" AS ENUM ('PENDING', 'ACCEPTED', 'REJECTED', 'EXPIRED');

-- CreateTable
CREATE TABLE "pharmacy_categories" (
    "id" UUID NOT NULL,
    "pharmacyId" UUID NOT NULL,
    "name" VARCHAR(160) NOT NULL,
    "slug" VARCHAR(160) NOT NULL,
    "description" TEXT,
    "clinicalCategoryId" UUID,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "pharmacy_categories_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pharmacy_products" (
    "id" UUID NOT NULL,
    "pharmacyId" UUID NOT NULL,
    "pharmacyCategoryId" UUID NOT NULL,
    "kitCode" VARCHAR(160) NOT NULL,
    "favouriteName" VARCHAR(200) NOT NULL,
    "medicationName" VARCHAR(250) NOT NULL,
    "concentration" VARCHAR(120),
    "form" "MedicationForm" NOT NULL DEFAULT 'OTHER',
    "vialSize" VARCHAR(80),
    "daysSupply" INTEGER,
    "costOfGoodsCents" INTEGER,
    "medicationId" UUID,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "pharmacy_products_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pharmacy_applications" (
    "id" UUID NOT NULL,
    "legalName" VARCHAR(250) NOT NULL,
    "tradingName" VARCHAR(250),
    "contactName" VARCHAR(200) NOT NULL,
    "contactEmail" VARCHAR(255) NOT NULL,
    "contactPhone" VARCHAR(40) NOT NULL,
    "websiteUrl" VARCHAR(400),
    "addressLine1" VARCHAR(200) NOT NULL,
    "addressLine2" VARCHAR(200),
    "city" VARCHAR(120) NOT NULL,
    "state" VARCHAR(2) NOT NULL,
    "postalCode" VARCHAR(20) NOT NULL,
    "statesServed" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "ncpdpId" VARCHAR(40),
    "npi" VARCHAR(20),
    "deaNumber" VARCHAR(40),
    "dispensesCompounded" BOOLEAN NOT NULL DEFAULT false,
    "dispensesBranded" BOOLEAN NOT NULL DEFAULT false,
    "isOutsourcingFacility" BOOLEAN NOT NULL DEFAULT false,
    "notes" TEXT,
    "status" "ApplicationStatus" NOT NULL DEFAULT 'SUBMITTED',
    "reviewedByUserId" UUID,
    "reviewedAt" TIMESTAMPTZ(6),
    "reviewNotes" TEXT,
    "pharmacyId" UUID,
    "submittedIp" VARCHAR(64),
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "pharmacy_applications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pharmacy_application_documents" (
    "id" UUID NOT NULL,
    "applicationId" UUID NOT NULL,
    "kind" "PharmacyDocumentKind" NOT NULL,
    "state" VARCHAR(2),
    "documentNumber" VARCHAR(120),
    "issuedAt" TIMESTAMPTZ(6),
    "expiresAt" TIMESTAMPTZ(6),
    "bucket" VARCHAR(255) NOT NULL,
    "objectKey" VARCHAR(512) NOT NULL,
    "fileName" VARCHAR(255) NOT NULL,
    "mime" VARCHAR(120) NOT NULL,
    "size" INTEGER NOT NULL,
    "reviewStatus" "DocumentReviewStatus" NOT NULL DEFAULT 'PENDING',
    "reviewNotes" TEXT,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "pharmacy_application_documents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "provider_applications" (
    "id" UUID NOT NULL,
    "firstName" VARCHAR(100) NOT NULL,
    "lastName" VARCHAR(100) NOT NULL,
    "email" VARCHAR(255) NOT NULL,
    "phone" VARCHAR(40) NOT NULL,
    "credentials" VARCHAR(80) NOT NULL,
    "npi" VARCHAR(20) NOT NULL,
    "deaNumber" VARCHAR(40),
    "specialties" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "yearsExperience" INTEGER,
    "bio" TEXT,
    "requestedCategorySlugs" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "status" "ApplicationStatus" NOT NULL DEFAULT 'SUBMITTED',
    "reviewedByUserId" UUID,
    "reviewedAt" TIMESTAMPTZ(6),
    "reviewNotes" TEXT,
    "providerId" UUID,
    "submittedIp" VARCHAR(64),
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "provider_applications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "provider_application_licenses" (
    "id" UUID NOT NULL,
    "applicationId" UUID NOT NULL,
    "state" VARCHAR(2) NOT NULL,
    "licenseNumber" VARCHAR(80) NOT NULL,
    "issuedAt" TIMESTAMPTZ(6),
    "expiresAt" TIMESTAMPTZ(6) NOT NULL,
    "verifiedAt" TIMESTAMPTZ(6),
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "provider_application_licenses_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "provider_application_documents" (
    "id" UUID NOT NULL,
    "applicationId" UUID NOT NULL,
    "kind" "ProviderDocumentKind" NOT NULL,
    "state" VARCHAR(2),
    "documentNumber" VARCHAR(120),
    "issuedAt" TIMESTAMPTZ(6),
    "expiresAt" TIMESTAMPTZ(6),
    "bucket" VARCHAR(255) NOT NULL,
    "objectKey" VARCHAR(512) NOT NULL,
    "fileName" VARCHAR(255) NOT NULL,
    "mime" VARCHAR(120) NOT NULL,
    "size" INTEGER NOT NULL,
    "reviewStatus" "DocumentReviewStatus" NOT NULL DEFAULT 'PENDING',
    "reviewNotes" TEXT,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "provider_application_documents_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "pharmacy_categories_listing_idx" ON "pharmacy_categories"("pharmacyId", "isActive", "sortOrder");

-- CreateIndex
CREATE UNIQUE INDEX "pharmacy_categories_pharmacy_slug_unique" ON "pharmacy_categories"("pharmacyId", "slug");

-- CreateIndex
CREATE INDEX "pharmacy_products_category_idx" ON "pharmacy_products"("pharmacyCategoryId", "isActive");

-- CreateIndex
CREATE UNIQUE INDEX "pharmacy_products_pharmacy_kit_unique" ON "pharmacy_products"("pharmacyId", "kitCode");

-- CreateIndex
CREATE UNIQUE INDEX "pharmacy_applications_pharmacyId_key" ON "pharmacy_applications"("pharmacyId");

-- CreateIndex
CREATE INDEX "pharmacy_applications_status_created_idx" ON "pharmacy_applications"("status", "createdAt");

-- CreateIndex
CREATE INDEX "pharmacy_applications_email_idx" ON "pharmacy_applications"("contactEmail");

-- CreateIndex
CREATE INDEX "pharmacy_application_documents_app_kind_idx" ON "pharmacy_application_documents"("applicationId", "kind");

-- CreateIndex
CREATE UNIQUE INDEX "provider_applications_providerId_key" ON "provider_applications"("providerId");

-- CreateIndex
CREATE INDEX "provider_applications_status_created_idx" ON "provider_applications"("status", "createdAt");

-- CreateIndex
CREATE INDEX "provider_applications_email_idx" ON "provider_applications"("email");

-- CreateIndex
CREATE UNIQUE INDEX "provider_application_licenses_app_state_unique" ON "provider_application_licenses"("applicationId", "state");

-- CreateIndex
CREATE INDEX "provider_application_documents_app_kind_idx" ON "provider_application_documents"("applicationId", "kind");

-- AddForeignKey
ALTER TABLE "pharmacy_categories" ADD CONSTRAINT "pharmacy_categories_pharmacyId_fkey" FOREIGN KEY ("pharmacyId") REFERENCES "pharmacies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pharmacy_categories" ADD CONSTRAINT "pharmacy_categories_clinicalCategoryId_fkey" FOREIGN KEY ("clinicalCategoryId") REFERENCES "categories"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pharmacy_products" ADD CONSTRAINT "pharmacy_products_pharmacyId_fkey" FOREIGN KEY ("pharmacyId") REFERENCES "pharmacies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pharmacy_products" ADD CONSTRAINT "pharmacy_products_pharmacyCategoryId_fkey" FOREIGN KEY ("pharmacyCategoryId") REFERENCES "pharmacy_categories"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pharmacy_products" ADD CONSTRAINT "pharmacy_products_medicationId_fkey" FOREIGN KEY ("medicationId") REFERENCES "medications"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pharmacy_applications" ADD CONSTRAINT "pharmacy_applications_pharmacyId_fkey" FOREIGN KEY ("pharmacyId") REFERENCES "pharmacies"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pharmacy_application_documents" ADD CONSTRAINT "pharmacy_application_documents_applicationId_fkey" FOREIGN KEY ("applicationId") REFERENCES "pharmacy_applications"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "provider_applications" ADD CONSTRAINT "provider_applications_providerId_fkey" FOREIGN KEY ("providerId") REFERENCES "provider_profiles"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "provider_application_licenses" ADD CONSTRAINT "provider_application_licenses_applicationId_fkey" FOREIGN KEY ("applicationId") REFERENCES "provider_applications"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "provider_application_documents" ADD CONSTRAINT "provider_application_documents_applicationId_fkey" FOREIGN KEY ("applicationId") REFERENCES "provider_applications"("id") ON DELETE CASCADE ON UPDATE CASCADE;
