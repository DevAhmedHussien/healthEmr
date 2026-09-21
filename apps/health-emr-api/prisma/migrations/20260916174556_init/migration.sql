-- CreateEnum
CREATE TYPE "Role" AS ENUM ('SUPER_ADMIN', 'ADMIN', 'PROVIDER', 'PHARMACY', 'PATIENT');

-- CreateEnum
CREATE TYPE "TenantStatus" AS ENUM ('ACTIVE', 'SUSPENDED', 'CLOSED');

-- CreateEnum
CREATE TYPE "AuditAction" AS ENUM ('LOGIN_SUCCESS', 'LOGIN_FAILED', 'LOGOUT', 'REFRESH_TOKEN_ROTATED', 'REFRESH_TOKEN_REVOKED', 'USER_CREATED', 'USER_UPDATED', 'USER_ROLE_CHANGED', 'USER_DEACTIVATED', 'TENANT_CREATED', 'TENANT_UPDATED', 'ENTITLEMENT_CHANGED', 'PHI_READ', 'PHI_CREATED', 'PHI_UPDATED', 'PHI_DELETED', 'REQUEST_ROUTED', 'REQUEST_DECIDED', 'PRESCRIPTION_SIGNED', 'PRESCRIPTION_VOIDED', 'ORDER_SUBMITTED', 'ORDER_STATUS_CHANGED', 'BREAK_THE_GLASS');

-- CreateEnum
CREATE TYPE "Sex" AS ENUM ('MALE', 'FEMALE');

-- CreateEnum
CREATE TYPE "LicenseStatus" AS ENUM ('ACTIVE', 'EXPIRED', 'SUSPENDED', 'REVOKED');

-- CreateEnum
CREATE TYPE "MedicationForm" AS ENUM ('INJECTABLE', 'ORAL', 'TOPICAL', 'NASAL', 'OTHER');

