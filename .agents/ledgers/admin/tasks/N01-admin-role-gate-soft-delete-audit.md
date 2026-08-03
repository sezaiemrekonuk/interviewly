# N01 — Admin-role gate + soft-delete audit path: `requireAdmin`, `GET /admin/interviews`, `DELETE /interviews/:id`, `GET /me/interviews`
REPO: (this repo) · Depends: F01, F02, F03, A01, A02, I03, I06, I08 · Status: done
Read first: STATE.md, REFERENCE.md, then this.
**Model: claude-opus-4.8** — admin-role trust boundary + soft-delete-audit correctness. A deleted row leaking into a user list, or an open `/admin/*` surface, is a 5-point security regression; a cheaper model has produced role checks that pass `req.user` through without asserting the role, and soft deletes that hard-delete under a rename.

## Goal
Owner's ask:

> "The `requireAdmin` role gate on top of `requireAuth`, `GET /admin/interviews` listing all
> interviews including soft-deleted ones with a `deleted` flag, token total and USD cost, the
> `DELETE /interviews/:id` soft delete, and `GET /me/interviews` that excludes deleted rows.
> A candidate's deleted interview must disappear from their list but stay visible and
> cost-intact to an admin. Scenario AC-17 in `admin_cost.feature` must be green."
> — admin ledger task decomposition (backend spec *Admin module* + *Interview module*, K11, K13)

This task creates `backend/modules/admin/` (the router, the `requireAdmin` middleware, the
`GET /admin/interviews` audit list) and adds two user-facing interview routes interview-core
delegated here (`DELETE /interviews/:id`, `GET /me/interviews`). It does **not** build
`GET /admin/stats` (N02 owns that) and it does **not** implement the admin-must-use-password
rule — `admin_auth.feature` is auth A02's (ADR-N04). After this task, N02 can add the stats
endpoint behind the same `requireAdmin` gate this task hardens.

## Security boundaries
- **`/admin/*` is reachable only by `requireAuth` → `requireAdmin`.** `requireAdmin` reads
  `req.user.role` (set by A01's `requireAuth`) and returns `403 FORBIDDEN` unless it is
  exactly `'admin'`. Mount it once on the admin router, not per handler (ADR-N01). A missing
  gate on any `/admin/*` route is a trust-boundary breach.
- **A deleted interview must never appear in `GET /me/interviews`.** That list goes through
  `userInterviews(req.user.id)` (F02 helper, `deleted_at IS NULL` baked in). Never call
  `prisma.interview.findMany` for a user-facing list.
- **A deleted interview must always appear in `GET /admin/interviews`** with `deleted: true`.
  The admin list bypasses the helper deliberately (ADR-N02) — a direct
  `prisma.interview.findMany` with no `deleted_at` filter, carrying the `ADMIN AUDIT` comment.
  This is the only sanctioned direct `findMany`.
- **A non-owner deleting an interview gets `404 INTERVIEW_NOT_FOUND`, never 403** — reuse
  I03's ownership resolver (existence is not leaked, ADR-I11). Do not build a second resolver.
- **Soft delete is `UPDATE deleted_at = now()`, never a hard `DELETE`** (db spec §1). The cost
  (`spent_usd`) and the `llm_calls` rows are untouched, so the admin audit reads them back
  unchanged — the "its cost is unchanged" assertion in @AC-17.
- **No per-user cost breakdown, token value, or PII in any log line.** `interviewId` +
  `traceId` are the K6 keys.

## Context (anchors)
- `backend/modules/admin/middleware.ts` — **create.** `requireAdmin(req, res, next)`: if
  `req.user?.role === 'admin'` → `next()`, else `403 FORBIDDEN`. Assumes `requireAuth` already
  ran (it is always mounted after it). Export it for N02 to reuse.
- `backend/modules/admin/router.ts` — **create.** Express router mounted at `/admin` from
  `app.ts`, wrapped as `router.use(requireAuth, requireAdmin)` so every route inherits the
  gate. Mount `GET /interviews` here. Leave a marked comment slot:
  `// N02 mounts GET /stats below this line — do not remove`.
- `backend/modules/admin/interviews.ts` — **create.** `GET /admin/interviews`: a direct
  `prisma.interview.findMany` (no `deleted_at` filter — the `ADMIN AUDIT` comment), cursor
  paginated, each item `{ id, userId, state, deleted, occupation, occupationCluster,
  totalTokens, costUsd }`. `deleted = interview.deleted_at !== null`; `totalTokens` = Σ
  `input_tokens + output_tokens` over the interview's `llm_calls`; `costUsd` = `spent_usd`
  (six-decimal string). See REFERENCE.md "`GET /admin/interviews` item shape".
- `backend/modules/interview/delete.ts` — **create.** `DELETE /interviews/:id` handler:
  `prisma.interview.update({ where: { id: req.interview.id }, data: { deleted_at: new Date() } })`,
  `logger.info({ interviewId, userId, traceId }, 'INTERVIEW_SOFT_DELETED')`, return `204`.
  Ownership is already resolved by I03's `:id` param middleware (`req.interview` set; non-owner
  never reaches here — 404).
