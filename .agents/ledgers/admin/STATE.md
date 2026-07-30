# Admin — State

Last updated: 2026-07-30
Last session ended: **—** Ledger written; no task has started yet.

## Execution protocol (follow exactly)

Read this file → read `REFERENCE.md` once → read only the current task's file →
check `MODELS.md` for the recommended model → do the work, ticking checkboxes →
run the task's `## Verification` command verbatim → fill in the task's `## Notes` →
update this file's ledger row, "Current task" pointer, and "Last session ended" line →
write `.agents/devlogs/{ID}-<slug>.md` (EXECUTE.md § Devlog) →
commit as `{ID}: <title>` → **STOP. Do not roll into the next task.**

## Current task

**N01 — Admin-role gate + soft-delete audit path** is the first `todo` task. It depends on
foundations F01/F02/F03, auth A01/A02, and interview-core I03/I06/I08 being `done` (see
Cross-ledger section below). Do not start N01 until every cited task is green. Once they
are, read N01's file, confirm no prior partial admin work exists, and begin. The one trap:
the admin audit list must **bypass** `userInterviews()` (deleted rows included) while
`GET /me/interviews` must **use** it (deleted rows excluded) — the same request cycle
exercises both directions in @AC-17.

## Environment

Foundations (`F01`, `F02`, `F03`), auth (`A01`, `A02`) and interview-core (`I03`, `I06`,
`I08`) must be `done` before the admin tasks start (per-task `Depends on` below):

- **F01** provides `backend/src/lib/error-codes.ts` (`FORBIDDEN`, `INTERVIEW_NOT_FOUND`,
  `UNAUTHENTICATED`, `VALIDATION_ERROR`) and `@interviewly/types`.
- **F02** provides `backend/prisma/schema.prisma` (`interviews` incl. `deleted_at` +
  `spent_usd`, `llm_calls`, `report_questions`, `occupation_clusters`) and
  `backend/src/lib/db.ts` (`prisma`, `userInterviews`, `activeInterview`) plus the seeded
  `role=admin` demo user (db AC-10).
- **F03** provides `backend/src/lib/logger.ts`, `backend/src/lib/env.ts`, `compose.yaml`
  (Postgres + Redis), and the CI acceptance-runner wiring.
- **A01** provides `requireAuth`, `backend/src/app.ts` (router mount point), the global
  error handler + `traceId` middleware.
- **A02** provides the admin password sign-in path (an admin obtains a session) and owns
  `admin_auth.feature` (ADR-N04) — this ledger consumes the admin session, it does not
  build admin auth.
- **I03** provides `backend/modules/interview/router.ts`, the `:id` ownership resolver
  (`activeInterview` + `user_id`, non-owner → `404`), and `backend/modules/interview/csrf.ts`.
- **I06** provides real interview + answer rows (data to list, delete and aggregate).
- **I08** provides the in-transaction `spent_usd` increment (the per-interview cost the
  admin list reads). `llm_calls` token/cost rows are written by **I02** (a transitive
  dependency of I08); the admin `totalTokens` sum reads those rows.

Set up the environment once the dependencies land:

```bash
docker compose up -d db cache          # start Postgres + Redis
cd backend
npm install
npx prisma migrate deploy              # apply F02 migration
npm run seed                           # seed the role=admin demo user (db AC-10)
```

The Cucumber acceptance runner runs from the repo root (wired by F03/CI). Confirm it is
wired before running any Verification command.

```bash
npm run test:acceptance -- --tags "@admin-cost and @AC-17"   # N01 check
npm run test:acceptance -- --tags "@admin-cost and @AC-18"   # N02 check
npm run test:acceptance -- --tags "@admin-cost"              # whole feature (after N02)
```

## Open blockers / decisions for the user

None at ledger-write time.

## Task ledger (N01–N02)

Statuses: todo → in_progress → done → (blocked if waiting on user).
`Repo`: blank = this repo.

| ID | Title | Repo | Status | Depends on |
|----|-------|------|--------|------------|
| N01 | Admin-role gate + soft-delete audit path: `requireAdmin`, `GET /admin/interviews`, `DELETE /interviews/:id`, `GET /me/interviews` | | todo | F01, F02, F03, A01, A02, I03, I06, I08 |
| N02 | Admin stats aggregation: `GET /admin/stats` (K11 metrics) | | todo | N01 |

## Critical path

F01/F02/F03 + A01/A02 + I03/I06/I08 → **N01 → N02** (sequential, one owner). N02 reuses the
`requireAdmin` gate and `GET /admin/interviews` list N01 builds, adding only the stats
endpoint that greens `@AC-18`.

## Cross-ledger dependencies (blocks this ledger)

| Ledger task | Provides | Needed by |
|---|---|---|
| F01 | `error-codes.ts` (`FORBIDDEN`, `INTERVIEW_NOT_FOUND`, `UNAUTHENTICATED`, `VALIDATION_ERROR`), `@interviewly/types` | N01, N02 |
| F02 | `schema.prisma` (`interviews.deleted_at`/`spent_usd`, `llm_calls`, `report_questions`, `occupation_clusters`); `db.ts` (`userInterviews`, `activeInterview`); seeded `role=admin` user | N01, N02 |
| F03 | `logger.ts`, `env.ts`, `compose.yaml` (Postgres + Redis), CI acceptance runner | N01, N02 |
| A01 | `requireAuth`, `app.ts` router mount, global error handler + `traceId` middleware | N01, N02 |
| A02 | admin password sign-in (admin obtains a session); owns `admin_auth.feature` @AC-4 (ADR-N04) | N01, N02 |
| I03 | `modules/interview/router.ts`, `:id` ownership resolver (`activeInterview`, non-owner → 404), `csrf.ts` | N01 |
| I06 | real interview + answer rows (data to list / delete / aggregate) | N01, N02 |
| I08 | in-transaction `spent_usd` increment (per-interview cost); I02 (transitive) writes `llm_calls` token/cost rows | N01, N02 |

**No admin task may be merged until every task in its `Depends on` row is green.** A partial
state — e.g. I03 done but I08 not — means the admin audit list has interviews but no recorded
cost, so @AC-17's "its cost is unchanged" assertion cannot be exercised. Wait on a green task,
never on a half-done branch.

## Backlog (deferred, unnumbered — promote to a task when its trigger fires)

- **`GET /admin/interviews/:id` per-call drill-down** (provider, model, `prompt_uuid`+version,
  units, cost, latency + security/budget/time events) — the backend spec defines it but no
  `admin_cost.feature` scenario maps it (absent from `COVERAGE.md`). Promote when the admin
  drill-down UI (US-29) or a scenario is specced; it is a plain relational read over
  `llm_calls` for one interview.
- **`llm_calls(interview_id, created_at)` composite cost-aggregation index** — F02 already
  has `@@index([interview_id])`, which covers the MVP admin reads. Promote as a safe additive
  Prisma migration rebased on F02 if `GET /admin/stats` aggregation is slow at scale.
- **Rich admin filters** (`?occupationCluster&state&userId` faceting) — the spec lists them,
  but @AC-17/@AC-18 assert only listing + a `cursor/limit` page. Implement the minimal cursor
  pagination for the green run; promote faceted filters when the admin panel UI needs them.
- **`cutShort` broken out as a distinct stat** beyond the `completed` count — N02 returns it
  per K11, but no scenario asserts the split; keep it, promote a dedicated assertion only if
  the dashboard surfaces it separately.
