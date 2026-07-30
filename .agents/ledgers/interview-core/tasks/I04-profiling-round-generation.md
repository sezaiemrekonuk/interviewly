# I04 — Profiling + round question generation (HR batch, tech batch during HR)
REPO: (this repo) · Depends: I02, I03 · Status: todo
Read first: STATE.md, REFERENCE.md, then this.
**Model: claude-opus-4.8** — the candidate profile and job listing reach the LLM here, through the I01 injection boundary; the schema-failure semantics (no rows handed back on a bad batch) and the batch-timing rule are subtle and cost-bearing.

## Goal
Owner's ask:

> "`POST /interviews/:id/profile` (and skip) transitioning `profiling → hr_round`, HR batch
> generation inserting questions 1..hr, the technical batch generated *during* the HR round,
> and a schema-invalid batch handing back no rows as `AI_OUTPUT_INVALID`. Scenarios AC-2
> (profiling), AC-7 (HR generation) and AC-1 (round count) green."
> — interview-core decomposition (§3.7, ADR-I07)

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
  builder's job; this task passes `profile = null` on skip.
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
- [ ] **1. Write `generation.ts`** — count resolution, `AiClient` call, length assertion,
  1..count insert, `HR_BATCH_REQUESTED`/`TECH_BATCH_REQUESTED` logs, tech-after-HR trigger.
- [ ] **2. Write `profile.ts`** — Zod body, `profiling`-only guard, store/skip profile,
  transition, invoke generation, 200.
- [ ] **3. Wire `/profile`** into the I03 router behind ownership + CSRF.
- [ ] **4. Handle the failure edges** — schema failure → `AI_OUTPUT_INVALID` no rows;
  provider-unavailable → `paused`.
- [ ] **5. Wire acceptance step-defs** for `profiling.feature` @AC-2 (skip → `no profile
  provided`; answered → profile in block), `question_generation.feature` @AC-7 (non-profiling
  → 409, no HR rows; profiling → exactly 3 HR ordered 1..3, tech empty, prompt name recorded)
  and @AC-1 (count mismatch → no rows + `AI_OUTPUT_INVALID`; valid batch → exactly 5 tech
  ordered 1..5, typed).
- [ ] **6. Run the `## Verification` command.**

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
_(fill in when the task is done)_
