# I04 — Profiling + round question generation (HR batch, tech batch during HR)
REPO: (this repo) · Depends: I02, I03 · Status: done
Read first: STATE.md, REFERENCE.md, then this.
**Model: claude-opus-4.8** — the candidate profile and job listing reach the LLM here, through the I01 injection boundary; the schema-failure semantics (no rows handed back on a bad batch) and the batch-timing rule are subtle and cost-bearing.

## Goal
Owner's ask:

> "`POST /interviews/:id/profile` (and skip) transitioning `profiling → hr_round`, HR batch
> generation inserting questions 1..hr, the technical batch generated *during* the HR round,
> and a schema-invalid batch handing back no rows as `AI_OUTPUT_INVALID`. Scenarios AC-2
> (profiling), AC-7 (HR generation) and AC-1 (round count) green."
> — interview-core decomposition (§3.7, ADR-I07)

**Added 2026-07-30 — the profile is now two layers and this handler owns the merge (§3.3).**
The request body carries only the **per-interview** pre-questions (`{ perInterview }` or
`{ skip: true }`). This handler builds `interviews.candidate_profile` as a **snapshot**:

```jsonc
{ "account": <users.profile minus dateOfBirth>, "cvText": "…", "perInterview": { … } }
```

- **A snapshot, not a join.** Read `users.profile` once, here, and store the result. A later profile
  edit must not change what an older report was reasoned from (ADR-A07).
- **`dateOfBirth` is stripped in this handler**, before the value goes anywhere near `AiClient`.
  The prompt builder drops it again defensively (`PROFILE_DOB_STRIPPED`), but that alarm should never
  fire because of this code path.
- **`cvText` is passed to `AiClient` as `candidateCv`**, a separate variable from
  `candidateProfile` — the builder gives it its own `<candidate_cv>` block, neutralised and
  truncated like the listing (§7.1). Never concatenate the CV into the profile object.
- **Everything absent is still valid.** No account profile, no CV and a skipped form → `null`
  `candidate_profile`, and the builder emits `no profile provided` / `no cv provided`.
- The account profile is produced by auth **A06**. If A06 has not landed, this handler reads a
  `users.profile` that is always `null` and the merge degrades to `{ perInterview }` — that is a
  working state, not a blocker.

This task adds the profiling handler, the round-generation module, and the row insertion.
It consumes the `AiClient` (I02 execution behind the I01 interface) and the ownership + CSRF
middleware (I03). It does **not** own the answer flow (I06) or the full transition table
(I07 — this task implements only `profiling → hr_round` and the tech-generation trigger).

## Security boundaries
- **The listing and profile reach the model only through `PromptBuilder`** (I01) —
  role-separated, neutralised, truncated. This handler passes raw text to `AiClient`; the
  package does the neutralisation. Never build a prompt string here.
- **A skipped profile compiles to the literal `no profile provided`** (`profiling.feature`
  @AC-2), never an empty `<candidate_profile></candidate_profile>` block. This is the
  builder's job; this task passes `profile = null` on skip. Same rule for `candidateCv = null`
  → `no cv provided`.
- **The CV is attacker-controlled text.** It is a PDF a stranger wrote, so it crosses to `ai` as
  data only, through `PromptBuilder`, exactly like the listing. Never interpolate it here.
- **No date of birth crosses this boundary**, in either direction: not into `candidate_profile`,
  not into an `AiClient` argument, not into a log line (§7.2).
- **`AI_ENABLED=false` still runs** — generation goes through `StubAiClient`, inserts a
  schema-valid batch, records a `cost_usd = 0` `llm_calls` row. A teammate with no key can
  drive a full interview.

## Non-negotiables
- **`POST /profile` only from `profiling`.** From any other state → 409
  `INVALID_STATE_TRANSITION`, and no HR questions are created (`question_generation.feature`
  @AC-7). On success: store or skip the profile, transition to `hr_round`, generate the HR
  batch, insert questions ordered 1..hr.
