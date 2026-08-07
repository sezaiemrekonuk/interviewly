-- Issue #98: `target_question_count` sizes the one provider call that generates a round, so an
-- unbounded value is an authenticated cost-amplification path. The bound lives in Zod
-- (modules/interview/setup.ts) and here, because a Zod schema is not an invariant of the table.
-- Prisma cannot express CHECK constraints, hence the raw statements.

-- NOT VALID, deliberately. A plain ADD CONSTRAINT … CHECK scans every existing row while
-- holding ACCESS EXCLUSIVE, and fails the whole deploy if one row predates the bound — the
-- issue's own proof created a 10000-question interview before deleting it, and no deployed
-- database is guaranteed to be free of its siblings. NOT VALID records the constraint without
-- the scan; it is enforced on every INSERT and UPDATE from this statement onward, which is the
-- half that closes the amplification. What it skips is only the retroactive proof about rows
-- that already exist.
ALTER TABLE "interviews"
  ADD CONSTRAINT "interviews_target_question_count_range"
  CHECK ("target_question_count" >= 1 AND "target_question_count" <= 20) NOT VALID;

-- …then earn the VALID mark where it is free. On a database with no legacy rows — CI, and any
-- deployment that never saw the unbounded endpoint — this validates immediately and the
-- constraint ends up indistinguishable from one added the ordinary way. VALIDATE takes only
-- SHARE UPDATE EXCLUSIVE, so its scan does not block reads or writes.
--
-- Where legacy rows do exist the deploy must not die and must not quietly rewrite them either:
-- what to do with an interview whose shape was never askable (`generateRound` requires the
-- batch length to match the count exactly, so its first generation could only ever have
-- failed) is an operator's decision about someone's data, not a migration's. So it warns,
-- names the count, and leaves the constraint NOT VALID — still enforcing every new write.
DO $$
DECLARE
  offending bigint;
BEGIN
  SELECT count(*) INTO offending
    FROM "interviews"
   WHERE "target_question_count" < 1 OR "target_question_count" > 20;

  IF offending = 0 THEN
    ALTER TABLE "interviews" VALIDATE CONSTRAINT "interviews_target_question_count_range";
  ELSE
    RAISE WARNING
      'interviews_target_question_count_range left NOT VALID: % row(s) predate the bound (issue #98). New writes are already refused. Remediate those rows, then run: ALTER TABLE "interviews" VALIDATE CONSTRAINT "interviews_target_question_count_range";',
      offending;
  END IF;
END $$;
