-- The admin console grew five read endpoints (N04/N05), and two of them order by a column
-- nothing indexed. Additive and net-neutral: one index is replaced by a superset, one is new.
--
-- Deliberately NOT added, so the list is a decision rather than an omission:
-- `users(created_at)` and `sessions(created_at)`. Both new list endpoints order by it, but
-- `users` is small and `sessions` is written on every sign-in — an index there charges every
-- login for a page an operator opens occasionally. Promote them when either table is large
-- enough for the sort to show up, not before.

-- `llm_calls(interview_id)` was a strict PREFIX of this, so the composite serves every query
-- the old index served and the new ones it did not: the drill-down's
-- `WHERE interview_id = ? ORDER BY created_at ASC` (N04) and `/admin/llm-calls?interviewId=`
-- (N05) both read the order straight off the index instead of sorting the result.
--
-- Dropped rather than kept alongside: `llm_calls` is written on every provider call, which
-- makes it the hottest insert path in the schema, and a redundant prefix index charges that
-- path for nothing. Net index count on the table is unchanged.
DROP INDEX "llm_calls_interview_id_idx";
CREATE INDEX "llm_calls_interview_id_created_at_idx" ON "llm_calls" ("interview_id", "created_at");

-- `/admin/audit`'s default view is the whole trail, newest first, and neither existing index
-- leads with `created_at` — so the unfiltered page was a sequential scan plus a sort. This is
-- also the fastest-growing table on the admin surface: reading the audit trail is itself
-- audited, so every visit to the page adds a row to what the next visit must sort.
CREATE INDEX "audit_logs_created_at_idx" ON "audit_logs" ("created_at");
