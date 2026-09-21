-- Medical record numbers came from `count(*) + 1`. That is wrong in two ways
-- that both bite in production: deleting any patient makes the next number
-- collide with an existing one, and two concurrent intakes read the same count
-- and claim the same MRN. A sequence is monotonic, gap-tolerant and atomic.
--
-- Starts above the highest number already issued, so nothing is ever reused.
CREATE SEQUENCE IF NOT EXISTS patient_mrn_seq AS BIGINT START WITH 1;

SELECT setval(
  'patient_mrn_seq',
  GREATEST(
    (SELECT COALESCE(MAX(NULLIF(regexp_replace("mrn", '\D', '', 'g'), '')::BIGINT), 0) FROM "patients"),
    1
  )
);