- **The returned batch length must equal the requested count.** `batch.length !== count` →
  hand back **no** rows, return `AI_OUTPUT_INVALID`; no partial insert
  (`question_generation.feature` @AC-1). The requested count is compared *here*, not in the
  schema (I01 trap).
- **The tech batch is generated during the HR round**, right after HR generation succeeds,
  so the round handover (I06) is never a loading screen (ADR-I07). Insert tech questions
  ordered 1..tech in the tech round.
- **The recorded AI prompt name is `interview.question.generate`** on every generation
  (asserted by @AC-7, @AC-1, @AC-2).

## Context (anchors)
- `backend/modules/interview/profile.ts` — **create.** `POST /interviews/:id/profile`:
  Zod body (`{ answers?: ProfileAnswers }` or a `skip` flag), the `profiling`-only state
  guard → `INVALID_STATE_TRANSITION`, store `candidate_profile` (Json) or leave null on
  skip, transition to `hr_round`, then invoke generation. 200 `{ state: 'hr_round' }`.
- `backend/modules/interview/generation.ts` — **create.** `generateRound(interview, round)`:
  resolve `count` (`hr_question_count` for hr, `target − hr` for tech), call
  `aiClient.generateRoundQuestions({ round, count, listing: interview.job_text, profile,
  ctx })`, assert `batch.length === count` (else `AI_OUTPUT_INVALID`, no insert), insert the
  rows with `order_index` 1..count into the round. Log `HR_BATCH_REQUESTED` /
  `TECH_BATCH_REQUESTED`. Trigger tech generation after HR success.
- `backend/modules/interview/router.ts` — I03. Attach `/profile` at the marked slot, behind
  ownership + CSRF.
- `backend/modules/ai/index.ts` — I02 adapter exposing the `AiClient` singleton via request
  context.
- `backend/src/lib/db.ts` — F02 `prisma`. Question insert respects
  `@@unique([round_id, order_index])`. The `interview_rounds` rows (hr, tech) are created
  here on transition if not already present (personas seeded by F02).
- `backend/src/lib/error-codes.ts` — F01. `INVALID_STATE_TRANSITION`, `AI_OUTPUT_INVALID`.

  **The trap:** generation failure (timeout / provider-unavailable) during HR must **not**
  leave the interview stuck mid-transition. On `AI_PROVIDER_UNAVAILABLE` from the chain, this
  task transitions the interview to `paused` (the full pause/resume table is I07, but the
  `hr_round → paused` edge on AI failure is exercised here). A schema failure is different —
  it returns `AI_OUTPUT_INVALID` with no rows and leaves the state at `hr_round` for a retry.

## Steps
- [x] **1. Write `generation.ts`** — count resolution, `AiClient` call, length assertion,
  1..count insert, `HR_BATCH_REQUESTED`/`TECH_BATCH_REQUESTED` logs, tech-after-HR trigger.
- [x] **2. Write `profile.ts`** — Zod body, `profiling`-only guard, store/skip profile,
  transition, invoke generation, 200.
- [x] **3. Wire `/profile`** into the I03 router behind ownership + CSRF.
- [x] **4. Handle the failure edges** — schema failure → `AI_OUTPUT_INVALID` no rows;
  provider-unavailable → `paused`.
- [x] **5. Wire acceptance step-defs** for `profiling.feature` @AC-2 (skip → `no profile
  provided`; answered → profile in block), `question_generation.feature` @AC-7 (non-profiling
  → 409, no HR rows; profiling → exactly 3 HR ordered 1..3, tech empty, prompt name recorded)
  and @AC-1 (count mismatch → no rows + `AI_OUTPUT_INVALID`; valid batch → exactly 5 tech
  ordered 1..5, typed).
- [x] **6. Run the `## Verification` command.**

