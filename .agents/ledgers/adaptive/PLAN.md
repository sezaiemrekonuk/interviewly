# Adaptive — PLAN (Architecture)

Written once. Amend only via a new `DECISIONS.md` ADR-D entry referenced here.
Codebase orientation: `REFERENCE.md` (read that before touching any task).

## Goal

When this ships, the answer a user gives to the current question changes the *next*
question. A validated `scoreAnswer` result drives a deterministic move: a weak answer earns
an easier follow-up on the same topic, a middling answer stays level, a strong answer earns a
harder question on a new topic. The three pre-generated candidates for the next slot are
narrowed to one by that score, the choice is recorded in `questions.chosen_reason`, and the
difficulty label is never shown to the user. A malformed score can never select a graded
question — it degrades to the default, non-adaptive next row. `@adaptive-questions` green is
the observable end-to-end result.

## The invariant this initiative must not weaken

> A malformed or schema-invalid answer score never selects a graded next question. K4 is an
> additive upgrade to §3.7; it can never break the MVP interview flow. (IDEA.md §3.7, K4)

This is the correctness heart of the ledger. The selection logic sits *behind* a Zod
validation gate: a score that fails the `Scores` schema (e.g. `overall: 9`) takes the
fallback path — no graded pick, the default next row stands, `chosen_reason = 'fallback'`,
and `LLM_FALLBACK_TRIGGERED` is logged. This ledger touches only three files inside
`backend/modules/interview/` (`adaptive-select.ts`, `candidate-prep.ts`, and an additive hook
in `answers.ts`). It deliberately does not re-implement the scoring seam (I01), the provider
execution and cost accounting (I02), base round generation (I04), or answer submission and the
guarded advance (I06). It consumes all four.

## Topology

```
Browser
  │  POST /interviews/:id/answers   (owned by I06 — this ledger adds a post-record hook)
  ▼
edge/ (Caddy — single published port, F03)
  ▼
backend/modules/interview/answers.ts            ← I06 handler; D03 adds the adaptive hook
  │
  ├── during turn N ─────────────────────────────────────────────┐
  │     candidate-prep.ts (D02)                                   │
  │       aiClient.generateCandidates({ slot, ctx })  ← I01 seam  │ 3 candidates for N+1
  │       → persist 3 into questions[N+1].candidates (F02 col)    │ (easier / same / harder)
  │                                                               ▼
  └── on submit of N ────────────────────────────────────────────┐
        aiClient.scoreAnswer(...)          ← I01 seam / I02 exec  │ Scores
        adaptive-select.ts (D01)                                  │
          validate Scores  ──malformed──► fallback ──────────────┤ chosen_reason='fallback'
          overall → { difficulty, topicMove, chosen_reason }      │ default row stands
        promote matching candidate into questions[N+1] row (D03) ─┘ + chosen_reason

@interviewly/ai (I01 interface, I02 execution) — scoreAnswer, generateCandidates, StubAiClient
Postgres (F02 schema) — questions.candidates / chosen_reason / difficulty / topic; answers.scores
```

Nothing new is deployed: no service, no package, no migration. All three files live inside the
`api` interview module and reuse the `AiClient` seam already imported there.

## Decision table (full ADRs in DECISIONS.md)

| # | Decision | Chosen | Reason |
|---|----------|--------|--------|
| ADR-D01 | How a score becomes a next-question move | Pure `selectNextQuestion` behind a `Scores` Zod gate; invalid score → `fallback` outcome | The malformed-score guard is the invariant; a pure function with an explicit validation branch is unit-provable and cannot silently pick a graded row |
| ADR-D02 | How the next question is realised | Pre-generate 3 candidates, promote 1 by score (K4 §3.7 mechanism); other 2 retained in `questions.candidates` | IDEA.md §3.7 mandates candidate promotion without a migration; a "harder, new-topic" pick needs a candidate that already carries a new topic/text |
| ADR-D03 | How adaptive attaches to the flow | Additive post-record hook in I06's `answers.ts`; fallback keeps the MVP default row | §3.7 "the K4 ledger cannot break the MVP ledger" — adaptive must degrade to the non-adaptive path, never fork the state machine |

## Data model additions

**None.** This ledger is structurally schema-frozen against F02. It reads and writes only
columns F02 already defines:

| Table | Adaptive reads | Adaptive writes |
|---|---|---|
| `answers` | `scores` (Json) — produced by the I02 `scoreAnswer` call | — (I06 writes the answer row) |
| `questions` | `difficulty`, `topic`, `candidates` (Json) of the next unasked row | `candidates` (D02), and on promotion `text`, `difficulty`, `topic`, `chosen_reason` (D03) |

`chosen_reason` uses the F02 `ChosenReason` enum vocabulary
`score_low | score_mid | score_high | language_switch | fallback`. This ledger emits
`score_low | score_mid | score_high | fallback`; `language_switch` is written by I10, not here.

## Selection rule (the core mechanic — IDEA.md K4, ai spec B5)

`overall` is the integer `0..100` from the validated `Scores`. Difficulty is ordered
`easy < medium < hard`.

| `overall` | Next difficulty | Topic | `chosen_reason` |
|---|---|---|---|
| 0–2 | one level **easier** | **same** topic (follow-up) | `score_low` |
| 3 | **same** difficulty | **same** topic, different angle | `score_mid` |
| 4–5 | one level **harder** | **new** topic | `score_high` |

End-clamps: `hard` + 5 stays `hard` but always moves to a **new** topic; `easy` + 0 stays
`easy` on the **same** topic. A score that fails the `Scores` schema is not on this table at
all — it is the fallback path (`chosen_reason = 'fallback'`, default row, no graded pick).

## Phasing / task clusters (see STATE.md ledger)

0. The brain (D01) — pure `overall`→move selector + the malformed-score guard.
1. The supply (D02) — pre-generate the three next-slot candidates during the turn.
2. The wiring (D03) — score-on-submit → promote by selection, fallback on malformed;
   greens `@adaptive-questions`.

D01 and D02 are independent of each other; D03 depends on both.

## Out of scope (post-adaptive)

- The `scoreAnswer` / `generateCandidates` **interface and stub** — I01. This ledger calls
  them; it does not define or fake them.
- **Provider execution, per-attempt `llm_calls`, cost accounting, fallback chain** — I02. The
  `LLM_FALLBACK_TRIGGERED` this ledger relies on for the malformed-score guard is emitted by
  the I02 execution layer; adaptive triggers the fallback branch, it does not implement the
  chain.
- **Base round question generation** (HR/tech batch, row insertion 1..n) — I04. Adaptive
  rewrites an *existing* next row; it never inserts or deletes question rows mid-round.
- **Answer submission, the guarded advance, server-clock duration, transcript write** — I06.
  Adaptive adds a post-record hook to that handler; it does not own submission.
- **Retaining the two unpromoted candidates for an admin-analysis view** — the columns are
  written (D02/D03 leave them in `questions.candidates`), but no admin surface reads them yet.
  Backlog; promote when the admin analysis is specced.
- **Language-switch candidate regeneration** (`chosen_reason = 'language_switch'`, discard and
  regenerate on a two-turn switch) — I10 owns the switch counting; adaptive does not.
- The **`answers.scores`** shape and the `Scores` schema — I01 owns the schema; adaptive
  imports it and reads `overall`.

**The entire schema lives in F02. This ledger may add indexes and nullable columns only, each
in its own migration, rebased before merge. Any structural change is a change to F02's scope
and gets discussed, not merged.**
