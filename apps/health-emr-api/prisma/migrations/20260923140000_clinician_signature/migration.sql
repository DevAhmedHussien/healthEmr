-- The clinician's handwritten signature.
--
-- Held encrypted on the profile, drawn once, and snapshotted onto each
-- prescription at signing — frozen for the same reason the licence is, because
-- a clinician who later redraws their signature has not changed what they put
-- on a prescription last March.
ALTER TABLE "provider_profiles"
  ADD COLUMN IF NOT EXISTS "signatureImage" TEXT,
  ADD COLUMN IF NOT EXISTS "signatureName" VARCHAR(200),
  ADD COLUMN IF NOT EXISTS "signatureCapturedAt" TIMESTAMPTZ(6);

-- Replaced by the column above. It held an object-storage key, was never
-- written by anything, and having two places a signature might live is how one
-- of them ends up authoritative by accident.
ALTER TABLE "provider_profiles" DROP COLUMN IF EXISTS "signatureImageKey";

ALTER TABLE "prescriptions"
  ADD COLUMN IF NOT EXISTS "signatureSnapshot" TEXT,
  ADD COLUMN IF NOT EXISTS "signatureNameSnapshot" VARCHAR(200);
