# Auth — State

Last updated: 2026-08-03
Last session ended: **A05 done; A03 still blocked, A06 next.** Password reset shipped whole —
both endpoints, the IP-keyed limit, the `sessions(user_id)` index migration and both screens.
`npx cucumber-js -p auth` → 18 scenarios, 18 passed (was 11). The two traps held under test: the
request writes `res.end()` before it looks the account up, so known, Google-only and unknown are
identical in status, body, headers and latency; the confirm revokes every session in the same
transaction as the password write, and mutating that revoke out makes @AC-26 fail.

`MODELS.md` had no rows for A04–A06 and now does. BLOCKER-1b is untouched and still Sezai's.
Previous summary follows.

Previous: **A04 done.** Shipped in full except the gate, which is a missing endpoint rather than
missing work — `requireVerifiedEmail` exists and I03 mounts it. The auth acceptance ring had
to be resurrected first (it had not run since `1097dc8`; see **BLOCKER-2**, resolved), and a
boolean-env defect had to be fixed for the K8.6 flag to mean anything (see the note to Sezai
under BLOCKER-1b). The stack was re-checked at `fe33356`: BLOCKER-1's defects (2) `curl`
healthcheck and (3) Caddy `handle_path` are fixed, defect (1) is not, and `api` exits 1 with
`Cannot find module '/app/backend/dist/src/index.js'` — three packaging defects recorded as
**BLOCKER-1b**, all Sezai's.

Previous: **A03 blocked** — both auth screens, the shared credentials form, the
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

**A06 — the onboarding profile** is the last task in this ledger. A05 is `done`; A06's only
dependency is A03, whose *code* is merged on master — A03 is `blocked` on its own Playwright
smoke, not on scope. A06 is **sonnet-tier** (`MODELS.md`), so an opus session must stop under
EXECUTE.md § 5 and hand it back.

A06's second Verification command curls `$PUBLIC_ORIGIN/assets/<cv-key>` expecting a non-`200`,
which needs the stack BLOCKER-1b keeps down. Its coding is unaffected; only that last check is
impeded, the same shape as A03.

**A03 stays `blocked` on BLOCKER-1b below** — not on anything in this ledger. Its own scope is
finished and its component-ring verification is green; only the second Verification command
(the Playwright smoke, which needs a running stack) is outstanding. BLOCKER-1's defects (2)
and (3) have since been fixed, but `docker compose up -d --build` still fails to start `api`
for three packaging reasons recorded as BLOCKER-1b. Once those are fixed, re-run
`npx playwright test tests/smoke/auth.spec.ts` and flip A03 to `done`.

A04 and A05 went ahead of it deliberately: A03's code is merged on master and both depend on
that code, not on A03's outstanding browser smoke. Both verify off the auth cucumber ring, which
BLOCKER-1b cannot reach. Neither they nor A06 can close BLOCKER-1b.

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

**Re-checked 2026-07-31 (second run, after `dab57c4 fix(docker)` / `eefee5e fix(edge)`):
defects (2) and (3) are fixed — `web`'s healthcheck now uses `wget`, and `Caddyfile:2` is
`handle_path /api/*`. Defect (1) is NOT fixed; both tsconfigs now exist and `tsc` runs
clean, but the packaging is wrong in three new ways, so `docker compose up -d --build`
still ends with `dependency failed to start: container interviewly-api-1 exited (1)`.
See BLOCKER-1b. The original text of (1)–(3) is kept below as the historical record.**

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

**The proposed fix for (3) is verified, not guessed (2026-07-31).** The stack was
reassembled by hand — Postgres and Redis from `compose.yaml`, the API on the host via
`tsx backend/src/index.ts`, `next dev`, and a Caddy container whose config is the committed
Caddyfile with the single `handle` → `handle_path` change — and the whole surface came up
green through the edge on `:8080`:

