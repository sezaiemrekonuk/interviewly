# I03 — Interview setup, room-state read, ownership resolver, CSRF middleware
REPO: (this repo) · Depends: F01, F02, F03, A01 · Status: todo
Read first: STATE.md, REFERENCE.md, then this.
**Model: claude-sonnet-4.6** — CRUD over the F02 helpers plus a deterministic split/heuristic; the ownership filter is one `where` clause and the CSRF check is a string compare. No new AI or state-machine invariant lands here. If the occupation heuristic edge cases bite, code-review the diff with `claude-opus-4.8`.

## Goal
Owner's ask:

> "`POST /interviews` (created→profiling, the HR/tech split, the occupation-cluster
> heuristic, `LISTING_REQUIRED`), `GET /interviews/:id/state` returning the resumable
> room-state shape, the ownership resolver that makes a non-owned id a 404, and the CSRF
> middleware every state-changing interview route will use. Scenario AC-6 in
> `question_generation.feature` green."
> — interview-core decomposition (§3.7, §6, §7.2)

This task creates the interview module router, the setup handler, the state read, the
ownership resolver, and the CSRF middleware (built here, first *asserted* in I05). It does
**not** generate questions (I04 owns generation and the `profiling → hr_round` transition)
or enforce rate limits (I13).

**Added 2026-07-30 — two edits from the spec revision:**

1. **The verification gate (K8.6).** When `config.EMAIL_VERIFICATION_REQUIRED` is true,
   `POST /interviews` requires a non-null `users.email_verified_at` → `EMAIL_NOT_VERIFIED` (403),
   and creates nothing. **This is the only gated endpoint in the system** — do not add the check to
   `GET /state`, the answer flow, or anything else. It reads a config flag; it is not an
   environment branch (§11.3). If auth A04 has not landed, the flag simply has no `email_verified_at`
   to read yet and the gate is inert — note that in `## Notes` rather than faking the column.
2. **The room-state shape gains nothing.** The two-tile room (§3.2) resolves the *second* persona
   from the interview's rounds, which the client already has; `persona` stays single-valued and
   describes the **active** speaker. Do not add a second persona field to room-state — one live
   question means one live speaker (K2), and a second field would be a second source of truth about
   whose turn it is.

## Security boundaries
- **A non-owned or soft-deleted `:id` is `INTERVIEW_NOT_FOUND` (404), never 403**
  (ADR-I11). Ownership resolves through `activeInterview`/`userInterviews` (soft-delete
  baked in), filtered by `req.user.id`.
- **`GET /state` returns no other user's data and no secret.** The room-state shape carries
  no provider key, no `job_source` internals beyond what the room needs, no `spent_usd` for
  a non-owner (a non-owner never reaches the handler).
- **The CSRF middleware compares `Origin` (fallback `Referer`) to `config.PUBLIC_ORIGIN`**
  and rejects a mismatch with `CSRF_ORIGIN_MISMATCH` (403) before the handler runs. Built
  here; wired onto every state-changing interview route; first asserted in I05.

## Non-negotiables
- **`POST /interviews` with neither `jobText` nor `uploadId` → 422 `LISTING_REQUIRED`, no
  interview row** (`question_generation.feature` @AC-6). A malformed body is
  `VALIDATION_ERROR` (422).
- **Split is deterministic:** `hrCount = max(2, round(target * 0.4))`, `techCount =
  target − hrCount`. For `target = 8` → `hrCount = 3`, `techCount = 5` (the asserted case).
  Persist `hr_question_count` and `target_question_count`; return both counts in the 201.
- **`created → profiling` on setup.** The row is inserted `state = profiling`,
  `current_index = 0`. No question generation here.
- **Occupation heuristic uses the seeded `occupation_clusters`.** Map the listing to
  `occupation` (free text) and `occupation_cluster_id` (nearest seeded cluster by keyword
  match); an unmatched listing leaves `occupation_cluster_id = null` (valid).

