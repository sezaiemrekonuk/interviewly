-- I16: the room's clock measures time *in the room*, not time since the interview began.
--
-- `elapsed_seconds` is time banked by room sessions that have closed; `last_seen_at` anchors the
-- one that is still open. Active time is the sum, and it is what the room renders and what
-- `isPastSpeechCeiling` refuses on. `started_at` is untouched and still means what it always did
-- — the history list and the report date read it.
--
-- Both are additive per ADR-F02's migration protocol. `elapsed_seconds` takes a default rather
-- than being nullable because zero is the honest answer for every existing row: they were
-- measured against wall clock, and there is no banked figure to backfill. `last_seen_at` is
-- nullable because "no room session has opened yet" is a real state — the first heartbeat banks
-- nothing and only sets the anchor.
ALTER TABLE "interviews" ADD COLUMN "elapsed_seconds" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "interviews" ADD COLUMN "last_seen_at" TIMESTAMP(3);

-- Every existing row is 0, so the scan is free and the constraint is born valid. Time does not
-- run backwards: a negative bank would hand a candidate an interview that never expires.
ALTER TABLE "interviews"
  ADD CONSTRAINT "interviews_elapsed_seconds_non_negative"
  CHECK ("elapsed_seconds" >= 0);
