# N01 — Admin-role gate + soft-delete audit path: `requireAdmin`, `GET /admin/interviews`, `DELETE /interviews/:id`, `GET /me/interviews`
REPO: (this repo) · Depends: F01, F02, F03, A01, A02, I03, I06, I08 · Status: todo
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
- [ ] **1. Confirm dependency artefacts exist** — `requireAuth` + `app.ts` mount point +
  error handler (A01); `userInterviews`/`activeInterview`/`prisma` (F02); I03's
  `modules/interview/router.ts`, `ownership.ts` (`:id` resolver), `csrf.ts`; a seeded
  `role=admin` user (F02 seed); interview + answer + `llm_calls` rows reachable (I06/I08/I02).
  If any is missing, set this task to `blocked` in STATE.md and stop.
- [ ] **2. Create `modules/admin/middleware.ts`** — `requireAdmin`; `403 FORBIDDEN` unless
  `req.user.role === 'admin'`. Export it.
- [ ] **3. Create `modules/admin/interviews.ts`** — `GET /admin/interviews`: direct
  `prisma.interview.findMany` (ADMIN AUDIT comment, no `deleted_at` filter), cursor page, map to
  the item shape, compute `totalTokens` and `deleted`, read `costUsd` from `spent_usd`.
  Log `ADMIN_INTERVIEWS_LISTED` ({ traceId, count }).
- [ ] **4. Create `modules/admin/router.ts`** — `router.use(requireAuth, requireAdmin)`, mount
  `GET /interviews`, leave the N02 `/stats` slot comment.
- [ ] **5. Create `modules/interview/delete.ts`** — soft-delete handler; `204`; log
  `INTERVIEW_SOFT_DELETED`.
- [ ] **6. Create `modules/interview/my-interviews.ts`** — `GET /me/interviews` via
  `userInterviews`, cursor page.
- [ ] **7. Mount routes** — admin router + `GET /me/interviews` in `app.ts`; `DELETE
  /interviews/:id` on I03's interview router behind the `:id` ownership resolver and CSRF
  middleware. Confirm the error handler maps `FORBIDDEN`/`INTERVIEW_NOT_FOUND`.
- [ ] **8. Tests — negative and positive cases.** Wire the Cucumber step definitions for
  `admin_cost.feature` @AC-17. The step "a candidate owns an interview with recorded cost"
  seeds an interview with `llm_calls`/`spent_usd` (fixture, direct DB). The negative case is
  the non-owner delete → `404 INTERVIEW_NOT_FOUND` and the interview STILL present in the
  owner's list; the positive case is the owner delete → `204`, absent from `/me/interviews`,
  present in `/admin/interviews` with `deleted: true` and unchanged cost. If step definitions
  are missing, create them in `tests/step-definitions/admin.ts` against
  `http://localhost:${PORT}`.
- [ ] **9. Run the Verification command and confirm @AC-17 green.**

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

(Empty until the task is done. Fill with: what actually happened, every deviation from the
plan, the Cucumber output verbatim, whether step definitions needed creating and where they
live, how the `totalTokens` aggregation was queried (per-interview `llm_calls` sum), how the
cursor was encoded, what was deliberately NOT done and why, and a "For N02" hand-off paragraph
noting the exported `requireAdmin`, the admin router's `/stats` mount slot, and the
`GET /admin/interviews` item shape N02's stats endpoint should stay consistent with.)