## Context (anchors)
- `backend/modules/interview/router.ts` — **create.** Express router mounted at
  `/interviews` from `app.ts`. All routes behind `requireAuth`. Wire the ownership resolver
  as `:id` param middleware and the CSRF middleware on every non-`GET` route. Leave marked
  comment slots where I04 (`/profile`), I06 (`/answers`), I07 (`/resume`, SSE) and I12
  (`/report/download`) will attach.
- `backend/modules/interview/ownership.ts` — **create.** `resolveInterview(req, res, next)`:
  `activeInterview(req.params.id)` then assert `interview.user_id === req.user.id`; miss →
  `INTERVIEW_NOT_FOUND` (404). Attach `req.interview`.
- `backend/modules/interview/setup.ts` — **create.** `POST /interviews`: Zod body
  (`{ mode, jobText?, uploadId?, targetQuestionCount }`), the `LISTING_REQUIRED` guard, the
  split, the occupation heuristic, insert via `prisma.interview.create`, 201
  `{ interviewId, hrCount, techCount }`. Leave the daily-limit + start-limiter middleware
  slot for I13.
- `backend/modules/interview/state.ts` — **create.** `GET /interviews/:id/state`: build the
  room-state shape from `req.interview` + the current question row (null if none yet). See
  REFERENCE.md "Room-state shape". Resumable — derived purely from `state` + `current_index`.
- `backend/modules/interview/csrf.ts` — **create.** `requirePublicOrigin(req, res, next)`:
  `Origin ?? Referer` origin must equal `config.PUBLIC_ORIGIN`; mismatch →
  `CSRF_ORIGIN_MISMATCH` (403). Exported for the router to apply.
- `backend/src/app.ts` — A01. Mount the interview router: `app.use('/interviews',
  interviewRouter)`. Confirm the global error handler maps the new codes to HTTP status.
- `backend/src/lib/db.ts` — F02 `activeInterview`, `userInterviews`, `prisma`. Use these,
  never `prisma.interview.findMany` directly (K13).
- `backend/src/lib/error-codes.ts` — F01. Confirm/add `LISTING_REQUIRED`,
  `INTERVIEW_NOT_FOUND`, `CSRF_ORIGIN_MISMATCH`, `VALIDATION_ERROR`.

  **The trap:** `current_index` is **global 1..N** across both rounds; the room-state
  `question` is resolved as "the row at global index `current_index`". At setup
  `current_index = 0` (no question delivered yet) and `question` is `null`. Do not seed it
  to 1 — I04/I06 advance it as questions are delivered/answered.

## Steps
- [ ] **1. Confirm A01 artefacts** — `requireAuth`, `app.ts` mount point, error handler,
  `config.PUBLIC_ORIGIN`. If missing, set `blocked` and stop.
- [ ] **2. Write `ownership.ts`** — the resolver; 404 on miss; attach `req.interview`.
- [ ] **3. Write `csrf.ts`** — the origin check middleware.
- [ ] **4. Write `setup.ts`** — Zod body, `LISTING_REQUIRED`, split, occupation heuristic,
  insert, 201 with counts.
- [ ] **5. Write `state.ts`** — the room-state shape; null question at `current_index = 0`.
- [ ] **6. Write `router.ts`** — mount all four; wire ownership as `:id` middleware and CSRF
  on non-`GET`; mark the I04/I06/I07/I12 slots.
- [ ] **7. Mount in `app.ts`.**
- [ ] **8. Wire acceptance step-defs** for `question_generation.feature` @AC-6 (missing
  listing → 422 `LISTING_REQUIRED`, no row; valid setup → 201, `profiling`, `hrCount 3`,
  `techCount 5`).
- [ ] **9. Run the `## Verification` command.**

## Definition of done
- `POST /interviews` rejects a listing-less body with 422 `LISTING_REQUIRED` and creates no
  row; a valid body returns 201 `{ interviewId, hrCount: 3, techCount: 5 }` and a
  `profiling` interview.
