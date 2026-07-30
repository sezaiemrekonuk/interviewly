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
_(fill in when the task is done)_
