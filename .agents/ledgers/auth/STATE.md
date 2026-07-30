# Auth — State

Last updated: 2026-07-30
Last session ended: **—** Ledger written; no task has started yet.

## Execution protocol (follow exactly)

Do not start from this file. `.agents/EXECUTE.md` is the prompt, and its § 4 decides which
task is yours — not the "Current task" pointer below, which is a human-readable summary and
can lag.

Read this file → read `REFERENCE.md` once → read only the task § 4 gave you →
check `MODELS.md` for the required tier and stop if it is not yours → do the work, ticking
checkboxes → run the task's `## Verification` command verbatim → fill in the task's
`## Notes` → update this file's ledger row, "Current task" pointer, and "Last session ended"
line → write `.agents/devlogs/{ID}-<slug>.md` (EXECUTE.md § Devlog) → **do not commit** →
re-apply EXECUTE.md § 4 and continue with what it gives you.

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

## Task ledger (A01–A05)

Statuses: todo → in_progress → done → (blocked if waiting on user).
`Repo`: blank = this repo.

| ID | Title | Repo | Status | Depends on |
|----|-------|------|--------|------------|
| A01 | Creating the backend auth module: register, login, logout, session cookie, and `/me` | | todo | F01, F02, F03 |
| A02 | Adding Google OAuth (arctic PKCE), account linking, and admin password restriction | | todo | A01 |
| A03 | Building the frontend login and register forms | | todo | A02 |
| A04 | Building email verification: tokens, the mail job, the gate, and the two screens | | todo | A03 |
| A05 | Building password reset: enumeration-safe request, session-revoking confirm, two screens | | todo | A04 |
| A06 | Building the onboarding profile: three cards, CV upload, and first-run routing | | todo | A03 |

## Critical path

A01 → A02 → A03 → A04 → A05 (sequential, one owner). All depend on F01 + F02 + F03 being green.
**A06 branches off A03** and is independent of A04/A05 — it touches `users.profile`, they touch
`users.email_verified_at` and `email_tokens`, so the two lines can run in parallel after A03.

**A04 and A05 are bonus-band (IDEA.md §12).** They are specified so that cutting them is a
decision, not an accident: if the deadline squeezes, stop after A03 and the mandatory auth
requirement is still complete and green. A04's one edit outside its own files is the verification
gate in `POST /interviews` (interview-core I03) — if I03 has not landed, A04 records the gate as
pending rather than inventing the endpoint.

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

- ~~**`sessions(user_id)` index for bulk revocation**~~ — **promoted into A05** (2026-07-30). The
  trigger fired: K8.6's reset revokes every session of a user, which is exactly the `user_id`
  lookup this was waiting for. A05 ships it as an index-only migration.
- **Rate-limit Cucumber coverage (`rate_limits.feature` @AC-13)** — auth implements the
  middleware; the feature file is owned by `interview-core` since it covers interview-start
  limits alongside auth limits. Promote if auth needs to own its own coverage separately.
- **Locale-switcher form element in auth screens** — `frontend` ledger owns the switcher
  component; A03 hard-codes the default locale display. Promote when the switcher is
  specced.