```
GET  /api/healthz                        200
POST /api/auth/register                  201 + Set-Cookie: session=…; HttpOnly; SameSite=Lax
POST /api/auth/register  (duplicate)     409 {"error":{"code":"EMAIL_TAKEN"}}
POST /api/auth/login     (wrong pw)      401 {"error":{"code":"INVALID_CREDENTIALS"}}
POST /api/auth/login     (correct)       200
GET  /api/me             (with cookie)   200 {"user":{…}}
GET  /api/me             (no cookie)     401 {"error":{"code":"UNAUTHENTICATED"}}
npx playwright test tests/smoke/auth.spec.ts   2 passed
```

So `handle_path` is the whole of defect (3): no backend mount path moves, no acceptance-test
URL moves. Defects (1) and (2) still need F03 for `docker compose up` to reproduce this.

**Two further defects were found and fixed in this branch — both F01, this ledger's owner.**

4. **Every route in the app was a 404.** `frontend/src/middleware.ts` used
   `createMiddleware` from `next-intl/middleware`, whose default `localePrefix: 'always'`
   redirects `/sign-in` → `/en/sign-in`. The app has no `[locale]` segment — it is
   next-intl's *without i18n routing* mode (`requestLocale` in `src/i18n.ts`) — so every
   redirect landed on a 404, `/` included. That mode takes no middleware at all, so the file
   was removed. `/`, `/sign-in` and `/register` now answer 200. Turkish is not selectable
   until the locale switcher lands, which is the state this ledger's Backlog already
   records.
5. **Body copy rendered in the browser's fallback serif.** The root layout defines
   `--font-body`/`--font-heading` on `<html>`, but `globals.css` never applied
   `--font-body` to `body` — so headings that name `--font-heading` looked right while
   every other string did not. One declaration in `globals.css`, plus `font: inherit` on
   `button`/`input`.