- `backend/modules/interview/my-interviews.ts` — **create.** `GET /me/interviews` handler:
  `userInterviews(req.user.id)` (deleted excluded), cursor paginated, return
  `{ items, nextCursor }`.
- `backend/modules/interview/router.ts` (:I03) — mount `DELETE /interviews/:id` behind the
  existing `:id` ownership resolver **and** the existing CSRF middleware (`requirePublicOrigin`,
  it is a state-changing route). The I03 router already wires the `:id` resolver as param
  middleware — the DELETE handler inherits it.
- `backend/src/app.ts` (:A01) — mount the admin router (`app.use('/admin', adminRouter)`) and
  the `GET /me/interviews` route (`app.get('/me/interviews', requireAuth, listMyInterviews)`).
  Confirm the global error handler maps `FORBIDDEN` → 403 and `INTERVIEW_NOT_FOUND` → 404.
- `backend/src/lib/db.ts` (:F02) — `prisma`, `userInterviews`, `activeInterview`. Use
  `userInterviews` for `/me/interviews`; use `prisma.interview.findMany` ONLY in the admin list.
- `backend/src/lib/error-codes.ts` (:F01) — `FORBIDDEN`, `INTERVIEW_NOT_FOUND`,
  `UNAUTHENTICATED` are all present. No new codes.

  **The trap:** the same request cycle in @AC-17 exercises **both** filter directions — the
  owner's `GET /me/interviews` must EXCLUDE the deleted interview (via `userInterviews`) while
  the admin's `GET /admin/interviews` must INCLUDE it (via the bypass). Wire each list to its
  own path; do not share one query with a conditional flag (that is the exact leak ADR-N02
  rejects).

## Steps
- [x] **1. Confirm dependency artefacts exist** — `requireAuth` + `app.ts` mount point +
  error handler (A01); `userInterviews`/`activeInterview`/`prisma` (F02); I03's
  `modules/interview/router.ts`, `ownership.ts` (`:id` resolver), `csrf.ts`; a seeded
  `role=admin` user (F02 seed); interview + answer + `llm_calls` rows reachable (I06/I08/I02).
  If any is missing, set this task to `blocked` in STATE.md and stop.
- [x] **2. Create `modules/admin/middleware.ts`** — `requireAdmin`; `403 FORBIDDEN` unless
  `req.user.role === 'admin'`. Export it.
- [x] **3. Create `modules/admin/interviews.ts`** — `GET /admin/interviews`: direct
  `prisma.interview.findMany` (ADMIN AUDIT comment, no `deleted_at` filter), cursor page, map to
  the item shape, compute `totalTokens` and `deleted`, read `costUsd` from `spent_usd`.
  Log `ADMIN_INTERVIEWS_LISTED` ({ traceId, count }).
- [x] **4. Create `modules/admin/router.ts`** — `router.use(requireAuth, requireAdmin)`, mount
  `GET /interviews`, leave the N02 `/stats` slot comment.
- [x] **5. Create `modules/interview/delete.ts`** — soft-delete handler; `204`; log
  `INTERVIEW_SOFT_DELETED`.
- [x] **6. Create `modules/interview/my-interviews.ts`** — `GET /me/interviews` via
  `userInterviews`, cursor page.
- [x] **7. Mount routes** — admin router + `GET /me/interviews` in `app.ts`; `DELETE
  /interviews/:id` on I03's interview router behind the `:id` ownership resolver and CSRF
  middleware. Confirm the error handler maps `FORBIDDEN`/`INTERVIEW_NOT_FOUND`.
