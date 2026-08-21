# backend

Express + Prisma/Postgres, with Redis for pub/sub and BullMQ. Routers are mounted in
`src/app.ts` — start there to find a handler. Root notes: [../AGENTS.md](../AGENTS.md).

---

## The interview state machine

`modules/interview/machine.ts` — **`applyTransition` is the only legal way to change
`interviews.state`.** Two things about it are load-bearing and are not obvious from reading it:

- The **WHERE-guarded `updateMany` is a concurrency guard**, not a convenience. It is what stops
  two concurrent requests both claiming `profiling → hr_round` and generating two question
  batches. Do not relax the WHERE clause, and do not move work that must happen once outside it.
- It is also the only thing that **publishes** the state change to the room's SSE channel. If you
  add a code path that produces something the client must refetch, publish it yourself *after*
  the transaction commits — an event for rolled-back rows sends the room to refetch an empty
  state it is already showing. See `INTERVIEW_QUESTIONS_READY` in `generation.ts` for the shape.

Terminal states are derived — "no outgoing edge in `TRANSITIONS`" — not listed. Adding an end
state therefore gets `ended_at` stamped for free.

## Data rules

- **Soft delete only.** Every FK is `ON DELETE RESTRICT`; a hard delete will fail at the
  database. Exclude `deleted_at` in reads — including in joins, where it is easy to forget.
- **Cursor pagination, never offset.** `modules/interview/cursor.ts`. Order by a unique tiebreak
  as well as the sort column, or a page seam repeats a row.
- **Ownership is a WHERE clause, not a filter in JS.** Every `/me/*` and `/interviews/:id` read
  scopes to `req.user.id` at the query level. This is the security boundary.
- `users.profile` is free-form JSON and `GET /me/profile` returns it **verbatim** — including
  `cv_text`, the whole extracted CV, which the frontend type does not declare. Be deliberate
  about what you put in there.

## Two fields that lie

- **`answers.scores` is usually `null`.** `promoteNextQuestion` (`modules/interview/adaptive.ts`)
  returns early when the next question has no pre-generated candidates, which is every interview
  today. The dependable per-question grade is `report_questions` (score, reason, star_adherence).
  A feature built on the four-axis breakdown will be empty for most users.
- **`ended_reason='cut_short'` is never written by any path**, so `/admin/stats.cutShort` is
  structurally 0.

## Request rules

- **State-changing `/interviews/*` routes require `Origin`/`Referer` === `PUBLIC_ORIGIN`**
  (`modules/interview/csrf.ts`). A new mutating route under that prefix needs it too; a curl that
  omits the header will be refused, which is correct rather than broken.
- `POST /auth/password-reset/request` answers **202 either way**. It must never disclose whether
  an address is registered — do not "improve" it into a useful error.
- Webhook routes authenticate by HMAC signature plus a single-use nonce, not by session.
- `/test/*` mounts only under `NODE_ENV=test`.

## Environment

`src/env.ts` calls `process.exit(1)` on a missing required var, so a bare `npx vitest` dies
before any test runs. Use the root `npm test`, which passes `--env-file-if-exists=.env`.

`.env` hostnames (`db`, `cache`) are compose-internal and do not resolve on a laptop — see the
root file for how to run the integration and acceptance suites.

## Read replica (admin console only)

`docker compose -f compose.yaml -f compose.replica.yaml up -d` adds `db-replica`, a real
streaming-replication standby of `db` — opt-in, same pattern as `compose.observability.yaml`.
It sets `DATABASE_REPLICA_URL` on `api`, which is all `src/lib/read-replica.ts` needs to start
routing: **every `backend/modules/admin/*` read** (stats, costs, llm-calls, users, sessions,
audit, interview-detail, interviews list) goes through `adminRead()`, which runs against the
replica and falls back to the primary — silently, with a warning log — on any replica error.
Every write, and every read outside `modules/admin`, stays on the primary; nothing else in the
app knows the replica exists.

Two response headers carry the staleness contract every admin handler owes its caller:
`X-Read-Source: primary|replica` always, `X-Replica-Lag-Seconds` only when the read actually
came from the replica and a lag figure was obtainable (`pg_last_xact_replay_timestamp()`,
cached ~2s so it isn't a query-per-request tax).

Without `DATABASE_REPLICA_URL` set — the default everywhere, including production until
someone opts in — `adminRead()` is a no-op wrapper around the primary `prisma` singleton.

Proof this actually replicates, not just that the code compiles: `ci/verify-read-replica.sh`
boots `db` + `db-replica`, writes a marker row on the primary, polls the replica for it, checks
`pg_is_in_recovery()`, then kills `db-replica` and confirms the primary is unaffected. The
routing/failover logic itself (no live database needed) is `backend/src/lib/read-replica.test.ts`,
part of the normal `npm test` run.