- `GET /interviews/:id/state` returns the resumable room-state shape; a non-owned id is 404
  `INTERVIEW_NOT_FOUND`.
- The CSRF middleware exists and is applied to every non-`GET` interview route (asserted in
  I05).

## Verification
```bash
npm run test:acceptance -- --tags "@question-generation and @AC-6"
```

## Notes

### What exists now

New: `backend/modules/interview/{ownership,csrf,setup,state,router}.ts`, mounted at
`/interviews` in `backend/src/app.ts`. `router.ts` applies `requireAuth` module-wide,
`resolveInterview` as the `:id` param middleware (404 `INTERVIEW_NOT_FOUND`, never 403 —
ADR-I11), and `requirePublicOrigin` on the one non-`GET` route so far (`POST /interviews`).
Comment slots mark where I04/I06/I07/I12 mount.

`setup.ts`: Zod body, `LISTING_REQUIRED` guard, the deterministic split (`max(2, round(t*0.4))`
/ remainder), a flat keyword→`occupation_clusters.key` table (`OCCUPATION_KEYWORDS`), the
K8.6 `EMAIL_NOT_VERIFIED` gate reading `config.EMAIL_VERIFICATION_REQUIRED` +
`req.user.email_verified_at`. `state.ts`: room-state shape per backend spec §6 (see
deviation below), resolving `currentQuestion` from the global 1..N index across the hr/tech
rounds and `persona` from the round matching `state`.

### Deviations from this task file (all deliberate)

1. **Room-state shape follows `.agents/specs/2026-07-29-backend.md` §6's jsonc exactly**,
   not this file's own summary or REFERENCE.md's prior paraphrase of it — the two disagreed
   (`question`/`hrQuestionCount`/`spentUsd`/`budgetUsd` vs `currentQuestion`/`persona`/
   `transcriptCursor`). spec.md is the wire-contract source; REFERENCE.md's HTTP contracts
   section is patched to match what's actually built. `persona`/`currentQuestion` are `null`
   until a round exists (I04 creates rounds); `avatarState` is a fixed `'idle'` placeholder
   (`ponytail:` comment in `state.ts`) until I07 drives it from SSE; `widget` is always
   `null` until I04/I06 build widget-kind questions.
2. **An `uploadId` with no `jobText` is `VALIDATION_ERROR`, not accepted.** `interviews.job_text`
   is `NOT NULL` and `uploads` has no extracted-text column (I11's contract for handing
   extracted text back to the client for re-submission doesn't exist yet). `LISTING_REQUIRED`
   still fires correctly when *both* are absent (the only case AC-6 asserts); revisit this
   validation when I11 lands and defines how extracted text reaches `POST /interviews`.
3. **Occupation heuristic is a flat first-match keyword table** (`OCCUPATION_KEYWORDS` in
   `setup.ts`) over the 9 non-`other` seeded clusters — `ponytail:` marked, promote to
   scoring only if misclassification shows up in practice.

### Infra fixes made along the way (all necessary for this task's own gate to run at all)

I03 is the first task whose step definitions import `backend/src/app.ts`, which pulls in
`backend/src/lib/env.ts`'s full Zod schema at require time. That surfaced three pre-existing
gaps, all fixed here rather than worked around:

1. **`z.coerce.boolean()` bug in `env.ts`** — `Boolean("false")` is `true` in JS, so
   `EMAIL_VERIFICATION_REQUIRED=false`, `AI_ENABLED=false` and `SESSION_COOKIE_SECURE=...`
   in `.env`/`.env.example` were silently coerced to `true`. This is exactly what broke
   AC-6 first (`EMAIL_NOT_VERIFIED` on a fresh registration with the flag "off"). Replaced
   with a `zBoolean(default)` helper (`z.string().optional().transform(v => v === 'true')`)
   for all three keys. This is a latent bug independent of I03's scope — worth flagging
   loudly since `AI_ENABLED=false` silently becoming `true` is a real-cost, real-security
   footgun for anyone who fills in provider keys locally.
2. **`cucumber.js` now loads `.env`** via `process.loadEnvFile()` (native, Node 20.6+) before
   `requireModule` runs, guarded so a missing file degrades to the existing
   `ENV_VALIDATION_FAILED` message rather than a Node `ENOENT`. Vars already in
   `process.env` win (CI's job-level `DATABASE_URL`/`SHADOW_DATABASE_URL`/`REDIS_URL` are
   never clobbered) — this only fills what CI doesn't set itself.
3. **`.github/workflows/ci.yml` → `acceptance` job now runs `cp .env.example .env`** before
   `npm run test:acceptance`, same one-liner `build`/`compose-check` already use. Without it
   the job has no `PUBLIC_ORIGIN`/`SESSION_SECRET`/`SMTP_HOST`/`MAIL_FROM`/`S3_*` and
   `env.ts` exits the process before a single scenario runs.
4. **`backend/features/step_definitions/server.ts` (new)** starts the real Express app on an
   ephemeral port for the whole cucumber run (`BeforeAll`/`AfterAll`) and — this one bit
   twice locally — its `AfterAll` now also calls `prisma.$disconnect()` and `redis.quit()`.
   Without that the scenario passes but the Node process never exits (ioredis eager-connects
   on import and never closes), which reads as a hang and would eventually time out CI even
   on green.

`backend/features/step_definitions/world.ts`'s single global `AiWorld` (ADR-I21: one World
for the whole run) gained `httpPost`/`httpGet` + a cookie jar. `ai-provider.steps.ts`'s
`the response status is {int}` step now branches on `this.lastStatus` — reused, not
duplicated, per the same "one step, shared" rule I02 established for `the HR round is
generated`.