- [x] **8. Tests — negative and positive cases.** Wire the Cucumber step definitions for
  `admin_cost.feature` @AC-17. The step "a candidate owns an interview with recorded cost"
  seeds an interview with `llm_calls`/`spent_usd` (fixture, direct DB). The negative case is
  the non-owner delete → `404 INTERVIEW_NOT_FOUND` and the interview STILL present in the
  owner's list; the positive case is the owner delete → `204`, absent from `/me/interviews`,
  present in `/admin/interviews` with `deleted: true` and unchanged cost. If step definitions
  are missing, create them in `tests/step-definitions/admin.ts` against
  `http://localhost:${PORT}`.
- [x] **9. Run the Verification command and confirm @AC-17 green.**

## Definition of done
- `GET /admin/interviews` requires an admin session; a non-admin gets `403 FORBIDDEN` (the
  gate's allow path is exercised here by the admin read in @AC-17; the deny path is asserted by
  @AC-18 in N02, and `requireAdmin` returns 403 correctly now).
- Another candidate deleting an interview they do not own returns `404 INTERVIEW_NOT_FOUND`,
  and the interview remains in the owner's `GET /me/interviews`.
- The owner deleting returns `204`; the interview is then absent from `GET /me/interviews` and
  present in `GET /admin/interviews` with `deleted: true` and `costUsd`/`totalTokens` unchanged.
- The soft delete sets `interviews.deleted_at`; no `interviews` row is hard-deleted (grep the
  handler — it calls `update`, never `delete`).
- The admin list is the only `prisma.interview.findMany` call site, and it carries the
  `ADMIN AUDIT` comment; `GET /me/interviews` goes through `userInterviews`.
- No token value, per-user cost breakdown, or PII appears in any log line.
- `npm run test:acceptance -- --tags "@admin-cost and @AC-17"` exits 0.

## Verification
```bash
npm run test:acceptance -- --tags "@admin-cost and @AC-17"
```

Expected output: one scenario passes, zero failures, zero pending.

Then confirm the soft delete is not a hard delete and the bypass is annotated:
```bash
grep -rn "prisma.interview.delete\b" backend/modules            # must print nothing
grep -rn "ADMIN AUDIT" backend/modules/admin/interviews.ts      # must print the bypass comment
```

## Notes

Done 2026-08-03. `1 scenario (1 passed) / 13 steps (13 passed)` for @AC-17. Full default
profile `40 scenarios (40 passed) / 298 steps`; `auth` profile `18 scenarios (18 passed)`;
vitest `19 files / 117 tests`; lint + typecheck clean.

**What exists now**
- `modules/admin/middleware.ts` — `requireAdmin`, exported. `req.user?.role !== 'admin'` →
  `ApiError('FORBIDDEN')`.
- `modules/admin/router.ts` — `router.use(requireAuth, requireAdmin)` then
  `GET /interviews`. Carries the `// N02 mounts GET /stats below this line` slot.
- `modules/admin/interviews.ts` — the audit list. `ADMIN AUDIT` comment on the bypass.
- `modules/interview/delete.ts`, `modules/interview/my-interviews.ts`.
- `modules/interview/cursor.ts` — `encodeCursor`/`decodeCursor`/`pageLimit`, shared by both
  lists. **N02 does not need it** (`/admin/stats` is unpaginated).
- `src/app.ts` — `app.get('/me/interviews', requireAuth, listMyInterviews)` and
  `app.use('/admin', adminRouter)`. `DELETE /:id` on I03's router (inherits `requireAuth`,
  `requirePublicOrigin`, `router.param('id', resolveInterview)`).

**Deviations from the plan**
- **Steps live in `backend/features/step_definitions/admin.steps.ts` (default ring), not
  `tests/step-definitions/admin.ts` (auth ring)** as the task file said. The task predates
  A04's two-profile split. `npm run test:acceptance` is the `default` profile only, so the
  Verification command as written can only be non-vacuous there — and since I03 the default
  ring already boots the real app over HTTP against Postgres, so it hosts this fine.
  REFERENCE.md § Commands still names the auth-profile form; corrected there.
- **`@AC-18` tagged `@unwired`** in `admin_cost.feature` (ADR-I26 mechanism). **N02 deletes
  that tag** before writing its steps, then runs it red.
- `cucumber.js` `default.paths` gained `.agents/features/admin_cost.feature`.
- `AiWorld` gained `actors`, `recordedCost` and `httpDelete` — @AC-17 is the first scenario
  with three actors and the first `DELETE` in the ring.
