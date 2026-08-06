# D02 — Next-question candidate pre-generation during a turn
REPO: (this repo) · Depends: F01, F02, I01, I02, I04 · Status: todo
Read first: STATE.md, REFERENCE.md, then this.
**Model: claude-sonnet-4.6** — mechanical wiring over the `generateCandidates` seam; it interprets no score and introduces no trust boundary. If an edge case appears, run sonnet and code-review the diff with `claude-opus-4.8` — cheaper than running the whole task expensive.

## Goal
Owner's ask:

> "the answer-score-driven next-question selection (difficulty + topic adaptation)."
> — adaptive ledger owner brief (the K4 §3.7 mechanism: candidates are pre-generated so the
> next question is ready without a mid-round LLM call)

This task creates `backend/modules/interview/candidate-prep.ts`, exporting
`prepareNextCandidates({ interview, currentQuestion, ctx })`. During a turn it calls
`aiClient.generateCandidates({ slot, ctx })` (I01 interface, I02 execution) and persists the
three returned candidates (easier / same / harder) into the N+1 `questions.candidates` column
(F02). It does **not** score or promote — D01 decides which candidate to pick and D03 promotes
it. After this task, D03 can read `questions.candidates` for the next row and promote one by
difficulty.

## Security boundaries
- **AI calls only through `AiClient`** (the I02 adapter in request context). Never import a
  provider SDK; never re-implement `generateCandidates`. The stub path must work with no key.
- **No candidate text in any log line.** `QUESTION_CANDIDATES_GENERATED` logs `interviewId`,
  `questionId`, and the count/difficulties — never the question text (K6, §7.2).
- **Persist only into the existing N+1 row's `candidates` column.** Insert no new question
  row and delete none (§3.7: "rows are never inserted or deleted mid-round").

## Non-negotiables
- Runs identically under `AI_ENABLED=false`: `StubAiClient` returns three canned schema-valid
  candidates, cost 0. A teammate with no provider key drives an adaptive interview.
- The three candidates carry the three difficulty tiers the selector may ask for (one easier,
  one same, one harder than `currentQuestion.difficulty`) so D03 always finds a match; at
  least one carries a **new** topic (for the `score_high` path) and at least one the **same**
  topic.

## Context (anchors)
- `packages/ai/src/AiClient.ts` — I01. `generateCandidates({ slot, ctx })` → `Candidate[]`.
  `Candidate = { text, difficulty: 'easy'|'medium'|'hard', topic }` (I01 schema).
- `packages/ai/src/stub.ts` — I01. `StubAiClient.generateCandidates` returns the canned
  three; the self-check runs against this, no provider.
- `backend/modules/ai/index.ts` — I02. The adapter that binds `AiClient` into request
  context, records the `llm_calls` row and cost. Get the client from here / request context,
  never construct a provider.
- `backend/modules/interview/generation.ts` — I04. The base round generation; reuse its
  `ctx` assembly (prior questions, topics used, locale) rather than re-deriving it. Read it
  before writing the `slot`/`ctx` payload so the shape matches.
- `backend/prisma/schema.prisma` — F02. `questions.candidates Json`. The N+1 row is the next
  unasked question in the round; resolve it the way I06/I04 already do (per-round
  `order_index`; see REFERENCE.md "The next unasked row"). Do not re-derive the index math.
- `backend/src/lib/logger.ts` — F03. `logger.info({ traceId, interviewId, questionId, count,
  difficulties }, 'QUESTION_CANDIDATES_GENERATED')`.

  **The trap:** the "next unasked row" is per-round `order_index`, not the global
  `current_index`. In the tech round `current_index = hr_question_count + order_index`.
  Resolve the N+1 row through the existing I06/I04 helper — computing it inline here is how
  you write candidates onto the wrong row.

## Steps
- [x] **1. Create `backend/modules/interview/candidate-prep.ts`**
  - `prepareNextCandidates({ interview, currentQuestion, ctx })`:
    - Build the `slot` payload (next `order_index` within the current round, prior question,
      topics already used) reusing I04's `ctx` assembly.
    - `const candidates = await aiClient.generateCandidates({ slot, ctx });`
    - Resolve the N+1 `questions` row via the existing helper; `prisma.question.update({
      where: { id: nextRow.id }, data: { candidates } })`.
    - `logger.info({ traceId, interviewId: interview.id, questionId: nextRow.id, count:
      candidates.length, difficulties: candidates.map(c => c.difficulty) },
      'QUESTION_CANDIDATES_GENERATED')`.
    - Return the persisted `candidates` (so D03 need not re-read if it already has them).
