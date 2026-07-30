# Adaptive — Decisions (append-only ADR log)

Never edit past entries. Supersede with a new dated entry referencing the one it changes.
Prefix `ADR-D` to avoid collision with foundations (`ADR-F`), auth (`ADR-A`), interview-core
(`ADR-I`) and every other ledger. Referenced back into `PLAN.md`.

---

## ADR-D01 — 2026-07-30 — A score becomes a next-question move through a pure selector behind a `Scores` validation gate

**Context:** The bonus feature (IDEA.md §12, K4) must turn an answer score into the next
question's difficulty and topic, and — the invariant — must never let a malformed score select
a graded question. Three shapes were possible: (A) a pure `selectNextQuestion(rawScore,
current)` that first validates `rawScore` against the I01 `Scores` Zod schema and returns a
`fallback` outcome on failure, otherwise applies the B5 table; (B) trust that the `AiClient`
only ever hands back a schema-valid `Scores` and select directly on `overall`; (C) throw a
typed error on an invalid score and surface it to the client as an HTTP failure.

**Decision:** (A). One pure module, `backend/modules/interview/adaptive-select.ts`, exporting
`selectNextQuestion(rawScore: unknown, current: { difficulty, topic })`. It validates against
the `Scores` schema imported from `@interviewly/ai` (I01). Invalid → `{ graded: false,
chosenReason: 'fallback' }`. Valid → the B5 table with end-clamps: 0–2 easier/same-topic
(`score_low`), 3 same/same-topic (`score_mid`), 4–5 harder/new-topic (`score_high`); `hard`+5
stays `hard` but moves topic, `easy`+0 stays `easy` on the same topic.

**Why not (B):** The invariant is precisely that a bad score must not silently pick a graded
row. Trusting the caller deletes the guard the feature exists to prove
(`adaptive_questions.feature::A malformed answer score never selects a graded next question`).
The schema is the barrier (§5.5 layer 2); the selector must sit behind it, not assume it.

**Why not (C):** A scoring hiccup must not fail the interview. §3.7 requires K4 to degrade to
the MVP path, not to break it. The answer submit still returns 200; the next question is simply
the default non-adaptive row. Throwing to the client would make a bonus feature a reliability
liability.

**Consequences:** The selection logic is a pure function — unit-provable with an assert
self-check over all five example rows, both clamps, and the malformed branch, with no DB and no
network. The `fallback` outcome carries no difficulty/topic move; the caller (D03) keeps the
default row and logs the fallback. The difficulty label never leaves this module toward the
user (K4).

---

## ADR-D02 — 2026-07-30 — The next question is realised by promoting one of three pre-generated candidates, not by rewriting a row from scratch

**Context:** The selector (ADR-D01) decides a difficulty and a topic *move* (same vs new). The
next question still needs concrete `text`/`topic`. Two mechanisms: (A) pre-generate three
candidates for slot N+1 while the user answers N (easier/same/harder via
`aiClient.generateCandidates`), store them in `questions.candidates`, and promote the one whose
difficulty matches the selector's target; (B) at scoring time, rewrite the next row's
`difficulty`/`topic` directly and ask the model for one fresh question inline.

**Decision:** (A), the K4 mechanism IDEA.md §3.7 mandates. `candidate-prep.ts` (D02) calls
`generateCandidates` during the turn and persists three candidates into the existing N+1
`questions.candidates` column; `promote` (D03) selects one by difficulty and copies its
`text`/`topic` onto the row.

**Why not (B):** A "harder, new-topic" pick needs a question that *already carries* a new
topic and text. Generating it inline at scoring time puts an LLM call on the critical path
between answers — the exact per-question latency §3.7 pre-generation exists to remove. §3.7
also fixes that "rows are never inserted or deleted mid-round"; promotion rewrites an existing
row's content, which (B) also does, but (A) keeps the model call off the answer→next-question
path.

**Consequences:** No migration — `questions.candidates` is an F02 column. The two unpromoted
candidates remain in the JSON for a future admin-analysis view (Backlog; unread today). Under
`AI_ENABLED=false` the `StubAiClient` (I01) returns three canned schema-valid candidates, so a
teammate with no provider key still drives an adaptive interview. Pre-generation is a
mechanical call over the seam — it interprets no score and runs at the moderate model tier.

---

## ADR-D03 — 2026-07-30 — Adaptive attaches as an additive post-record hook in I06's answer handler; fallback preserves the MVP path

**Context:** The score arrives at `POST /interviews/:id/answers`, owned by I06. Adaptive must
run *after* the answer is recorded and the guarded advance has happened. Options: (A) an
additive hook inside I06's `answers.ts` at a marked slot — score, select (D01), promote (D02's
candidates); on a malformed score, do nothing adaptive and keep the default next row; (B) a
separate adaptive route the client calls after submitting; (C) fork the state machine so an
adaptive interview walks a different transition table.

**Decision:** (A). The adaptive hook runs at the slot I06 leaves after the answer + transcript
write and the `current_index` advance. On a graded score it promotes a candidate and sets
`chosen_reason`; on a malformed score it logs `LLM_FALLBACK_TRIGGERED`, hands back no score,
leaves the default next row, and sets `chosen_reason = 'fallback'`. The answer submit returns
200 either way.

**Why not (B):** A second round trip adds a state where the next question is undecided between
submit and the adaptive call — a resume/refresh in that window (§3.8) would find an
inconsistent room. One handler keeps submit → next-question atomic from the client's view.

**Why not (C):** §3.7 is explicit that "MVP and post-K4 share a schema, and the K4 ledger
cannot break the MVP ledger." A forked state machine is a second code path that can drift from
the MVP one and is the regression the invariant forbids. An additive hook that degrades to the
MVP default row cannot break the base flow: with adaptive removed, the default next row is
exactly what I06 already produces.

**Consequences:** Removing or disabling the adaptive hook leaves a working MVP interview — the
default next row is the I06 behaviour. The malformed-score fallback is the same default row,
so the guard is "do nothing adaptive," the safest possible failure. `@adaptive-questions`
(both `@AC-12` scenarios) is the acceptance gate this hook greens.