-- CreateEnum
CREATE TYPE "RequestStatus" AS ENUM ('RECEIVED', 'PENDING_ASSIGNMENT', 'ASSIGNED', 'IN_REVIEW', 'INFO_REQUESTED', 'APPROVED', 'DENIED', 'EXPIRED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "ItemDecision" AS ENUM ('PENDING', 'APPROVED', 'MODIFIED', 'DENIED');

-- CreateEnum
CREATE TYPE "RoutingOutcome" AS ENUM ('ASSIGNED', 'NO_LICENSE', 'LICENSE_EXPIRED', 'STATE_DISALLOWS_ASYNC', 'NOT_QUALIFIED', 'NOT_ON_TENANT_ROSTER', 'AT_CAPACITY', 'NOT_ACCEPTING');

-- CreateEnum
CREATE TYPE "PrescriptionStatus" AS ENUM ('SIGNED', 'TRANSMITTED', 'DISPENSED', 'SHIPPED', 'DELIVERED', 'VOIDED');

-- CreateEnum
CREATE TYPE "PharmacyOrderStatus" AS ENUM ('QUEUED', 'SUBMITTED', 'ACKNOWLEDGED', 'IN_FULFILMENT', 'SHIPPED', 'DELIVERED', 'REJECTED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "PharmacyPlatform" AS ENUM ('LIFEFILE', 'GENERIC_HTTP');

-- CreateEnum
CREATE TYPE "AuthStrategy" AS ENUM ('BEARER', 'API_KEY_HEADER', 'HMAC', 'BASIC');

-- CreateEnum
CREATE TYPE "SubmissionStatus" AS ENUM ('IN_PROGRESS', 'SUBMITTED');

-- CreateEnum
CREATE TYPE "EncounterType" AS ENUM ('ASYNC_REVIEW', 'FOLLOW_UP', 'NOTE');

-- CreateEnum
CREATE TYPE "EncounterStatus" AS ENUM ('OPEN', 'CLOSED');

-- CreateEnum
CREATE TYPE "AllergySeverity" AS ENUM ('MILD', 'MODERATE', 'SEVERE');

-- CreateEnum
CREATE TYPE "AllergyType" AS ENUM ('DRUG', 'FOOD', 'ENVIRONMENTAL', 'OTHER');

-- CreateEnum
CREATE TYPE "ClinicalStatus" AS ENUM ('ACTIVE', 'INACTIVE', 'RESOLVED');

-- CreateEnum
CREATE TYPE "MedicationSource" AS ENUM ('PATIENT_REPORTED', 'PRESCRIBED', 'IMPORTED');

-- CreateEnum
CREATE TYPE "ChatThreadStatus" AS ENUM ('OPEN', 'ARCHIVED', 'LOCKED');

-- CreateEnum
CREATE TYPE "ChatMessageKind" AS ENUM ('TEXT', 'MEDIA', 'SYSTEM');

-- CreateEnum
CREATE TYPE "InvoiceStatus" AS ENUM ('DRAFT', 'ISSUED', 'PAID', 'VOID', 'REFUNDED');

-- CreateEnum
CREATE TYPE "PaymentStatus" AS ENUM ('PENDING', 'SUCCEEDED', 'FAILED', 'REFUNDED');

-- CreateEnum
CREATE TYPE "DocumentKind" AS ENUM ('ID_PHOTO', 'RX_PHOTO', 'LAB_REPORT', 'CONSENT', 'OTHER');

-- CreateTable
CREATE TABLE "tenants" (
    "id" UUID NOT NULL,
    "slug" VARCHAR(120) NOT NULL,
    "name" VARCHAR(200) NOT NULL,
    "status" "TenantStatus" NOT NULL DEFAULT 'ACTIVE',
    "contactEmail" VARCHAR(255) NOT NULL,
    "billingPlan" VARCHAR(80),
    "allowedStates" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "tenants_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tenant_api_keys" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "name" VARCHAR(120) NOT NULL,
    "keyHash" TEXT NOT NULL,
    "keyPrefix" VARCHAR(16) NOT NULL,
    "scopes" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "lastUsedAt" TIMESTAMPTZ(6),
    "expiresAt" TIMESTAMPTZ(6),
    "revokedAt" TIMESTAMPTZ(6),
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "tenant_api_keys_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tenant_webhooks" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "url" VARCHAR(500) NOT NULL,
    "secretRef" VARCHAR(255) NOT NULL,
    "events" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "failureCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "tenant_webhooks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "webhook_deliveries" (
    "id" UUID NOT NULL,
    "webhookId" UUID NOT NULL,
    "event" VARCHAR(120) NOT NULL,
    "payload" JSONB NOT NULL,
    "responseStatus" INTEGER,
    "responseBody" TEXT,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "deliveredAt" TIMESTAMPTZ(6),
    "nextRetryAt" TIMESTAMPTZ(6),
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "webhook_deliveries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tenant_categories" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "categoryId" UUID NOT NULL,
    "isEnabled" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "tenant_categories_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tenant_medications" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "medicationId" UUID NOT NULL,
    "isEnabled" BOOLEAN NOT NULL DEFAULT true,
    "priceCents" INTEGER,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "tenant_medications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tenant_pharmacies" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "pharmacyId" UUID NOT NULL,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "externalAccountRef" VARCHAR(255),
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "tenant_pharmacies_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tenant_providers" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "providerId" UUID NOT NULL,
    "contractedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "endedAt" TIMESTAMPTZ(6),

    CONSTRAINT "tenant_providers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "users" (
    "id" UUID NOT NULL,
    "email" VARCHAR(255) NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "role" "Role" NOT NULL DEFAULT 'PATIENT',
    "tenantId" UUID,
    "firstName" VARCHAR(100) NOT NULL,
    "lastName" VARCHAR(100) NOT NULL,
    "phone" VARCHAR(30),
    "avatarUrl" VARCHAR(500),
    "isEmailVerified" BOOLEAN NOT NULL DEFAULT false,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "mfaEnabled" BOOLEAN NOT NULL DEFAULT false,
    "lastLoginAt" TIMESTAMPTZ(6),
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "refresh_sessions" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "userAgent" TEXT,
    "ip" VARCHAR(64),
    "expiresAt" TIMESTAMPTZ(6) NOT NULL,
    "revokedAt" TIMESTAMPTZ(6),
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "refresh_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "password_reset_tokens" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMPTZ(6) NOT NULL,
    "usedAt" TIMESTAMPTZ(6),
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "password_reset_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "email_verification_tokens" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMPTZ(6) NOT NULL,
    "usedAt" TIMESTAMPTZ(6),
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "email_verification_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_logs" (
    "id" UUID NOT NULL,
    "tenantId" UUID,
    "actorUserId" UUID,
    "actorRole" "Role",
    "action" "AuditAction" NOT NULL,
    "entityType" VARCHAR(120) NOT NULL,
    "entityId" VARCHAR(120),
    "patientId" UUID,
    "before" JSONB,
    "after" JSONB,
    "ip" VARCHAR(64),
    "userAgent" TEXT,
    "requestId" VARCHAR(64),
    "sequence" BIGINT NOT NULL,
    "prevHash" VARCHAR(64),
    "hash" VARCHAR(64) NOT NULL,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "service_accounts" (
    "id" UUID NOT NULL,
    "name" VARCHAR(120) NOT NULL,
    "keyHash" TEXT NOT NULL,
    "keyPrefix" VARCHAR(16) NOT NULL,
    "scopes" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "lastUsedAt" TIMESTAMPTZ(6),
    "revokedAt" TIMESTAMPTZ(6),
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "service_accounts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "patients" (
    "id" UUID NOT NULL,
    "mrn" VARCHAR(40) NOT NULL,
    "userId" UUID,
    "firstName" VARCHAR(100) NOT NULL,
    "lastName" VARCHAR(100) NOT NULL,
    "dob" VARCHAR(255) NOT NULL,
    "sexAtBirth" "Sex" NOT NULL,
    "phone" VARCHAR(30) NOT NULL,
    "email" VARCHAR(255) NOT NULL,
    "addressLine1" VARCHAR(200) NOT NULL,
    "addressLine2" VARCHAR(200),
    "city" VARCHAR(120) NOT NULL,
    "residenceState" VARCHAR(2) NOT NULL,
    "postalCode" VARCHAR(20) NOT NULL,
    "idPhotoKey" VARCHAR(512),
    "idPhotoVerifiedAt" TIMESTAMPTZ(6),
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "patients_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tenant_patients" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "patientId" UUID NOT NULL,
    "externalContactId" VARCHAR(255),
    "firstSeenAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "isActive" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "tenant_patients_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "encounters" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "patientId" UUID NOT NULL,
    "providerId" UUID,
    "type" "EncounterType" NOT NULL DEFAULT 'ASYNC_REVIEW',
    "status" "EncounterStatus" NOT NULL DEFAULT 'OPEN',
    "occurredAt" TIMESTAMPTZ(6) NOT NULL,
    "chiefComplaint" VARCHAR(500),
    "summary" TEXT,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "encounters_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "vitals" (
    "id" UUID NOT NULL,
    "patientId" UUID NOT NULL,
    "encounterId" UUID,
    "heightIn" DECIMAL(5,2),
    "weightLbs" DECIMAL(6,2),
    "bmi" DECIMAL(5,2),
    "systolic" INTEGER,
    "diastolic" INTEGER,
    "heartRate" INTEGER,
    "temperatureF" DECIMAL(4,1),
    "recordedAt" TIMESTAMPTZ(6) NOT NULL,
    "recordedByUserId" UUID,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "vitals_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "allergies" (
    "id" UUID NOT NULL,
    "patientId" UUID NOT NULL,
    "substance" VARCHAR(200) NOT NULL,
    "reactionText" TEXT,
    "severity" "AllergySeverity" NOT NULL DEFAULT 'MILD',
    "type" "AllergyType" NOT NULL DEFAULT 'DRUG',
    "onsetDate" TIMESTAMPTZ(6),
    "status" "ClinicalStatus" NOT NULL DEFAULT 'ACTIVE',
    "recordedByUserId" UUID,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "allergies_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "conditions" (
    "id" UUID NOT NULL,
    "patientId" UUID NOT NULL,
    "code" VARCHAR(40),
    "display" VARCHAR(300) NOT NULL,
    "onsetDate" TIMESTAMPTZ(6),
    "resolvedDate" TIMESTAMPTZ(6),
    "clinicalStatus" "ClinicalStatus" NOT NULL DEFAULT 'ACTIVE',
    "recordedByUserId" UUID,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "conditions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "patient_medications" (
    "id" UUID NOT NULL,
    "patientId" UUID NOT NULL,
    "medicationId" UUID,
    "nameText" VARCHAR(250) NOT NULL,
    "dose" VARCHAR(120),
    "route" VARCHAR(80),
    "frequency" VARCHAR(120),
    "startDate" TIMESTAMPTZ(6),
    "endDate" TIMESTAMPTZ(6),
    "status" "ClinicalStatus" NOT NULL DEFAULT 'ACTIVE',
    "source" "MedicationSource" NOT NULL DEFAULT 'PATIENT_REPORTED',
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "patient_medications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "lab_results" (
    "id" UUID NOT NULL,
    "patientId" UUID NOT NULL,
    "submissionId" UUID,
    "screeningDate" TIMESTAMPTZ(6) NOT NULL,
    "testName" VARCHAR(200) NOT NULL,
    "testResult" VARCHAR(200) NOT NULL,
    "testResultUnits" VARCHAR(80),
    "refRange" VARCHAR(120),
    "statusIndicator" VARCHAR(8) NOT NULL,
    "reportDate" TIMESTAMPTZ(6),
    "sampleSource" VARCHAR(40),
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "lab_results_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "provider_notes" (
    "id" UUID NOT NULL,
    "encounterId" UUID NOT NULL,
    "providerId" UUID NOT NULL,
    "authorUserId" UUID NOT NULL,
    "body" TEXT NOT NULL,
    "isAmendment" BOOLEAN NOT NULL DEFAULT false,
    "amendsNoteId" UUID,
    "signedAt" TIMESTAMPTZ(6),
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "provider_notes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "patient_documents" (
    "id" UUID NOT NULL,
    "patientId" UUID NOT NULL,
    "kind" "DocumentKind" NOT NULL DEFAULT 'OTHER',
    "bucket" VARCHAR(255) NOT NULL,
    "objectKey" VARCHAR(512) NOT NULL,
    "mime" VARCHAR(120) NOT NULL,
    "size" INTEGER NOT NULL,
    "fileName" VARCHAR(255),
    "uploadedByUserId" UUID,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "patient_documents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "provider_profiles" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "npi" VARCHAR(20),
    "credentials" VARCHAR(80),
    "specialties" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "bio" TEXT,
    "signatureImageKey" VARCHAR(512),
    "deaNumber" VARCHAR(40),
    "isAcceptingRequests" BOOLEAN NOT NULL DEFAULT true,
    "maxOpenRequests" INTEGER NOT NULL DEFAULT 25,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "provider_profiles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "provider_licenses" (
    "id" UUID NOT NULL,
    "providerId" UUID NOT NULL,
    "state" VARCHAR(2) NOT NULL,
    "licenseNumber" VARCHAR(80) NOT NULL,
    "issuedAt" TIMESTAMPTZ(6),
    "expiresAt" TIMESTAMPTZ(6) NOT NULL,
    "status" "LicenseStatus" NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "provider_licenses_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "provider_categories" (
    "id" UUID NOT NULL,
    "providerId" UUID NOT NULL,
    "categoryId" UUID NOT NULL,

    CONSTRAINT "provider_categories_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "state_policies" (
    "id" UUID NOT NULL,
    "state" VARCHAR(2) NOT NULL,
    "allowsAsyncPrescribing" BOOLEAN NOT NULL DEFAULT false,
    "requiresSynchronousInitial" BOOLEAN NOT NULL DEFAULT true,
    "requiresPriorInPerson" BOOLEAN NOT NULL DEFAULT false,
    "notes" TEXT,
    "reviewedAt" TIMESTAMPTZ(6),
    "reviewedBy" VARCHAR(200),
    "updatedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "state_policies_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "categories" (
    "id" UUID NOT NULL,
    "slug" VARCHAR(120) NOT NULL,
    "name" VARCHAR(200) NOT NULL,
    "description" TEXT,
    "isFollowUp" BOOLEAN NOT NULL DEFAULT false,
    "parentCategoryId" UUID,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "categories_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "medications" (
    "id" UUID NOT NULL,
    "medId" VARCHAR(120) NOT NULL,
    "name" VARCHAR(250) NOT NULL,
    "genericName" VARCHAR(250),
    "strength" VARCHAR(120),
    "form" "MedicationForm" NOT NULL DEFAULT 'OTHER',
    "route" VARCHAR(80),
    "ndc" VARCHAR(40),
    "isCompounded" BOOLEAN NOT NULL DEFAULT false,
    "isBranded" BOOLEAN NOT NULL DEFAULT false,
    "isControlled" BOOLEAN NOT NULL DEFAULT false,
    "deaSchedule" VARCHAR(8),
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "medications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "category_medications" (
    "id" UUID NOT NULL,
    "categoryId" UUID NOT NULL,
    "medicationId" UUID NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "category_medications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "questionnaire_templates" (
    "id" UUID NOT NULL,
    "categoryId" UUID NOT NULL,
    "version" INTEGER NOT NULL,
    "schemaJson" JSONB NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdByUserId" UUID,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "questionnaire_templates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "qa_submissions" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "patientId" UUID NOT NULL,
    "categoryId" UUID NOT NULL,
    "templateId" UUID,
    "templateVersion" INTEGER NOT NULL,
    "status" "SubmissionStatus" NOT NULL DEFAULT 'SUBMITTED',
    "valuesJson" JSONB,
    "patientStateAtSubmission" VARCHAR(2) NOT NULL,
    "testToTreat" BOOLEAN NOT NULL DEFAULT false,
    "submittedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "qa_submissions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "qa_answers" (
    "id" UUID NOT NULL,
    "submissionId" UUID NOT NULL,
    "questionId" VARCHAR(120) NOT NULL,
    "questionText" TEXT,
    "valueJson" JSONB NOT NULL,
    "answeredAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "qa_answers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "prescription_requests" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "externalMasterId" VARCHAR(255) NOT NULL,
    "qaSubmissionId" UUID NOT NULL,
    "patientId" UUID NOT NULL,
    "categoryId" UUID NOT NULL,
    "requestedPharmacyId" UUID,
    "status" "RequestStatus" NOT NULL DEFAULT 'RECEIVED',
    "assignedProviderId" UUID,
    "assignedAt" TIMESTAMPTZ(6),
    "reviewStartedAt" TIMESTAMPTZ(6),
    "decidedAt" TIMESTAMPTZ(6),
    "denialReason" TEXT,
    "expiresAt" TIMESTAMPTZ(6),
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "prescription_requests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "prescription_request_items" (
    "id" UUID NOT NULL,
    "requestId" UUID NOT NULL,
    "medicationId" UUID NOT NULL,
    "nameText" VARCHAR(250) NOT NULL,
    "strength" VARCHAR(120) NOT NULL,
    "quantity" VARCHAR(50) NOT NULL,
    "refills" VARCHAR(50) NOT NULL,
    "daysSupply" VARCHAR(50),
    "decision" "ItemDecision" NOT NULL DEFAULT 'PENDING',
    "approvedStrength" VARCHAR(120),
    "approvedQuantity" VARCHAR(50),
    "approvedRefills" VARCHAR(50),
    "decisionReason" TEXT,
    "decidedAt" TIMESTAMPTZ(6),
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "prescription_request_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "routing_attempts" (
    "id" UUID NOT NULL,
    "requestId" UUID NOT NULL,
    "providerId" UUID,
    "rule" VARCHAR(120) NOT NULL,
    "outcome" "RoutingOutcome" NOT NULL,
    "detail" TEXT,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "routing_attempts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "prescriptions" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "requestId" UUID NOT NULL,
    "requestItemId" UUID NOT NULL,
    "patientId" UUID NOT NULL,
    "providerId" UUID NOT NULL,
    "medicationId" UUID NOT NULL,
    "dose" VARCHAR(120) NOT NULL,
    "quantity" VARCHAR(50) NOT NULL,
    "refills" INTEGER NOT NULL DEFAULT 0,
    "daysSupply" INTEGER,
    "sig" TEXT NOT NULL,
    "providerNameSnapshot" VARCHAR(200) NOT NULL,
    "licenseNumberSnapshot" VARCHAR(80) NOT NULL,
    "licenseStateSnapshot" VARCHAR(2) NOT NULL,
    "signedAt" TIMESTAMPTZ(6) NOT NULL,
    "status" "PrescriptionStatus" NOT NULL DEFAULT 'SIGNED',
    "voidedAt" TIMESTAMPTZ(6),
    "voidReason" TEXT,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "prescriptions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pharmacies" (
    "id" UUID NOT NULL,
    "slug" VARCHAR(120) NOT NULL,
    "name" VARCHAR(200) NOT NULL,
    "platform" "PharmacyPlatform" NOT NULL DEFAULT 'GENERIC_HTTP',
    "ncpdpId" VARCHAR(40),
    "dispensesCompounded" BOOLEAN NOT NULL DEFAULT false,
    "dispensesBranded" BOOLEAN NOT NULL DEFAULT false,
    "contactEmail" VARCHAR(255),
    "contactPhone" VARCHAR(30),
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "pharmacies_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pharmacy_configs" (
    "id" UUID NOT NULL,
    "pharmacyId" UUID NOT NULL,
    "baseUrl" VARCHAR(500) NOT NULL,
    "authStrategy" "AuthStrategy" NOT NULL DEFAULT 'BEARER',
    "credentialRef" VARCHAR(255) NOT NULL,
    "staticHeaders" JSONB,
    "payloadMapping" JSONB,
    "timeoutMs" INTEGER NOT NULL DEFAULT 15000,
    "webhookSecretRef" VARCHAR(255),
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "pharmacy_configs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pharmacy_kits" (
    "id" UUID NOT NULL,
    "pharmacyId" UUID NOT NULL,
    "kitCode" VARCHAR(160) NOT NULL,
    "label" VARCHAR(250) NOT NULL,
    "medicationId" UUID,
    "categoryId" UUID,
    "daysSupply" INTEGER,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "pharmacy_kits_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pharmacy_formulary_items" (
    "id" UUID NOT NULL,
    "pharmacyId" UUID NOT NULL,
    "medicationId" UUID NOT NULL,
    "externalSku" VARCHAR(160),
    "isAvailable" BOOLEAN NOT NULL DEFAULT true,
    "lastSyncedAt" TIMESTAMPTZ(6),

    CONSTRAINT "pharmacy_formulary_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pharmacy_orders" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "prescriptionId" UUID NOT NULL,
    "pharmacyId" UUID NOT NULL,
    "externalOrderId" VARCHAR(160),
    "status" "PharmacyOrderStatus" NOT NULL DEFAULT 'QUEUED',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "submittedAt" TIMESTAMPTZ(6),
    "acknowledgedAt" TIMESTAMPTZ(6),
    "shippedAt" TIMESTAMPTZ(6),
    "deliveredAt" TIMESTAMPTZ(6),
    "trackingNumber" VARCHAR(120),
    "carrier" VARCHAR(80),
    "requestPayload" JSONB,
    "responsePayload" JSONB,
    "lastError" TEXT,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "pharmacy_orders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pharmacy_webhook_logs" (
    "id" UUID NOT NULL,
    "pharmacyId" UUID,
    "event" VARCHAR(120) NOT NULL,
    "externalOrderId" VARCHAR(160),
    "payload" JSONB NOT NULL,
    "headers" JSONB,
    "status" VARCHAR(40) NOT NULL DEFAULT 'RECEIVED',
    "error" TEXT,
    "processedAt" TIMESTAMPTZ(6),
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "pharmacy_webhook_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "chat_threads" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "patientId" UUID NOT NULL,
    "providerId" UUID,
    "status" "ChatThreadStatus" NOT NULL DEFAULT 'OPEN',
    "hasUnreadForPatient" BOOLEAN NOT NULL DEFAULT false,
    "hasUnreadForProvider" BOOLEAN NOT NULL DEFAULT false,
    "lastMessageAt" TIMESTAMPTZ(6),
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "chat_threads_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "chat_messages" (
    "id" UUID NOT NULL,
    "threadId" UUID NOT NULL,
    "authorUserId" UUID,
    "authorRole" "Role" NOT NULL,
    "kind" "ChatMessageKind" NOT NULL DEFAULT 'TEXT',
    "content" TEXT NOT NULL,
    "sentAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deliveredAt" TIMESTAMPTZ(6),
    "readAt" TIMESTAMPTZ(6),

    CONSTRAINT "chat_messages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "chat_attachments" (
    "id" UUID NOT NULL,
    "messageId" UUID NOT NULL,
    "bucket" VARCHAR(255) NOT NULL,
    "objectKey" VARCHAR(512) NOT NULL,
    "mime" VARCHAR(120) NOT NULL,
    "size" INTEGER NOT NULL,
    "fileName" VARCHAR(255),
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "chat_attachments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "invoices" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "patientId" UUID NOT NULL,
    "prescriptionId" UUID,
    "pharmacyOrderId" UUID,
    "number" VARCHAR(60) NOT NULL,
    "currency" VARCHAR(8) NOT NULL DEFAULT 'USD',
    "subtotalCents" INTEGER NOT NULL DEFAULT 0,
    "discountCents" INTEGER NOT NULL DEFAULT 0,
    "taxCents" INTEGER NOT NULL DEFAULT 0,
    "totalCents" INTEGER NOT NULL DEFAULT 0,
    "status" "InvoiceStatus" NOT NULL DEFAULT 'DRAFT',
    "issuedAt" TIMESTAMPTZ(6),
    "dueAt" TIMESTAMPTZ(6),
    "paidAt" TIMESTAMPTZ(6),
    "pdfObjectKey" VARCHAR(512),
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "invoices_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "invoice_lines" (
    "id" UUID NOT NULL,
    "invoiceId" UUID NOT NULL,
    "description" VARCHAR(300) NOT NULL,
    "medicationId" UUID,
    "quantity" INTEGER NOT NULL DEFAULT 1,
    "unitPriceCents" INTEGER NOT NULL,
    "totalCents" INTEGER NOT NULL,

    CONSTRAINT "invoice_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payments" (
    "id" UUID NOT NULL,
    "invoiceId" UUID NOT NULL,
    "processor" VARCHAR(60) NOT NULL,
    "externalId" VARCHAR(160),
    "amountCents" INTEGER NOT NULL,
    "status" "PaymentStatus" NOT NULL DEFAULT 'PENDING',
    "paidAt" TIMESTAMPTZ(6),
    "failureReason" TEXT,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "payments_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "tenants_slug_key" ON "tenants"("slug");

-- CreateIndex
CREATE INDEX "tenants_status_idx" ON "tenants"("status");

-- CreateIndex
CREATE UNIQUE INDEX "tenant_api_keys_keyHash_key" ON "tenant_api_keys"("keyHash");

-- CreateIndex
CREATE UNIQUE INDEX "tenant_api_keys_keyPrefix_key" ON "tenant_api_keys"("keyPrefix");

-- CreateIndex
CREATE INDEX "tenant_api_keys_tenant_idx" ON "tenant_api_keys"("tenantId");

-- CreateIndex
CREATE INDEX "tenant_webhooks_tenant_active_idx" ON "tenant_webhooks"("tenantId", "isActive");

-- CreateIndex
CREATE INDEX "webhook_deliveries_retry_idx" ON "webhook_deliveries"("nextRetryAt");

-- CreateIndex
CREATE INDEX "webhook_deliveries_webhook_created_idx" ON "webhook_deliveries"("webhookId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "tenant_categories_unique" ON "tenant_categories"("tenantId", "categoryId");

-- CreateIndex
CREATE UNIQUE INDEX "tenant_medications_unique" ON "tenant_medications"("tenantId", "medicationId");

-- CreateIndex
CREATE UNIQUE INDEX "tenant_pharmacies_unique" ON "tenant_pharmacies"("tenantId", "pharmacyId");

-- CreateIndex
CREATE UNIQUE INDEX "tenant_providers_unique" ON "tenant_providers"("tenantId", "providerId");

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE INDEX "users_role_idx" ON "users"("role");

-- CreateIndex
CREATE INDEX "users_tenant_idx" ON "users"("tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "refresh_sessions_tokenHash_key" ON "refresh_sessions"("tokenHash");

-- CreateIndex
CREATE INDEX "refresh_sessions_user_idx" ON "refresh_sessions"("userId");

-- CreateIndex
CREATE INDEX "refresh_sessions_expires_idx" ON "refresh_sessions"("expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "password_reset_tokens_tokenHash_key" ON "password_reset_tokens"("tokenHash");

-- CreateIndex
CREATE UNIQUE INDEX "email_verification_tokens_tokenHash_key" ON "email_verification_tokens"("tokenHash");

-- CreateIndex
CREATE INDEX "audit_logs_tenant_created_idx" ON "audit_logs"("tenantId", "createdAt");

-- CreateIndex
CREATE INDEX "audit_logs_patient_created_idx" ON "audit_logs"("patientId", "createdAt");

-- CreateIndex
CREATE INDEX "audit_logs_action_idx" ON "audit_logs"("action");

-- CreateIndex
CREATE UNIQUE INDEX "audit_logs_sequence_unique" ON "audit_logs"("sequence");

-- CreateIndex
CREATE UNIQUE INDEX "service_accounts_name_key" ON "service_accounts"("name");

-- CreateIndex
CREATE UNIQUE INDEX "service_accounts_keyHash_key" ON "service_accounts"("keyHash");

-- CreateIndex
CREATE UNIQUE INDEX "service_accounts_keyPrefix_key" ON "service_accounts"("keyPrefix");

-- CreateIndex
CREATE UNIQUE INDEX "patients_mrn_key" ON "patients"("mrn");

-- CreateIndex
CREATE UNIQUE INDEX "patients_userId_key" ON "patients"("userId");

-- CreateIndex
CREATE INDEX "patients_email_idx" ON "patients"("email");

-- CreateIndex
CREATE UNIQUE INDEX "patients_phone_dob_unique" ON "patients"("phone", "dob");

-- CreateIndex
CREATE INDEX "tenant_patients_tenant_active_idx" ON "tenant_patients"("tenantId", "isActive");

-- CreateIndex
CREATE UNIQUE INDEX "tenant_patients_unique" ON "tenant_patients"("tenantId", "patientId");

-- CreateIndex
CREATE INDEX "encounters_tenant_occurred_idx" ON "encounters"("tenantId", "occurredAt");

-- CreateIndex
CREATE INDEX "encounters_patient_occurred_idx" ON "encounters"("patientId", "occurredAt");

-- CreateIndex
CREATE INDEX "vitals_patient_recorded_idx" ON "vitals"("patientId", "recordedAt");

-- CreateIndex
CREATE INDEX "allergies_patient_status_idx" ON "allergies"("patientId", "status");

-- CreateIndex
CREATE INDEX "conditions_patient_status_idx" ON "conditions"("patientId", "clinicalStatus");

-- CreateIndex
CREATE INDEX "patient_medications_patient_status_idx" ON "patient_medications"("patientId", "status");

-- CreateIndex
CREATE INDEX "lab_results_patient_screening_idx" ON "lab_results"("patientId", "screeningDate");

-- CreateIndex
CREATE INDEX "provider_notes_encounter_created_idx" ON "provider_notes"("encounterId", "createdAt");

-- CreateIndex
CREATE INDEX "patient_documents_patient_kind_idx" ON "patient_documents"("patientId", "kind");

-- CreateIndex
CREATE UNIQUE INDEX "provider_profiles_userId_key" ON "provider_profiles"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "provider_profiles_npi_key" ON "provider_profiles"("npi");

-- CreateIndex
CREATE INDEX "provider_profiles_accepting_idx" ON "provider_profiles"("isAcceptingRequests");

-- CreateIndex
CREATE INDEX "provider_licenses_routing_idx" ON "provider_licenses"("state", "status", "expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "provider_licenses_provider_state_unique" ON "provider_licenses"("providerId", "state");

-- CreateIndex
CREATE UNIQUE INDEX "provider_categories_unique" ON "provider_categories"("providerId", "categoryId");

-- CreateIndex
CREATE UNIQUE INDEX "state_policies_state_key" ON "state_policies"("state");

-- CreateIndex
CREATE UNIQUE INDEX "categories_slug_key" ON "categories"("slug");

-- CreateIndex
CREATE INDEX "categories_active_sort_idx" ON "categories"("isActive", "sortOrder");

-- CreateIndex
CREATE UNIQUE INDEX "medications_medId_key" ON "medications"("medId");

-- CreateIndex
CREATE INDEX "medications_active_idx" ON "medications"("isActive");

-- CreateIndex
CREATE UNIQUE INDEX "category_medications_unique" ON "category_medications"("categoryId", "medicationId");

-- CreateIndex
CREATE INDEX "questionnaire_templates_category_active_idx" ON "questionnaire_templates"("categoryId", "isActive");

-- CreateIndex
CREATE UNIQUE INDEX "questionnaire_templates_category_version_unique" ON "questionnaire_templates"("categoryId", "version");

-- CreateIndex
CREATE INDEX "qa_submissions_tenant_submitted_idx" ON "qa_submissions"("tenantId", "submittedAt");

-- CreateIndex
CREATE INDEX "qa_submissions_patient_submitted_idx" ON "qa_submissions"("patientId", "submittedAt");

-- CreateIndex
CREATE UNIQUE INDEX "qa_answers_submission_question_unique" ON "qa_answers"("submissionId", "questionId");

-- CreateIndex
CREATE UNIQUE INDEX "prescription_requests_qaSubmissionId_key" ON "prescription_requests"("qaSubmissionId");

-- CreateIndex
CREATE INDEX "prescription_requests_status_created_idx" ON "prescription_requests"("status", "createdAt");

-- CreateIndex
CREATE INDEX "prescription_requests_provider_status_idx" ON "prescription_requests"("assignedProviderId", "status");

-- CreateIndex
CREATE INDEX "prescription_requests_tenant_status_idx" ON "prescription_requests"("tenantId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "prescription_requests_tenant_master_unique" ON "prescription_requests"("tenantId", "externalMasterId");

-- CreateIndex
CREATE INDEX "prescription_request_items_request_idx" ON "prescription_request_items"("requestId");

-- CreateIndex
CREATE INDEX "routing_attempts_request_created_idx" ON "routing_attempts"("requestId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "prescriptions_requestItemId_key" ON "prescriptions"("requestItemId");

-- CreateIndex
CREATE INDEX "prescriptions_tenant_signed_idx" ON "prescriptions"("tenantId", "signedAt");

-- CreateIndex
CREATE INDEX "prescriptions_patient_signed_idx" ON "prescriptions"("patientId", "signedAt");

-- CreateIndex
CREATE INDEX "prescriptions_status_idx" ON "prescriptions"("status");

-- CreateIndex
CREATE UNIQUE INDEX "pharmacies_slug_key" ON "pharmacies"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "pharmacy_configs_pharmacyId_key" ON "pharmacy_configs"("pharmacyId");

-- CreateIndex
CREATE UNIQUE INDEX "pharmacy_kits_pharmacy_code_unique" ON "pharmacy_kits"("pharmacyId", "kitCode");

-- CreateIndex
CREATE UNIQUE INDEX "pharmacy_formulary_items_unique" ON "pharmacy_formulary_items"("pharmacyId", "medicationId");

-- CreateIndex
CREATE INDEX "pharmacy_orders_status_created_idx" ON "pharmacy_orders"("status", "createdAt");

-- CreateIndex
CREATE INDEX "pharmacy_orders_tenant_created_idx" ON "pharmacy_orders"("tenantId", "createdAt");

-- CreateIndex
CREATE INDEX "pharmacy_orders_external_idx" ON "pharmacy_orders"("externalOrderId");

-- CreateIndex
CREATE INDEX "pharmacy_webhook_logs_external_idx" ON "pharmacy_webhook_logs"("externalOrderId");

-- CreateIndex
CREATE INDEX "chat_threads_tenant_last_idx" ON "chat_threads"("tenantId", "lastMessageAt");

-- CreateIndex
CREATE UNIQUE INDEX "chat_threads_tenant_patient_unique" ON "chat_threads"("tenantId", "patientId");

-- CreateIndex
CREATE INDEX "chat_messages_thread_sent_idx" ON "chat_messages"("threadId", "sentAt");

-- CreateIndex
CREATE UNIQUE INDEX "invoices_number_key" ON "invoices"("number");

-- CreateIndex
CREATE INDEX "invoices_tenant_status_issued_idx" ON "invoices"("tenantId", "status", "issuedAt");

-- CreateIndex
CREATE INDEX "invoice_lines_invoice_idx" ON "invoice_lines"("invoiceId");

-- CreateIndex
CREATE INDEX "payments_invoice_idx" ON "payments"("invoiceId");

-- AddForeignKey
ALTER TABLE "tenant_api_keys" ADD CONSTRAINT "tenant_api_keys_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tenant_webhooks" ADD CONSTRAINT "tenant_webhooks_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "webhook_deliveries" ADD CONSTRAINT "webhook_deliveries_webhookId_fkey" FOREIGN KEY ("webhookId") REFERENCES "tenant_webhooks"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tenant_categories" ADD CONSTRAINT "tenant_categories_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tenant_categories" ADD CONSTRAINT "tenant_categories_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "categories"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tenant_medications" ADD CONSTRAINT "tenant_medications_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tenant_medications" ADD CONSTRAINT "tenant_medications_medicationId_fkey" FOREIGN KEY ("medicationId") REFERENCES "medications"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tenant_pharmacies" ADD CONSTRAINT "tenant_pharmacies_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tenant_pharmacies" ADD CONSTRAINT "tenant_pharmacies_pharmacyId_fkey" FOREIGN KEY ("pharmacyId") REFERENCES "pharmacies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tenant_providers" ADD CONSTRAINT "tenant_providers_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tenant_providers" ADD CONSTRAINT "tenant_providers_providerId_fkey" FOREIGN KEY ("providerId") REFERENCES "provider_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "users" ADD CONSTRAINT "users_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "refresh_sessions" ADD CONSTRAINT "refresh_sessions_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "password_reset_tokens" ADD CONSTRAINT "password_reset_tokens_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "email_verification_tokens" ADD CONSTRAINT "email_verification_tokens_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_actorUserId_fkey" FOREIGN KEY ("actorUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "patients" ADD CONSTRAINT "patients_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tenant_patients" ADD CONSTRAINT "tenant_patients_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tenant_patients" ADD CONSTRAINT "tenant_patients_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES "patients"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "encounters" ADD CONSTRAINT "encounters_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "encounters" ADD CONSTRAINT "encounters_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES "patients"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "encounters" ADD CONSTRAINT "encounters_providerId_fkey" FOREIGN KEY ("providerId") REFERENCES "provider_profiles"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vitals" ADD CONSTRAINT "vitals_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES "patients"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vitals" ADD CONSTRAINT "vitals_encounterId_fkey" FOREIGN KEY ("encounterId") REFERENCES "encounters"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "allergies" ADD CONSTRAINT "allergies_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES "patients"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "conditions" ADD CONSTRAINT "conditions_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES "patients"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "patient_medications" ADD CONSTRAINT "patient_medications_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES "patients"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "patient_medications" ADD CONSTRAINT "patient_medications_medicationId_fkey" FOREIGN KEY ("medicationId") REFERENCES "medications"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lab_results" ADD CONSTRAINT "lab_results_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES "patients"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lab_results" ADD CONSTRAINT "lab_results_submissionId_fkey" FOREIGN KEY ("submissionId") REFERENCES "qa_submissions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "provider_notes" ADD CONSTRAINT "provider_notes_encounterId_fkey" FOREIGN KEY ("encounterId") REFERENCES "encounters"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "provider_notes" ADD CONSTRAINT "provider_notes_providerId_fkey" FOREIGN KEY ("providerId") REFERENCES "provider_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "provider_notes" ADD CONSTRAINT "provider_notes_authorUserId_fkey" FOREIGN KEY ("authorUserId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "provider_notes" ADD CONSTRAINT "provider_notes_amendsNoteId_fkey" FOREIGN KEY ("amendsNoteId") REFERENCES "provider_notes"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "patient_documents" ADD CONSTRAINT "patient_documents_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES "patients"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "provider_profiles" ADD CONSTRAINT "provider_profiles_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "provider_licenses" ADD CONSTRAINT "provider_licenses_providerId_fkey" FOREIGN KEY ("providerId") REFERENCES "provider_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "provider_categories" ADD CONSTRAINT "provider_categories_providerId_fkey" FOREIGN KEY ("providerId") REFERENCES "provider_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "provider_categories" ADD CONSTRAINT "provider_categories_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "categories"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "categories" ADD CONSTRAINT "categories_parentCategoryId_fkey" FOREIGN KEY ("parentCategoryId") REFERENCES "categories"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "category_medications" ADD CONSTRAINT "category_medications_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "categories"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "category_medications" ADD CONSTRAINT "category_medications_medicationId_fkey" FOREIGN KEY ("medicationId") REFERENCES "medications"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "questionnaire_templates" ADD CONSTRAINT "questionnaire_templates_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "categories"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "questionnaire_templates" ADD CONSTRAINT "questionnaire_templates_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "qa_submissions" ADD CONSTRAINT "qa_submissions_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "qa_submissions" ADD CONSTRAINT "qa_submissions_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES "patients"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "qa_submissions" ADD CONSTRAINT "qa_submissions_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "categories"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "qa_submissions" ADD CONSTRAINT "qa_submissions_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "questionnaire_templates"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "qa_answers" ADD CONSTRAINT "qa_answers_submissionId_fkey" FOREIGN KEY ("submissionId") REFERENCES "qa_submissions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "prescription_requests" ADD CONSTRAINT "prescription_requests_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "prescription_requests" ADD CONSTRAINT "prescription_requests_qaSubmissionId_fkey" FOREIGN KEY ("qaSubmissionId") REFERENCES "qa_submissions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "prescription_requests" ADD CONSTRAINT "prescription_requests_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES "patients"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "prescription_requests" ADD CONSTRAINT "prescription_requests_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "categories"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "prescription_requests" ADD CONSTRAINT "prescription_requests_assignedProviderId_fkey" FOREIGN KEY ("assignedProviderId") REFERENCES "provider_profiles"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "prescription_requests" ADD CONSTRAINT "prescription_requests_requestedPharmacyId_fkey" FOREIGN KEY ("requestedPharmacyId") REFERENCES "pharmacies"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "prescription_request_items" ADD CONSTRAINT "prescription_request_items_requestId_fkey" FOREIGN KEY ("requestId") REFERENCES "prescription_requests"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "prescription_request_items" ADD CONSTRAINT "prescription_request_items_medicationId_fkey" FOREIGN KEY ("medicationId") REFERENCES "medications"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "routing_attempts" ADD CONSTRAINT "routing_attempts_requestId_fkey" FOREIGN KEY ("requestId") REFERENCES "prescription_requests"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "routing_attempts" ADD CONSTRAINT "routing_attempts_providerId_fkey" FOREIGN KEY ("providerId") REFERENCES "provider_profiles"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "prescriptions" ADD CONSTRAINT "prescriptions_requestId_fkey" FOREIGN KEY ("requestId") REFERENCES "prescription_requests"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "prescriptions" ADD CONSTRAINT "prescriptions_requestItemId_fkey" FOREIGN KEY ("requestItemId") REFERENCES "prescription_request_items"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "prescriptions" ADD CONSTRAINT "prescriptions_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES "patients"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "prescriptions" ADD CONSTRAINT "prescriptions_providerId_fkey" FOREIGN KEY ("providerId") REFERENCES "provider_profiles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "prescriptions" ADD CONSTRAINT "prescriptions_medicationId_fkey" FOREIGN KEY ("medicationId") REFERENCES "medications"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pharmacy_configs" ADD CONSTRAINT "pharmacy_configs_pharmacyId_fkey" FOREIGN KEY ("pharmacyId") REFERENCES "pharmacies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pharmacy_kits" ADD CONSTRAINT "pharmacy_kits_pharmacyId_fkey" FOREIGN KEY ("pharmacyId") REFERENCES "pharmacies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pharmacy_kits" ADD CONSTRAINT "pharmacy_kits_medicationId_fkey" FOREIGN KEY ("medicationId") REFERENCES "medications"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pharmacy_kits" ADD CONSTRAINT "pharmacy_kits_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "categories"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pharmacy_formulary_items" ADD CONSTRAINT "pharmacy_formulary_items_pharmacyId_fkey" FOREIGN KEY ("pharmacyId") REFERENCES "pharmacies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pharmacy_formulary_items" ADD CONSTRAINT "pharmacy_formulary_items_medicationId_fkey" FOREIGN KEY ("medicationId") REFERENCES "medications"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pharmacy_orders" ADD CONSTRAINT "pharmacy_orders_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pharmacy_orders" ADD CONSTRAINT "pharmacy_orders_prescriptionId_fkey" FOREIGN KEY ("prescriptionId") REFERENCES "prescriptions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pharmacy_orders" ADD CONSTRAINT "pharmacy_orders_pharmacyId_fkey" FOREIGN KEY ("pharmacyId") REFERENCES "pharmacies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pharmacy_webhook_logs" ADD CONSTRAINT "pharmacy_webhook_logs_pharmacyId_fkey" FOREIGN KEY ("pharmacyId") REFERENCES "pharmacies"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "chat_threads" ADD CONSTRAINT "chat_threads_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "chat_threads" ADD CONSTRAINT "chat_threads_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES "patients"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "chat_threads" ADD CONSTRAINT "chat_threads_providerId_fkey" FOREIGN KEY ("providerId") REFERENCES "provider_profiles"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "chat_messages" ADD CONSTRAINT "chat_messages_threadId_fkey" FOREIGN KEY ("threadId") REFERENCES "chat_threads"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "chat_messages" ADD CONSTRAINT "chat_messages_authorUserId_fkey" FOREIGN KEY ("authorUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "chat_attachments" ADD CONSTRAINT "chat_attachments_messageId_fkey" FOREIGN KEY ("messageId") REFERENCES "chat_messages"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES "patients"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_prescriptionId_fkey" FOREIGN KEY ("prescriptionId") REFERENCES "prescriptions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoice_lines" ADD CONSTRAINT "invoice_lines_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "invoices"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoice_lines" ADD CONSTRAINT "invoice_lines_medicationId_fkey" FOREIGN KEY ("medicationId") REFERENCES "medications"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "invoices"("id") ON DELETE CASCADE ON UPDATE CASCADE;