- [x] **2. Create `backend/modules/interview/candidate-prep.selftest.ts`**
  - Plain Node asserts, `StubAiClient` directly (no DB, no HTTP — the DB persistence is
    exercised end-to-end by D03's acceptance run; here we prove the assembly + shape).
  - Assert `StubAiClient.generateCandidates` returns exactly three candidates whose
    difficulties cover easier/same/harder relative to a `medium` current question.
  - Assert at least one candidate carries a **new** topic and at least one the **same** topic
    as the current question.
  - Assert each candidate parses against the `Candidate` schema (I01).
  - `console.log('candidate-prep selftest OK')`; exit 0 on success, non-zero on any assert.
- [x] **3. Run the Verification command; confirm it exits 0.**

## Definition of done
- `prepareNextCandidates` calls `generateCandidates` through the `AiClient` seam only and
  persists exactly three candidates into the N+1 row's `candidates` column, on the correct
  per-round row.
- The three candidates span easier/same/harder and include both a same-topic and a new-topic
  option, so D03's selector always finds a promotable match.
- Works under `AI_ENABLED=false` via `StubAiClient` at cost 0; no provider SDK imported.
- `QUESTION_CANDIDATES_GENERATED` logs metadata only — no candidate text.
- `npx tsx backend/modules/interview/candidate-prep.selftest.ts` exits 0 printing
  `candidate-prep selftest OK`.

## Verification
```bash
npx tsx backend/modules/interview/candidate-prep.selftest.ts
```

Expected output: `candidate-prep selftest OK`, exit code 0. Any assertion failure exits
non-zero — fix the code, never the assert. End-to-end DB persistence is confirmed by D03's
`@adaptive-questions` acceptance run.

## Notes

- `prepareNextCandidates({ interview, currentQuestion, ctx, client? })` — `client` is
  injectable for tests; defaults to `aiClient()` from `modules/ai/index.ts`.
- N+1 row resolved via `currentQuestionRow({ ...interview, current_index: interview.current_index + 1 })`
  — reuses state.ts helper; avoids re-deriving per-round order math.
- `priorScore: 3` (midpoint default) — D02 does not score; D01/D03 select by difficulty, not score.
- `topicsUsed` queried from asked questions (`asked_at: { not: null }`) across all rounds of the interview.
- Selftest calls `StubAiClient.generateCandidates` directly (no DB); stub returns `['easy','medium','hard']`
  with topics `['stub-topic-1','stub-topic-1','stub-new-topic']` — covers easier/same/harder + same/new topic.
- Selftest wrapped in async IIFE (backend tsconfig is CommonJS, top-level await forbidden).
- Output: `candidate-prep selftest OK`, exit 0. typecheck + eslint clean.
- **For D03:** candidates are at `questions.candidates` on the N+1 row after `prepareNextCandidates`.
  D03 reads that row's `candidates` JSON, uses D01's `selectNextQuestion` result's `difficulty` to
  pick the matching candidate, and rewrites `text/difficulty/topic/chosen_reason` on that row.

### Amended 2026-08-06 (issue #148)

- The signature is now `prepareNextCandidates({ interview: { id, language }, nextQuestionId,
  currentQuestion, ctx, client? })`. It no longer resolves the N+1 row: D03 is the only caller
  and has already resolved it — to read `chosen_reason` and to promote into it — so re-deriving
  the per-round `order_index` here was a second copy of the index math the "trap" note warns
  about, and a second query per turn.
- The old caller in `language.ts` is gone. It was the only one, and it refused to run unless
  `candidates` was already written, so nothing ever wrote a first pool — see D03's amendment.
- "Pre-generation" is relative to the promotion, not to the turn: it runs during the turn that
  answers question N, for the row that turn promotes. There is no earlier moment — the pool has
  to reflect an I10 language switch landing on the same turn, and a pool built a turn ahead
  would target a row whose difficulty the previous promotion had not yet decided.
