-- A licence a clinician added for themselves, not yet checked by the platform.
--
-- Routing requires ACTIVE, so this value is unroutable by construction: adding
-- it needs no change to the routing gate, and a clinician cannot grant
-- themselves prescribing rights in a new state by typing a licence number in.
ALTER TYPE "LicenseStatus" ADD VALUE IF NOT EXISTS 'PENDING' BEFORE 'ACTIVE';
