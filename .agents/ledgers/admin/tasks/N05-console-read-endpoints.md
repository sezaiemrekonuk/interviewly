# N05 — The console's remaining read endpoints and per-model spend
REPO: (this repo) · Depends: N01, N02, N03, N04 · Status: done
Read first: STATE.md, REFERENCE.md, then this.
**Model: claude-sonnet-4.6** — five bounded reads and one aggregation, no new trust boundary. Every route mounts on the `requireAuth` → `requireAdmin` router N01 authored and hardened on opus, and every query is a cursor page over a table that was already being written. Same rule of thumb as N02 and N04: if a grouping edge case bites, code-review the diff with `claude-opus-4.8` rather than running the task expensive.

## Goal
Owner's ask:

> "The console has sections with nothing behind them. Model calls, users, sessions, the audit
> trail, the queue — all of those tables are already being written and read by nothing. And
> the cost panel cannot print a platform total, or say which model the money went to."
> — admin ledger backlog promotion (US-26; issue 095 queue observability; issue 86 `audit_logs`)

Five new read endpoints plus two additive fields on `/admin/stats`. Every one is a cursor page
over an existing table, mounted on the existing gate, writing an audit row for the read. No
new table, no migration, no write path — `POST /admin/interviews/:id/report/requeue`
(issue 081) is still the only route on this router that changes anything.

## Non-negotiables
- **Every route mounts on the existing router** and inherits `requireAuth` → `requireAdmin`
  from `router.use` (ADR-N01). No per-handler role check.
- **Every read is cursor-paged** with `modules/interview/cursor.ts`'s `encodeCursor` /
  `decodeCursor` / `pageLimit` — the same helpers both N01 lists use. No offset paging.
- **Every read writes an audit row.** Including `GET /admin/audit` itself: an audit surface
  readable without leaving a trace is the one an attacker uses to find out what was noticed.
- **`/admin/users` projects no secret.** No `password_hash`, no `google_sub`, no session
  token. `email_lower` is the one identifier that comes back.
- **No metric is invented.** `llm_calls` has no success/failure column, so no error rate is
  derivable and none is returned; `fellBackFrom` is the failure signal that does exist.
- **The K11 response fields on `/admin/stats` are unchanged.** Issue 85's byte-identical
  criterion holds — `totalCostUsd` and `perModel[]` are additions, nothing is re-shaped.
- **Aggregation happens in Postgres**, not in Node. `groupBy` with `_sum`/`_avg`, not a
  `findMany` reduced in memory.
- **Nothing throws on a hostile query string** — the N04 rule, now across four more parsers.

## Context (anchors)
- `backend/modules/admin/llm-calls.ts` — **create.** `GET /admin/llm-calls`, filters
  `provider`/`model`/`interviewId`, plus a `facets` array (`groupBy` provider+model, counted,
  **unfiltered**) so the console offers a filter vocabulary that will match something. Order
  `[{ created_at: 'desc' }, { id: 'desc' }]`.
- `backend/modules/admin/users.ts` — **create.** `GET /admin/users`, filters `role`/`q`.
  `_count: { select: { interviews: true } }` with deleted rows counted (K11).
- `backend/modules/admin/sessions.ts` — **create.** `GET /admin/sessions` over the AUTH
  `sessions` table, filters `userId`/`active`. `sessionFilters(query, now)` takes the instant
  as an argument so it is testable; `now` is `clock.now()` (:F03).
- `backend/modules/admin/audit-log.ts` — **create.** `GET /admin/audit`, filters
  `action`/`actorUserId`/`subjectId`, plus an `actions` facet counted from the data.
- `backend/modules/admin/queue.ts` — **create.** `GET /admin/queue`, BullMQ counts for the
  `report` queue (`src/lib/queue.ts`) plus a 20-row dead-letter sample from `getFailed`.
- `backend/modules/admin/stats.ts` (:N02) — add `totalCostUsd` and `perModel[]`.
- `backend/modules/admin/router.ts` (:N01) — mount all five. None takes `adminStatsLimiter`:
  what made `/stats` expensive was aggregating the whole `interviews` table.
- `backend/src/lib/audit.ts` — `admin.llm_calls_read`, `admin.users_read`,
  `admin.sessions_read`, `admin.audit_read`, `admin.queue_read`.

  **The trap:** `created_at desc` alone is not a total order on `llm_calls` — calls inside one
  turn share a millisecond often enough to matter — and a cursor over a non-total order
  repeats or skips rows between pages. `id desc` is the tie-break, and every list here takes
  it. The second trap is the `actions` facet: hardcoding a copy of the `AuditAction` union
  gives the console a vocabulary that drifts from the data the moment an action is added, so
  it is counted from the rows.

## Steps
- [x] **1. `GET /admin/llm-calls`** — `llmCallFilters`, cursor page, `facets` from an
  unfiltered `groupBy(['provider','model'])`, audit row `admin.llm_calls_read`.
- [x] **2. `GET /admin/users`** — `userFilters` (`role` against the two real values, `q`
  lowercased because `email_lower` is what is stored), interview count with deleted included,
  audit row `admin.users_read`.