### Known gap — not a regression, read before re-running the full suite

`question_generation.feature` is in `cucumber.js` `paths` now (required for AC-6 to be
discoverable at all, even tag-filtered), but only `@AC-6`'s steps are defined here. `@AC-7`
(profile→hr generation) and `@AC-1` (typed-count generation) are I04's scope and their
steps are genuinely undefined. Result: **`npm run test:acceptance` with no tag filter — and
therefore CI's `acceptance` job — shows 2 undefined scenarios until I04 lands** (23
scenarios, 21 passed, 2 undefined; this task's own scoped Verification, `--tags
"@question-generation and @AC-6"`, is fully green). This is the same shape as the
`cost_usd` nullable blocker I02 left for F02 — a known, documented, owned-by-the-next-task
gap, not something to route around by leaving the feature file out of `paths` (that would
just recreate the exact false-green CI pattern this project explicitly rejected).

### For I04

- `resolveCurrentQuestion`/`resolvePersona` in `state.ts` are private helpers scoped to that
  file; if `POST /profile` or `POST /answers` need the same "question at global index"
  logic, either export them or lift to a shared module rather than reimplementing the
  hr-then-tech index math.
- `httpPost`/`httpGet` on `AiWorld` (world.ts) are ready for `profile`/`answers` step defs —
  send `origin: config.PUBLIC_ORIGIN` automatically; cookie jar persists per scenario.
- `registerLimiter` (3/hour per IP) applies to the `Given I am signed in as a candidate`
  step's `POST /auth/register` call. Fine for a handful of scenarios; if profiling.feature's
  extra "signed in as <email>" scenarios push a single dev machine over 3 registrations/hour
  repeatedly, that's a test-seam question (bypass the limiter for `NODE_ENV=test`, mirroring
  `mountTestSeam`), not something to fix here pre-emptively.

### Verification output

```
$ npm run test:acceptance -- --tags "@question-generation and @AC-6"
1 scenario (1 passed)
10 steps (10 passed)
```

Full suite (documents the known I04 gap above): 23 scenarios, 21 passed, 2 undefined
(`@AC-7`, `@AC-1`).

Gates: `npm run lint` clean, `npm run typecheck` clean, `npm test` 70 passed (9 files,
unchanged by this task).
