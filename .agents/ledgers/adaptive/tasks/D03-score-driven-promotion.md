# D03 — Score-driven promotion and malformed-score fallback (greens `@adaptive-questions`)
REPO: (this repo) · Depends: D01, D02, I02, I06 · Status: todo
Read first: STATE.md, REFERENCE.md, then this.
**Model: claude-opus-4.8** — the malformed-score fallback branch **is** the ledger invariant; a wrong guard here lets a bad score drive a graded question. A cheaper model has silently promoted on unvalidated input on similar AI-trust tasks.

## Goal
Owner's ask:

> "the answer-score-driven next-question selection (difficulty + topic adaptation). This is a
> bonus feature and must **block nothing**."
> — adaptive ledger owner brief

This task wires the adaptive hook into I06's `backend/modules/interview/answers.ts` at the
marked adaptive slot. On answer submit, **after** I06 records the answer and does the guarded
advance, it scores the answer via `aiClient.scoreAnswer` (I01 seam / I02 execution), runs
`selectNextQuestion` (D01), and — on a graded result — promotes the matching D02 candidate
into the next unasked `questions` row (`text`, `difficulty`, `topic`) and sets `chosen_reason`.
On a malformed score it triggers the fallback: no score handed back, `LLM_FALLBACK_TRIGGERED`
logged, the default next row kept, `chosen_reason = 'fallback'`. The submit returns **200 in
both cases**. This is the task that greens `@adaptive-questions` (both `@AC-12` scenarios).

