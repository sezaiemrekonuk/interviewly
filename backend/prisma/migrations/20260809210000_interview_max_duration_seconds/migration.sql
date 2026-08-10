-- S08: the candidate's chosen voice length. Nullable and with no default — null means "no
-- choice was made", which is what leaves `VOICE_MAX_INTERVIEW_SECONDS` as the ceiling. A
-- default here would erase that distinction and pin every future row to today's config value.
--
-- A nullable column addition is what ADR-F02's migration protocol allows a feature ledger; the
-- upper bound is deliberately NOT a CHECK, because it is `VOICE_MAX_INTERVIEW_SECONDS` — config,
-- which a table constraint would freeze at the value it happened to hold on the day this ran.
-- setup.ts refuses above it (never clamps); the positive floor below is the part that is a real
-- invariant of the column whatever the config says.
ALTER TABLE "interviews" ADD COLUMN "max_duration_seconds" INTEGER;

-- No NOT VALID dance: every existing row is NULL, so the scan is free and the constraint can be
-- born valid.
ALTER TABLE "interviews"
  ADD CONSTRAINT "interviews_max_duration_seconds_positive"
  CHECK ("max_duration_seconds" IS NULL OR "max_duration_seconds" > 0);
