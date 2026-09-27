-- Deleting clinical records, and recording a withdrawal properly.
--
-- Three additive changes, no backfill and no default that grants anything:
-- an existing super admin holds exactly what they held yesterday, and an owner
-- has to hand the new grant over deliberately. That is the point of it being
-- separate from ACCOUNTS_DELETE — permission to erase a client account is not
-- permission to erase a visit.

-- The grant itself.
ALTER TYPE "PlatformPermission" ADD VALUE IF NOT EXISTS 'RECORDS_DELETE';

-- A withdrawn prescription could say when, but not why or on whose decision.
-- A visit has carried all three since it gained voidedAt; a prescription is
-- the more consequential record of the two and carried the least.
--
-- Plain columns, no foreign key — matching prescription_requests. Attribution
-- on a retained medical record must not gain a reference that a later account
-- deletion can follow and blank.
ALTER TABLE "prescriptions" ADD COLUMN IF NOT EXISTS "voidedReason" TEXT;
ALTER TABLE "prescriptions" ADD COLUMN IF NOT EXISTS "voidedByUserId" UUID;

-- Archiving a staff account recorded only isActive: a boolean that says a
-- login is refused and nothing about when it was withdrawn, why, or who
-- decided. A staff account referenced by a clinical record can never be
-- erased, so archiving is the whole of what can happen to it — and it was the
-- one account state the console could not explain afterwards.
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "archivedAt" TIMESTAMPTZ(6);
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "archivedReason" TEXT;
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "archivedByUserId" UUID;
