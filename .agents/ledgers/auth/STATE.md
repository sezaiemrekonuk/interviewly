# Auth — State

Last updated: 2026-07-30
Last session ended: **—** Ledger written; no task has started yet.

## Execution protocol (follow exactly)

Read this file → read `REFERENCE.md` once → read only the current task's file →
check `MODELS.md` for the recommended model → do the work, ticking checkboxes →
run the task's `## Verification` command verbatim → fill in the task's `## Notes` →
update this file's ledger row, "Current task" pointer, and "Last session ended" line →
commit as `{ID}: <title>` → **STOP. Do not roll into the next task.**

## Current task

**A01 — Creating the backend auth module** is the first `todo` task. It depends on
foundations tasks F01, F02, and F03 being `done` (see Cross-ledger section below).
Do not start A01 until all three foundations tasks are green. Once they are, read A01's
file, confirm the session infrastructure is clear (no prior partial work), and begin.

## Environment

Foundations (`F01`, `F02`, `F03`) must be `done` before any auth task starts:

- F01 provides: `backend/src/lib/error-codes.ts` (error-code registry), `@interviewly/types`
  package.
- F02 provides: `backend/prisma/schema.prisma` with `User` and `Session` models,
  `backend/src/lib/db.ts` with the Prisma singleton.
- F03 provides: `backend/src/lib/logger.ts`, `backend/src/lib/env.ts`, `compose.yaml`
  with a running Postgres and Redis, `.env.example` with all validated env keys.

Once foundations land, set up the environment:

```bash
docker compose up -d db cache   # start Postgres + Redis
cd backend
npm install
npx prisma migrate deploy       # apply F02 migration
```

The Cucumber acceptance runner runs from the repo root. Confirm it is wired by
foundations (F03/CI step) before running A01's Verification command.

```bash
npm run test:acceptance -- --tags "@AC-1 or @AC-2 or @AC-3"   # A01 check
npm run test:acceptance -- --tags "@AC-4 or @AC-5"             # A02 check
```

## Open blockers / decisions for the user

None at ledger-write time.

## Task ledger (A01–A03)

Statuses: todo → in_progress → done → (blocked if waiting on user).
`Repo`: blank = this repo.

| ID | Title | Repo | Status | Depends on |
|----|-------|------|--------|------------|
| A01 | Creating the backend auth module: register, login, logout, session cookie, and `/me` | | todo | — |
| A02 | Adding Google OAuth (arctic PKCE), account linking, and admin password restriction | | todo | A01 |
| A03 | Building the frontend login and register forms | | todo | A02 |

## Critical path

A01 → A02 → A03 (sequential, one owner). All three depend on F01 + F02 + F03 being green.

## Cross-ledger dependencies (blocks this ledger)

| Ledger task | Provides | Needed by |
|---|---|---|
| F01 | `error-codes.ts` registry (PASSWORD_TOO_SHORT, EMAIL_TAKEN, INVALID_CREDENTIALS, UNAUTHENTICATED, ADMIN_MUST_USE_PASSWORD, ACCOUNT_LINK_REQUIRES_PASSWORD, OAUTH_STATE_MISMATCH, VALIDATION_ERROR, RATE_LIMITED), `@interviewly/types` | A01, A02 |
| F02 | `schema.prisma` `User` + `Session` models; `db.ts` Prisma singleton | A01, A02 |
| F03 | `logger.ts`, `env.ts`, `compose.yaml` (Postgres + Redis), `.env.example` | A01, A02 |

**No auth task may be merged until all three foundations tasks are green.** A partial
foundations state (e.g. F02 done but F03 not) means the session cookie test cannot run
because Redis (rate-limit counters) is not wired.

## Backlog (deferred, unnumbered — promote to a task when its trigger fires)

- **`sessions(user_id)` index for bulk revocation** — no current scenario requires "revoke
  all sessions for a user" (e.g. password-change logout-everywhere). Promote when that
  feature is specced; it is a safe `CREATE INDEX` migration rebased on top of F02.
- **Rate-limit Cucumber coverage (`rate_limits.feature` @AC-13)** — auth implements the
  middleware; the feature file is owned by `interview-core` since it covers interview-start
  limits alongside auth limits. Promote if auth needs to own its own coverage separately.
- **Locale-switcher form element in auth screens** — `frontend` ledger owns the switcher
  component; A03 hard-codes the default locale display. Promote when the switcher is
  specced.
