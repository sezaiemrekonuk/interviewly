# Auth — State

Last updated: 2026-07-31
Last session ended: **A03 blocked** — both auth screens, the shared credentials form, the
`errors.<CODE>` wiring, the Google button, the `returnPath` guard and the `useRequireAuth`
hook all landed, and the component ring is green (12 tests, plus 10 more for the helpers).
The Playwright smoke is written and collects, but cannot run: `docker compose up` produces
no `api`, no `worker` and no `edge`. Three F03 defects, all reproduced — see
`## Open blockers`. Nothing in A03's own scope is outstanding.

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

**A03 is `blocked` on BLOCKER-1 below** — not on anything in this ledger. Its own scope is
finished and its component-ring verification is green; only the second Verification command
(the Playwright smoke, which needs a running stack) is outstanding. Once F03's three stack
defects are fixed, re-run `npx playwright test tests/smoke/auth.spec.ts` and flip A03 to
`done`. No auth task should be started ahead of it: A04 and A06 both depend on A03.

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

**BLOCKER-1 (2026-07-31) — `docker compose up` does not produce a working stack.**
Blocks: A03's Playwright smoke, and every later browser-facing task. Owner: **Sezai (F03)**.

Three independent defects, each reproduced on a clean `docker compose up -d --build`:

1. **`api` and `worker` images ship no build output.** Neither `backend/tsconfig.json` nor
   `worker/tsconfig.json` exists, so `npm run -w @interviewly/backend build` fails with
   `error TS5058: The specified path does not exist: 'tsconfig.json'`. Both Dockerfiles
   swallow it (`RUN npm run … build || true`) and then `CMD ["node", "backend/dist/index.js"]`
   dies with `Cannot find module '/app/backend/dist/index.js'`. Root `npm run build` fails
   for the same reason.
2. **`edge` never starts.** `web`'s healthcheck runs `curl`, which is not in the image
   (`"curl": executable file not found in $PATH`), so `web` is permanently unhealthy and
   `edge` — which waits on `web` *and* `api` — stays in `Created`. Nothing listens on :80.
3. **Caddy cannot reach the auth routes even once `api` runs.** The Caddyfile has no
   `/auth/*` handler, and `handle /api/*` preserves the prefix (only `handle_path` strips),
   while the backend mounts at `/auth` and `/me`. So `/api/auth/login` arrives at the API as
   `/api/auth/login` → 404, and `/auth/google/callback` — A02's `REDIRECT_URI` — falls
   through to the catch-all and lands on Next.js instead of the API.

**Which fix for (3):** `handle /api/*` → `handle_path /api/*`, and A02's `REDIRECT_URI`
becomes `${PUBLIC_ORIGIN}/api/auth/google/callback`. Every ledger already names `/api/*`
as the browser-facing prefix (F03's task file route table, both REFERENCE files, and F01's
next-intl matcher, which excludes `/api/*`), and nothing anywhere mounts the backend under
`/api` — so the strip belongs at the edge and no backend mount path or acceptance-test URL
has to move. A03 is coded against `/api/*` on that basis; the prefix lives in exactly one
place, `frontend/src/lib/api.ts` → `API_BASE`.

Note that CI is green on all three: the `build` job's `docker compose build` passes because
of the `|| true`, and `compose-check` only validates YAML. Neither job ever starts a
container. Worth a foundations backlog entry on its own.

## Task ledger (A01–A05)

Statuses: todo → in_progress → done → (blocked if waiting on user).
`Repo`: blank = this repo.

| ID | Title | Repo | Status | Depends on |
|----|-------|------|--------|------------|
| A01 | Creating the backend auth module: register, login, logout, session cookie, and `/me` | | done | F01, F02, F03 |
| A02 | Adding Google OAuth (arctic PKCE), account linking, and admin password restriction | | done | A01 |
| A03 | Building the frontend login and register forms | | blocked | A02 |
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
- **Lazy the shared Redis client so auth can have vitest unit tests** — `rate-limit.ts`
  constructs `new Redis(...)` at module load with `maxRetriesPerRequest: null`, so importing
  anything in `modules/auth/` from a unit test opens a connection that retries forever. The
  `unit` CI job has no Redis service, so the test would hang rather than fail. Until this is
  a lazy getter, auth cannot drop `--passWithNoTests` from `backend` → `test:unit`, and the
  `unit` job stays the false green that foundations' backlog tracks. Trigger: the first auth
  task that needs a unit test, or foundations fixing the false green.
