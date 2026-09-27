-- Nobody loses anything the day this ships.
--
-- Every existing super admin is granted the permissions covering what they
-- could already do. ACCOUNTS_DELETE is deliberately not among them: permanent
-- deletion is a new capability, and it should be an owner's decision to hand
-- out rather than something that appears in everyone's hands because a
-- migration ran.
UPDATE "users"
SET "permissions" = ARRAY[
      'ACCOUNTS_ARCHIVE',
      'WEBHOOKS_MANAGE',
      'CATALOGUE_MANAGE',
      'BREAK_THE_GLASS',
      'ONBOARDING_DECIDE'
    ]::"PlatformPermission"[]
WHERE "role" = 'SUPER_ADMIN' AND cardinality("permissions") = 0;

-- The account already named "Platform Owner" becomes one. OWNER is a superset
-- of SUPER_ADMIN, so this grants access and never removes it.
UPDATE "users" SET "role" = 'OWNER'
WHERE "email" = 'super@healthemr.test' AND "role" = 'SUPER_ADMIN';