- [x] **3. `GET /admin/sessions`** — `sessionFilters(query, now)`, `active` computed
  server-side against `clock.now()`, audit row `admin.sessions_read`.
- [x] **4. `GET /admin/audit`** — `auditFilters`, `actions` facet counted from the data, audit
  row `admin.audit_read`.
- [x] **5. `GET /admin/queue`** — `getJobCounts` for the `report` queue + `getFailed(0, 19)`,
  audit row `admin.queue_read`.
- [x] **6. `/admin/stats` gains `totalCostUsd` + `perModel[]`** — `groupBy(['provider','model'])`
  with `_sum` cost/tokens, `_avg` latency, `_count`. Summed from `llm_calls`, not from
  `interviews.spent_usd`.
- [x] **7. Mount all five** on the admin router; add the five actions to `AuditAction`.
- [x] **8. Tests** — `modules/admin/filters.test.ts`, 6 cases across the four parsers,
  including the hostile-query-string case (repeated and structured params on all four).
- [x] **9. Run the Verification commands.**

## Definition of done
- `GET /admin/llm-calls`, `/admin/users`, `/admin/sessions`, `/admin/audit`, `/admin/queue`
  all return `200` to an admin and `403 FORBIDDEN` to anyone else, with no per-handler check.
- Every one writes exactly one audit row per request, with the applied filters in `metadata`
  where a filter exists.
- `llm-calls` orders by `created_at desc, id desc` and returns a provider+model `facets` array;
  no error rate is returned.
- `/admin/users` returns no `password_hash`, no `google_sub`, no token, and counts deleted
  interviews.
- `/admin/sessions` computes `active` on the server against `clock.now()`.
- `/admin/audit`'s `actions` facet is counted from the rows, not from the `AuditAction` union.
- `/admin/queue` reports the `report` queue's counts plus ≤20 dead-letter rows whose `id` is
  the interview id (R01's `jobId = interviewId`).
- `/admin/stats` gains `totalCostUsd` and `perModel[]`; every K11 field it already returned is
  byte-identical (issue 85).
- Four parsers, no throw on a repeated or structured query param.

## Verification
```bash
npm test -- --run backend/modules/admin
npm run typecheck
```

Expected: all `backend/modules/admin` test files pass, typecheck silent.

Regression check — `@AC-18` asserts the K11 stats fields, which are additive here:
```bash
npm run test:acceptance -- --tags "@admin-cost"
```

## Notes

Done 2026-08-11. `npm test -- --run backend/modules/admin` → `5 files / 27 tests` green;
`npm run typecheck` clean. Commits `d410564` (five endpoints) and `6a2604c` (per-model spend).

**What exists now**
- `modules/admin/llm-calls.ts`, `users.ts`, `sessions.ts`, `audit-log.ts`, `queue.ts`; five
  exported parsers (`llmCallFilters`, `userFilters`, `sessionFilters`, `auditFilters`) plus
  the handlers.
- `AuditAction` +5 read actions. The union is now 13 values and still no migration.
- `stats.ts` → `totalCostUsd` + `perModel[]`, and a local `usd()` helper: a null `_sum` is a
  table with no rows, which is `0.000000`, not `null`.

**Deviations from the plan**
- **One queue, not all of them.** Generation and scoring run inline on the request, and the
  mail producer sits behind `auth/mail-queue.ts`, an interface the acceptance ring swaps out
   — there is no BullMQ handle to count. Listing a queue that cannot be counted would be worse
  than listing the one that can.
- **`facets` only on `llm-calls` and `audit`.** Those are the two lists where the caller cannot
  know the vocabulary; `role` has two values and `state` has nine, both already known.
- **`sessions` means auth sessions** (ADR-N07). The console section was sketched around voice
  sessions and ADR-S01 deleted that table with the ElevenLabs agent.

**How things were queried**
- `perModel`: one `groupBy(['provider','model'])` in Postgres. The result set is providers ×
  models — a handful of rows — which is why it can be unbounded where the two full scans issue
  85 removed could not.
- `averageLatencyMs` is `Math.round`ed: a mean carrying six decimals reads as a measurement.
- Voice rolls into the same `totalCostUsd` on purpose. A per-second row and a per-token row
  are both money; splitting them into two currencies leaves no figure that answers "what did
  this cost". `unitKind` on the N04 drill-down is where the two split.

**Not done, deliberately**
- No `@AC` scenario maps any of these five endpoints, same as N04. The unit tests on the
  parsers are the gate; the handlers' Prisma paths are covered only by typecheck.
- **`npm run test:acceptance` was NOT run this session** (it needs the compose stack up).
  `@AC-18` asserts the K11 stats keys are present, and `totalCostUsd`/`perModel` are additions
  next to them — read from the feature file, not proven by a run. Run it before the PR.
- `stats.integration.test.ts` was not extended for `perModel` — it needs a live Postgres.
- No error rate on `llm-calls`: the column does not exist, and deriving one from
  `fell_back_from` would count a successful fallback as a failure.

**For a future task**
The `llm_calls(interview_id, created_at)` composite index stays in the STATE backlog. N04's
drill-down and this task's `?interviewId=` filter both hit `@@index([interview_id])` and then
sort — promote it if either gets slow, as a safe additive migration rebased on F02.
