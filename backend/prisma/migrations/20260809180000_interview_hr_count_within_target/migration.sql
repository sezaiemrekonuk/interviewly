-- Issue #176: `split()` floors the HR half at 2, so a target of 1 produced `hr 2 / tech -1` —
-- a row that contradicts itself, and a negative round size that `generation.ts` then asks the
-- provider for. The bound now lives in Zod (modules/interview/setup.ts, min 2) and here,
-- because a Zod schema is not an invariant of the table. Prisma cannot express CHECK
-- constraints, hence the raw statements.
--
-- This is the companion #98 wanted and could not add: it relates the two columns rather than
-- bounding either alone, so `target_question_count`'s own 1..20 range is left exactly as #98
-- wrote it. That matters — `src/lib/db.ts`'s self-check probe inserts `target 1 / hr 1`
-- directly, which this constraint accepts (1 <= 1) and a raised lower bound on the target
-- would have broken.

-- NOT VALID, for the reason #98's migration sets out: a plain ADD CONSTRAINT … CHECK scans
-- every existing row under ACCESS EXCLUSIVE and fails the deploy if one row predates the
-- bound. Any interview created through the endpoint before this fix with `targetQuestionCount:
-- 1` is exactly such a row. NOT VALID records the constraint without the scan and enforces it
-- on every INSERT and UPDATE from here on, which is the half that closes the defect.
ALTER TABLE "interviews"
  ADD CONSTRAINT "interviews_hr_question_count_range"
  CHECK ("hr_question_count" >= 0 AND "hr_question_count" <= "target_question_count") NOT VALID;

-- …then earn the VALID mark where it is free. On a database with no legacy rows — CI, and any
-- deployment that never saw a target of 1 — this validates immediately and the constraint ends
-- up indistinguishable from one added the ordinary way. VALIDATE takes only SHARE UPDATE
-- EXCLUSIVE, so its scan blocks neither reads nor writes.
--
-- Where offending rows do exist the deploy must not die and must not quietly rewrite them
-- either: such an interview generated more HR questions than its target allows and its
-- technical round was asked for a negative count, so what to do with it is an operator's
-- decision about someone's data, not a migration's. It warns, names the count, and leaves the
-- constraint NOT VALID — still refusing every new write.
DO $$
DECLARE
  offending bigint;
BEGIN
  SELECT count(*) INTO offending
    FROM "interviews"
   WHERE "hr_question_count" < 0 OR "hr_question_count" > "target_question_count";

  IF offending = 0 THEN
    ALTER TABLE "interviews" VALIDATE CONSTRAINT "interviews_hr_question_count_range";
  ELSE
    RAISE WARNING
      'interviews_hr_question_count_range left NOT VALID: % row(s) predate the bound (issue #176). New writes are already refused. Remediate those rows, then run: ALTER TABLE "interviews" VALIDATE CONSTRAINT "interviews_hr_question_count_range";',
      offending;
  END IF;
END $$;