**BLOCKER-1b (2026-07-31) — the `api` image compiles but cannot be started by `node`.**
Blocks: the same set as BLOCKER-1 (A03's Playwright smoke, then A04/A06).
Owner: **Sezai (F03 packaging, plus `packages/ai` from I01/I02).**

Reproduced on a clean `docker compose up -d --build` at `fe33356`. `docker compose logs api`:

```
Error: Cannot find module '/app/backend/dist/src/index.js'
```

Three packaging defects, each verified inside the built image, not inferred:

6. **`tsc` emits one directory level deeper than the Dockerfile's `CMD` expects.**
   `backend/tsconfig.json` extends the root config, which sets `paths` for
   `@interviewly/types` and `@interviewly/ai` onto `packages/*/src/*.ts`. Those source files
   join the program, so tsc's inferred common root becomes the repo root, not `backend/`.
   The actual emit is `/app/backend/dist/backend/src/index.js` (alongside a
   `/app/backend/dist/packages/ai/src/index.js`), while `backend/Dockerfile` ends with
   `CMD ["node", "backend/dist/src/index.js"]`. Verified with `find /app/backend/dist -name
   index.js` in the image. `worker/Dockerfile` has the same shape
   (`CMD ["node", "worker/dist/index.js"]`) and needs the same check.
7. **The workspace packages are not linked into the image at all.**
   `ls /app/node_modules/@interviewly/` in the built image contains exactly one entry,
   `backend -> ../../backend`. There is no `ai` and no `types`, because the `deps` stage runs
   `npm ci --workspace=@interviewly/backend --include-workspace-root` after copying only the
   root and `backend/package.json` — `packages/*/package.json` never enter that stage. So
   even with (6) fixed, the first `require('@interviewly/ai')` in
   `backend/src/index.ts:1` throws. The build does not catch this: tsc resolves those
   imports through tsconfig `paths`, never through `node_modules`.
8. **`@interviewly/ai` has no runtime entry point.** `packages/ai/package.json` declares
   `"main": "src/index.ts"` — a TypeScript file `node` cannot load. Compiling the backend
   does not fix it: tsc rewrites no import specifiers, so the built output still asks
   `node` for the package by name. (`@interviewly/types` is fine: its `main` is
   `dist/packages/types/src/index.js` and that file exists.)

Also worth noting for foundations: **`backend/package.json` lists neither
`@interviewly/ai` nor `@interviewly/types` under `dependencies`**, which is the underlying
reason npm has no link to create in (7).

None of this is auth-side, and none of it is reachable from this ledger: (6) and (7) live in
`backend/Dockerfile` + `worker/Dockerfile`, (8) lives in `packages/ai/package.json`. A03's
own scope stays finished and its component ring stays green; only the Playwright smoke is
still waiting on a stack that boots.

CI remains green through all of it for the reason BLOCKER-1 already gives: no job ever
starts a container.

**Also for Sezai, found while booting the stack by hand for A04 (2026-07-31) — fixed here, not
left for you, because A04's own gate depended on it.** Every boolean key in
`backend/src/lib/env.ts` and `worker/src/lib/env.ts` used `z.coerce.boolean()`, which is JS
truthiness over a string: `"false"` parses as `true`. `.env.example` ships
`EMAIL_VERIFICATION_REQUIRED=false` and `AI_ENABLED=false`, so a default clone got the K8.6 gate
switched **on** — the opposite of the spec — and a boot that demanded provider keys nobody has:

```
no api key configured for provider(s): openai
{"code":"PROVIDER_KEY_MISSING","msg":"BOOT_FAILED"}
```

Both files now parse the literal string (`boolFromEnv`). This is your file; the change is three
lines plus a comment, and the interview-core ring is unaffected (`20 scenarios (20 passed)` after
it). Worth an F03 backlog entry that no test anywhere reads an env value that is meant to be off.

**BLOCKER-2 (2026-07-31) — RESOLVED in this session. The auth acceptance ring had not run since
`1097dc8`.** Recorded because it was silent for two commits and the shape of the mistake will
recur. I01 introduced a root `cucumber.js` for the interview-core rings and dropped backend's
`test:acceptance` script, but nothing carried A01's auth wiring across, so `backend/cucumber.js`,
`backend/tests/step-definitions/auth.ts` and the whole `backend/tests/support/` harness were
orphaned — `auth.feature` and `admin_auth.feature` were simply never executed, and CI was green
throughout. A04 restored them as a second cucumber profile (ADR-A09) and deleted the stale
config. `harness.ts` also stopped resolving the Prisma schema through `process.cwd()`, which had
only worked while the runner lived in `backend/`.

## Task ledger (A01–A05)

Statuses: todo → in_progress → done → (blocked if waiting on user).
`Repo`: blank = this repo.

| ID | Title | Repo | Status | Depends on |
|----|-------|------|--------|------------|
| A01 | Creating the backend auth module: register, login, logout, session cookie, and `/me` | | done | F01, F02, F03 |
| A02 | Adding Google OAuth (arctic PKCE), account linking, and admin password restriction | | done | A01 |
| A03 | Building the frontend login and register forms | | blocked | A02 |
| A04 | Building email verification: tokens, the mail job, the gate, and the two screens | | done | A03 |
| A05 | Building password reset: enumeration-safe request, session-revoking confirm, two screens | | done | A04 |
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
| I03 | `POST /interviews`, the one endpoint A04's `requireVerifiedEmail` mounts on | A04's gate (@AC-29, deferred) |
| F01 | `error-codes.ts` registry (PASSWORD_TOO_SHORT, EMAIL_TAKEN, INVALID_CREDENTIALS, UNAUTHENTICATED, ADMIN_MUST_USE_PASSWORD, ACCOUNT_LINK_REQUIRES_PASSWORD, OAUTH_STATE_MISMATCH, VALIDATION_ERROR, RATE_LIMITED), `@interviewly/types` | A01, A02 |
| F02 | `schema.prisma` `User` + `Session` models; `db.ts` Prisma singleton | A01, A02 |
| F03 | `logger.ts`, `env.ts`, `compose.yaml` (Postgres + Redis), `.env.example` | A01, A02 |

**No auth task may be merged until all three foundations tasks are green.** A partial
foundations state (e.g. F02 done but F03 not) means the session cookie test cannot run
because Redis (rate-limit counters) is not wired.

## Backlog (deferred, unnumbered — promote to a task when its trigger fires)

- ~~**`sessions(user_id)` index for bulk revocation**~~ — **shipped in A05** (2026-08-03) as
  `backend/prisma/migrations/*_sessions_user_id_idx/`, index-only.
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