- Added unit tests the ACs cannot reach: `modules/admin/middleware.test.ts` (the gate's DENY
  path — @AC-17 only signs in the admin, and @AC-18 is still `@unwired`) and
  `modules/interview/cursor.test.ts`.

**How things were queried**
- `totalTokens`: one `prisma.llmCall.groupBy({ by: ['interview_id'], _sum })` over the page's
  ids, not a sum per row. `input_tokens`/`output_tokens` are nullable — coalesced to 0.
- `costUsd`: `row.spent_usd.toFixed(6)` (Decimal → six-decimal string).
- Cursor: `base64url(id)`, decoded back and shape-checked against `^[a-z0-9]{20,32}$`;
  anything else is treated as no cursor rather than 500ing off a query string.
  `take: limit + 1` then slice is how `nextCursor` is decided.

**Not done, deliberately**
- `GET /admin/stats` — N02's.
- Faceted admin filters (`?occupationCluster&state&userId`) — STATE backlog; only
  `cursor`/`limit` are implemented.
- **`and not @AC-29` in `cucumber.js`'s `auth` profile is still there.** That comment asks
  "whichever task ships `GET /me/interviews`" to wire the auth ring's interview steps and
  delete it. The endpoint now exists, so it is unblocked — but the steps and the scenarios
  are `email_verification.feature`, auth ledger, **Ahmet's**. Left for A06.

**Local environment gotcha** (cost ~20 min): root `.env` uses the docker-internal hostnames
`db`/`cache`, so acceptance cannot run from the host with it. Run with host overrides:
`DATABASE_URL=postgresql://interviewly:interviewly@localhost:5432/interviewly_test`,
`REDIS_URL=redis://localhost:6380` (compose.dev maps 6380→6379). `interviewly_test` did not
exist — `db/init.sql` creates it but only on a fresh volume, so it had to be created and
`prisma migrate deploy`d by hand.

### PR #23 review round (2026-08-03)

Merged `origin/master` in (I09 landed as PR #22 and touched the same `cucumber.js`
`default.paths` list). Conflict was one line; both features stay.

Copilot raised 3 comments. **One was right, two rest on a false premise:**

- **Right, and my error** — `cursor.ts`'s comment claimed a cursor could not be hand-built.
  base64url is trivially reversible, so that read as a security property the code does not
  have. Rewritten to say it is encoding, not a boundary.
- **Wrong** — "an absent/foreign cuid-shaped cursor reaches Prisma's `cursor` and can 500."
  Measured against this schema: it does **not** throw. A user with 3 interviews and a bogus
  cursor gets `0 rows, no exception`; over HTTP all of `absent-cuid`, `!!!garbage!!!` and a
  too-short id return `200 {"items":[],"nextCursor":null}`. A foreign id is also just an empty
  page, because `userInterviews` filters `user_id` before the cursor applies — no leak.

I built the suggested `resolveCursor` (re-read the id under the caller's filter) and then
**reverted it**: it costs a query per paged request to fix nothing, and it turns a stale
cursor into a re-serve of page one, which is worse for a paging client than the end-of-list
it reads today. The measurement is recorded in `cursor.ts` so this is not re-litigated.

`decodeCursor`'s cuid shape check stays — it skips a pointless query on garbage.

### For N02

`requireAdmin` is exported from `modules/admin/middleware.ts` but **you do not need to import
it**: mount `GET /stats` at the marked slot in `modules/admin/router.ts` and it inherits the
gate from `router.use` (ADR-N01). That inheritance is unit-tested — do not restate the gate
per route.

Stay consistent with the `GET /admin/interviews` item shape: `costUsd` is a **six-decimal
string** (`Decimal.toFixed(6)`), never a number; `totalTokens` is a **number** with nulls
coalesced to 0. `/admin/stats`'s `totalTokens` must include deleted interviews (K11) — so it
bypasses `userInterviews` the same way, and the `ADMIN AUDIT` comment goes on that call site
too. `@AC-18` also re-asserts `GET /admin/interviews` (403 for non-admin, deleted rows
included); that endpoint is done, so those steps are assertions, not new implementation.

Delete `@unwired` from `@AC-18` in `.agents/features/admin_cost.feature` **first**, confirm it
runs red, then write the steps. `admin_cost.feature` is already in `cucumber.js` `default.paths`
and `AiWorld` already has `actors` + `httpDelete`.
