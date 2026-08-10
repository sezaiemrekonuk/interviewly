---
task: C02
author: Sezai
sessions: [2026-08-10]
model: claude-opus-5
model_recommended: claude-opus-5
iterations: 1
tools: [claude-code, subagents]
---

## Session 1 — 2026-08-10

### What I asked for / what came back
- New prompt lineage `interview.conduct.turn` (v1, `gpt-4.1-mini`, 500 max tokens) and
  `ConductorTurnSchema` — `{say, action, question?, endReason?, widget?}` through the same
  layer-2 Zod gate every other call in the package passes.
- `AiClient.conductTurn` on the seam, implemented in `LiveAiClient`, `StubAiClient` and
  `StubRecordingClient`. `TIMEOUT_MS.conductTurn = 10_000`, deliberately shorter than the 15 s
  the other interactive calls get.
- `backend/modules/interview/conductor.ts` — the turn loop, the five guards, the drift ceiling,
  the answer window, and the degradation path. `POST /interviews/:id/turns` in `turns.ts`.
- `recordAnswer` extracted in `answers.ts` so both progression paths share ADR-I06's CAS.
- `personas.system_prompt`, seeded since F02 and read by nothing, is now the conductor's brief.

### Methodology trace
- The guard list came out of the design conversation, not out of the implementation: the model's
  action is derived from candidate text and mutates interview state, so it is untrusted input in
  the §7.1 sense. `injection-patterns.yaml` guards prompt *variables*; nothing guarded *actions*.
- Chose JSON over provider-native tool calling before writing any of it (ADR-C02). ADR-I02 keeps
  every provider SDK out of this repo — both transports are one hand-rolled `fetch`, so native
  tools would have to be built and kept in step twice, in two wire formats, for a capability
  this call never needs.

### Friction — three that cost real time
- **The opening turn has no question to advance past.** First cut treated every conductor reply
  as "close the current question and open the next", which made the welcome consume question 1.
  Resolved with a rule that needs no schema: *the first assistant message carrying a question's
  id is the asking of it*. When the row is unasked the turn writes the wording and does not
  advance, whatever action came back, and the recorded action is `continue` because that is what
  happened to the index — nothing.
- **Early handover desynchronises the round.** `currentQuestionRow` picks the round by comparing
  `current_index` against `hr_question_count`. A handover at question 3 of 5 left the state
  saying `tech_round` while the index still pointed inside the HR block, so the *technical*
  interviewer asked HR questions. The handover now jumps the index to `hr_question_count + 1`
  under the same CAS, and the skipped rows are simply left behind — C03 tells the report.
- **`await` inside the budget lock.** `withBudget` holds a `pg_advisory_xact_lock` for the whole
  callback. The first draft resolved `remainingTopics` inside it, which sits on the interview's
  own lock. Hoisted above, with a comment saying why.

### What I rejected and rewrote by hand
- Rejected deleting D01–D03. The ledger owner's instruction was to keep adaptive question
  generation, and there is a reading that costs nothing: K4 no longer decides *wording* (the
  conductor has the whole conversation, which beats three pre-generated candidates), but it
  still scores for the report and still supplies the next row's text on the fallback and drift
  paths. Adaptive became the degradation path rather than dead code. Recorded as ADR-C05.
- Rewrote the drift clamp by hand after the first version rewrote `end_interview` and `handover`
  into a forced advance. Drift exists to stop an interviewer circling one question; applying it
  to an action that already leaves the question would have *resurrected an interview the
  interviewer had just ended*. Pinned by a test named for exactly that.
- Rewrote history trimming. The prompt builder truncates an over-long block with
  `slice(0, MAX_BLOCK_CHARS)` — which keeps the *oldest* text and throws away the exchange the
  interviewer has to reply to. Trimming now happens in `conductor.ts`, from the front, and marks
  the gap so the interviewer knows it is missing the start.

### Verification (verbatim)
- `npm test -- --project node conductor` → `Test Files 1 passed (1)`, `Tests 15 passed (15)`.
- `npm test -- --project node` → `Test Files 38 passed (38)`, `Tests 328 passed (328)`.
- `npm run typecheck` clean · `npm run lint` clean.
- Guard coverage is pure-function: `mayHandOver`, `mayEnd`, `clampAction`, `trimHistory` via a
  `__testing` export — no DB, no network, which is what makes them provable at all.

### Follow-up left for the ledger (non-blocking)
- No streaming. The reply arrives whole, and it is the one call a candidate waits on with
  nothing on screen; the 10 s timeout is a mitigation, not a fix. Token streaming is the next
  real latency win.
- `promoteNextQuestion` is still awaited inside the turn, as it was inside `advanceWithAnswer`.
  No regression, but it is now the largest single cost on an advancing turn.
