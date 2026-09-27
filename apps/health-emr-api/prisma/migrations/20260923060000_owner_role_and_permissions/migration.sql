-- The platform's proprietor, and the grants they hand out.
--
-- OWNER is a superset of SUPER_ADMIN rather than a replacement: the roles guard
-- accepts an owner wherever a super admin is accepted, so promoting somebody
-- never takes access away while the new powers are being added.
ALTER TYPE "Role" ADD VALUE IF NOT EXISTS 'OWNER' BEFORE 'SUPER_ADMIN';

DO $$ BEGIN
  CREATE TYPE "PlatformPermission" AS ENUM (
    'ACCOUNTS_ARCHIVE',
    'ACCOUNTS_DELETE',
    'WEBHOOKS_MANAGE',
    'CATALOGUE_MANAGE',
    'BREAK_THE_GLASS',
    'ONBOARDING_DECIDE'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

ALTER TABLE "users"
  ADD COLUMN IF NOT EXISTS "permissions" "PlatformPermission"[] NOT NULL DEFAULT ARRAY[]::"PlatformPermission"[];