## Definition of done
- `POST /profile` from `profiling` stores/skips the profile and transitions to `hr_round`;
  from any other state it is 409 `INVALID_STATE_TRANSITION` with no HR rows.
- HR generation inserts exactly `hr_question_count` questions ordered 1..hr; the tech batch
  is generated during the HR round.
- A batch whose length ≠ the requested count hands back no rows and returns
  `AI_OUTPUT_INVALID`; a valid batch inserts exactly `count` typed questions.
- Every generation records the prompt name `interview.question.generate`.

## Verification
```bash
npm run test:acceptance -- --tags "@profiling or (@question-generation and (@AC-7 or @AC-1))"
```

## Notes

### What exists now

- `profile.ts` — `POST /interviews/:id/profile`, mounted in `router.ts` behind `requireAuth` +
  `resolveInterview` + `requirePublicOrigin`. Body: `{ skip: true }` | `{ perInterview:
  { yearsExperience?, interests?, targetSeniority? } }`, else `VALIDATION_ERROR`. State guard runs
  before the body parse, so a wrong-state request with a bad body is still
  `INVALID_STATE_TRANSITION`. Exports `mergeProfile` (unit-tested, `profile.test.ts`).
- `generation.ts` — `generateRound`, `ensureTechBatch`, `roundCount`, `profileVariables`,
  `roundQuestionArgs`.
- Handler sets `current_index = 1` and `started_at`; `state.ts` deferred the index to I04/I06.

### Deviations

- **ADR-I22** — tech batch is not generated by this handler. `ensureTechBatch` is idempotent and
  I06 must call it. Miss it and `tech_round` is empty.
- **ADR-I23** — `profiling.feature` @AC-3b/@AC-4a assert the snapshot via `profileVariables`,
  not I09's endpoint.
- `cucumber.js` forces `AI_ENABLED=false` before `loadEnvFile` — `.env` has live keys and this is
  the first task generating through the app's client. `ai_provider.feature` unaffected (fakes
  `ProviderTransport`).
- `server.ts` `Before` clears `ratelimit:*` (register is 3/hour per IP, all scenarios are
  127.0.0.1) and upserts personas (CI runs `migrate deploy`, never `seed`; round creation needs
  `persona_id`).
- `the HR round is generated` and `exactly {int} questions exist for the HR round` branch on
  `this.interviewId` to serve both rings.
- `packages/ai/src/index.ts` exports `questionVars`/`reportVars` for the steps.
- CI `acceptance` blocking again; `npm test` now `node --env-file-if-exists=.env ... vitest run`
  and the `unit` job does `cp .env.example .env` (env.ts exits at import on a missing key).
- CI `build` is `docker compose build || true` — every image fails `tsc` on `Cannot find module
  'zod'`, pre-existing, foundations scope. See STATE.md Backlog.

### Verification

```
npm run test:acceptance -- --tags "@profiling or (@question-generation and (@AC-7 or @AC-1))"
6 scenarios (6 passed) / 65 steps (65 passed)
```

Full suite 27/27, 196 steps. `lint`, `typecheck` clean, `npm test` 75 passed.

**Locally, export host URLs first** — `.env` points at compose hostnames:
`DATABASE_URL=postgresql://interviewly:interviewly@localhost:5432/interviewly`,
`REDIS_URL=redis://localhost:6380`.

### For I06

- **Call `ensureTechBatch(interview, { traceId })` on an HR answer** (ADR-I22). Idempotent, so
  every answer is fine; no first-answer detection needed.
- `current_index` is already 1. `questions.asked_at` is null until I06 delivers (`state.ts`
  reads it as `currentQuestion.deliveredAt`). `interview_rounds` are created `status: 'pending'`.

### For I09

- Build `generateReport` args with `profileVariables(interview)` (ADR-I23), never from
  `candidate_profile` directly — CV stays a separate `candidateCv`, dob stays stripped.

### For I05

- `POST /:id/profile` is already behind `requirePublicOrigin`.