## Security boundaries
- **The invariant:** a score that fails the `Scores` schema (surfaced by D01's `graded:
  false`) must **never** promote a candidate. It keeps the default next row, sets
  `chosen_reason = 'fallback'`, logs `LLM_FALLBACK_TRIGGERED`, and returns 200. Never throw
  to the client; never promote on unvalidated input.
- **AI calls only through `AiClient`** (I02 adapter in request context). Never import a
  provider SDK; never re-implement `scoreAnswer`.
- **No transcript, answer text, question/candidate text, or score `reasons` in any log**
  (K6, §7.2). Log `interviewId`, `questionId`, `chosen_reason` — never content.
- **Additive only:** the hook sits at I06's marked slot after the answer + transcript write
  and the `current_index` advance. Remove the hook → a working MVP interview remains (the
  default next row is exactly what I06 produces). Do not fork the state machine (ADR-D03).
- **The difficulty label is never surfaced to the user** (K4) — it lives on the `questions`
  row for admin/audit only.

## Non-negotiables
- The default next row (the one I06 already produces) is the fallback. Promotion **rewrites**
  that same row's `text`/`difficulty`/`topic`; it never inserts or deletes a row (§3.7).
- Promotion picks the D02 candidate whose `difficulty` equals D01's returned `difficulty`;
  `topicMove: 'new'` selects the new-topic candidate, `'same'` the same-topic one.
- Idempotent within a turn: a resume/refresh in the submit window (§3.8) must not double-score
  or double-promote — guard on the row already carrying a `chosen_reason` for this turn.

## Context (anchors)
- `backend/modules/interview/answers.ts` — I06. The `POST /interviews/:id/answers` handler
  with the **marked adaptive-hook slot** (a comment I06 left after the answer record +
  advance). Attach here; read the surrounding handler so you call the score after the
  advance, not before. Reuse I06's next-row resolution helper — do not re-derive the index.
- `backend/modules/interview/adaptive-select.ts` — **D01**. `selectNextQuestion(rawScore,
  current)` → the discriminated union you branch on (`graded` false → fallback; true →
  `difficulty`/`topicMove`/`chosenReason`).
- `backend/modules/interview/candidate-prep.ts` — **D02**. The candidates live in the next
  row's `questions.candidates`; match one by `difficulty` + topic.
- `packages/ai/src/AiClient.ts` — I01. `scoreAnswer({ question, answer, ctx })` → `Scores`.
  Pass its raw result into `selectNextQuestion` — **D01 owns the validation**; do not
  pre-validate or pre-read `overall` here.
- `backend/modules/ai/index.ts` — I02. The execution layer that records the `llm_calls` row
  and **emits `LLM_FALLBACK_TRIGGERED`** on a provider fallback. Your handler also logs
  `LLM_FALLBACK_TRIGGERED` on the *schema-invalid-score* fallback (the D01 `graded: false`
  branch) — that is the event the malformed-score scenario asserts.
- `backend/prisma/schema.prisma` — F02. Update `questions.text`/`difficulty`/`topic`/
  `chosen_reason` on the next row; `chosen_reason` uses the `ChosenReason` enum.
- `.agents/features/adaptive_questions.feature` — the two `@AC-12` scenarios this greens.

  **The trap:** call `scoreAnswer` and hand the **raw** result to `selectNextQuestion`. If
  you `Scores.parse()` it yourself first and it throws, you've turned the invariant's
  fallback into a 500. The whole point of D01's guard is that the malformed score flows
  through as data, not as an exception.

## Steps
- [ ] **1. Confirm the D02 candidates exist for the next row.** Adaptive pre-generation
  (D02) must have run earlier in the turn; if the next row has no `candidates`, treat it as
  the fallback path (keep default row) — never block the submit.
- [ ] **2. At I06's marked adaptive slot in `answers.ts`, after the answer record + advance:**
  - `const raw = await aiClient.scoreAnswer({ question, answer, ctx });`
  - `const move = selectNextQuestion(raw, { difficulty: current.difficulty, topic: current.topic });`
- [ ] **3. Graded branch (`move.graded === true`):**
  - Resolve the next unasked row via I06's helper.
  - Pick the candidate from `nextRow.candidates` matching `move.difficulty` and
    `move.topicMove` (new vs same topic).
  - `prisma.question.update({ where: { id: nextRow.id }, data: { text: cand.text,
    difficulty: move.difficulty, topic: cand.topic, chosen_reason: move.chosenReason } })`.
  - `logger.info({ traceId, interviewId, questionId: nextRow.id, chosenReason:
    move.chosenReason }, 'ADAPTIVE_QUESTION_PROMOTED')`.
- [ ] **4. Fallback branch (`move.graded === false`):**
  - Do **not** promote. `prisma.question.update({ where: { id: nextRow.id }, data: {
    chosen_reason: 'fallback' } })` (default text/difficulty/topic untouched).
  - `logger.warn({ traceId, interviewId, questionId: nextRow.id }, 'LLM_FALLBACK_TRIGGERED')`.
- [ ] **5. Return 200 in both branches** with I06's existing response shape (`{ state,
  nextIndex }`). The adaptive outcome changes the next row's content, not the status code.
- [ ] **6. Idempotency guard:** if the next row already has a `chosen_reason` for this turn,
  skip re-scoring/re-promoting (resume/refresh safety, §3.8).
- [ ] **7. Wire the Cucumber step definitions** for `adaptive_questions.feature` if not
  already present (`tests/step-definitions/adaptive.ts`) — HTTP against the running api,
  stubbed AI. The score Outline drives the graded rows; the malformed scenario sends a stub
  score with `overall: 9` and asserts the default (non-graded) next question + a 200.
- [ ] **8. Run the Verification command; confirm both `@AC-12` scenarios green.**

## Definition of done
- Submitting an answer with a graded score promotes the next row to the selector's
  difficulty + topic and sets the matching `chosen_reason` (`score_low`/`mid`/`high`) — the
  score-driven Scenario Outline passes.
- Submitting an answer whose stub score is schema-invalid (`overall: 9`) keeps the default
  next question, sets `chosen_reason = 'fallback'`, logs `LLM_FALLBACK_TRIGGERED`, and still
  returns 200 — the malformed-score scenario passes.
- No row is inserted or deleted; only the existing next row's content is rewritten.
- No answer/question/candidate text or score `reasons` in any log line.
- Removing the adaptive hook leaves a working MVP interview (the default next row).
- `npm run test:acceptance -- --tags "@adaptive-questions"` exits 0 with both `@AC-12`
  scenarios passing.

## Verification
```bash
npm run test:acceptance -- --tags "@adaptive-questions"
```

Expected output: both scenarios pass, zero failures, zero pending. If the malformed-score
scenario fails, the invariant is broken — fix the guard, never the scenario. Then confirm no
content leaks:
```bash
docker compose logs api | grep -E "reasons|answer.*text|candidate.*text"
# Must print nothing
```

## Notes

(Empty until the task is done. Fill with: what actually happened, the exact I06 slot the
hook attached to, how the next-row helper was reused, the candidate-matching logic used,
whether step definitions were created and where, the idempotency guard chosen, the Cucumber
output verbatim, and a note confirming the MVP path survives with the hook removed.)
