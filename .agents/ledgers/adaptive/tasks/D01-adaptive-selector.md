# D01 — Adaptive score→question selector and malformed-score guard (pure module)
REPO: (this repo) · Depends: F01, F02, I01 · Status: todo
Read first: STATE.md, REFERENCE.md, then this.
**Model: claude-opus-4.8** — this module maps an answer score to a next-question difficulty/topic move AND guards the invariant that a malformed score can never select a graded question; a cheaper model has produced off-by-one difficulty clamps and guards that let out-of-range values through on similar AI-trust tasks.

## Goal
Owner's ask:

> "Author the complete `adaptive` ledger … the BONUS-band slice (IDEA.md §12) — the
> answer-score-driven next-question selection (difficulty + topic adaptation). This is a
> bonus feature and must **block nothing**."
> — adaptive ledger owner brief

This task creates one **pure** module, `backend/modules/interview/adaptive-select.ts`,
exporting `selectNextQuestion(rawScore: unknown, current: { difficulty, topic })`. It
validates `rawScore` against the `Scores` schema from `@interviewly/ai` (I01) and applies the
B5 selection table (REFERENCE.md), returning a graded move or the `fallback` outcome. It does
**not** call the AI, touch the DB, or wire into the HTTP handler — D02 pre-generates the
candidates this move will promote, and D03 attaches the whole thing to `answers.ts`. After
this task, D03 can `import { selectNextQuestion } from './adaptive-select'` and trust that a
bad score never yields a graded pick.

## Security boundaries
- **A score that fails the `Scores` schema must return `{ graded: false, chosenReason:
  'fallback' }` — never a graded difficulty/topic move, never a thrown error.** This is the
  ledger invariant. An `overall` of `9`, a `null`, a string, a missing field — all fallback.
- **`overall` is read only *after* the schema validates.** Do not read `rawScore.overall`
  before `Scores.safeParse` succeeds; a malformed object has no trustworthy `overall`.
- **No score content in any log.** This module does not log the `reasons` or the raw score;
  it returns a decision object and lets D03 log `LLM_FALLBACK_TRIGGERED` with the
  `questionId` only (K6, §7.2).
- **The difficulty label never leaves toward the user** (K4). This module returns it for D03
  to persist on the `questions` row (admin/audit); it is not user-facing copy.

## Non-negotiables
- Pure function: same inputs → same output, no I/O, no `Date.now()`, no randomness. This is
  what makes it provable by a self-check with no DB and no network.
- The return type is a discriminated union on `graded`: `{ graded: false; chosenReason:
  'fallback' }` | `{ graded: true; difficulty: Difficulty; topicMove: 'same' | 'new';
  chosenReason: 'score_low' | 'score_mid' | 'score_high' }`.

## Context (anchors)
- `packages/ai/src/schemas.ts` — I01. Import `Scores` (Zod). The field this module reads is
  the integer `overall ∈ 0..5`; an out-of-range value fails the schema. Do **not** redefine
  the schema here — import it, so the malformed definition stays single-sourced.
- `backend/prisma/schema.prisma` — F02. `Difficulty` enum (`easy | medium | hard`) and the
  `ChosenReason` enum (`score_low | score_mid | score_high | language_switch | fallback`).
  Import the generated types; do not restate the string unions inline where a Prisma enum
  type exists.
- `@interviewly/types` / `backend/src/lib/error-codes.ts` — F01. **No new error code** — the
  malformed path is a return value, not an error.
- REFERENCE.md "The selection rule" — the B5 table this function implements, including the
  two end-clamps (`hard`+5 stays `hard` topic-new; `easy`+0 stays `easy` topic-same).

  **The trap:** the difficulty ordering is `easy < medium < hard`. "One level easier" from
  `easy` clamps at `easy`; "one level harder" from `hard` clamps at `hard`. A naive
  index-±1 without clamp under/overflows the enum. Test both clamps explicitly.

## Steps
- [ ] **1. Create `backend/modules/interview/adaptive-select.ts`**
  - Import `Scores` from `@interviewly/ai`; import `Difficulty`, `ChosenReason` types from the
    Prisma client (F02).
  - Define the discriminated-union return type described in Non-negotiables.
  - `selectNextQuestion(rawScore: unknown, current: { difficulty: Difficulty; topic: string })`:
    - `const parsed = Scores.safeParse(rawScore);`
    - `if (!parsed.success) return { graded: false, chosenReason: 'fallback' };`
    - `const overall = parsed.data.overall;` (integer 0..5, schema-guaranteed).
    - `0–2` → difficulty one level **easier** (clamped at `easy`), `topicMove: 'same'`,
      `chosenReason: 'score_low'`.
    - `3` → difficulty **same**, `topicMove: 'same'`, `chosenReason: 'score_mid'`.
    - `4–5` → difficulty one level **harder** (clamped at `hard`), `topicMove: 'new'`,
      `chosenReason: 'score_high'`.
  - Implement the level shift via an ordered array `['easy','medium','hard']` with a clamped
    index — no `if` ladder that silently falls through.
- [ ] **2. Create `backend/modules/interview/adaptive-select.selftest.ts`**
  - Plain Node asserts, no test framework (ponytail: one runnable check, no fixtures).
  - Assert the five representative rows: `overall 0`, `2`, `3`, `4`, `5` from a `medium`+`X`
    current → the expected difficulty / topicMove / chosenReason.
  - Assert both clamps: current `hard` + `overall 5` → `hard`, `topicMove 'new'`; current
    `easy` + `overall 0` → `easy`, `topicMove 'same'`.
  - Assert the malformed branch four ways: `{ overall: 9 }`, `null`, `"bad"`,
    `{ overall: 3.5 }` → each returns `{ graded: false, chosenReason: 'fallback' }`.
  - `console.log('adaptive-select selftest OK')` and `process.exit(0)` on success; any failed
    assert throws and exits non-zero.
- [ ] **3. Run the Verification command; confirm it exits 0.**

## Definition of done
- `selectNextQuestion` returns the B5 table result for every valid `overall`, with both
  end-clamps correct.
- Every malformed input (`overall` out of 0..5, non-integer, `null`, wrong type, missing
  field) returns `{ graded: false, chosenReason: 'fallback' }` — proven by the self-check.
- The module imports `Scores` from `@interviewly/ai` and the enums from the Prisma client;
  it redefines neither.
- No DB access, no network, no logging, no new error code in the module.
- `npx tsx backend/modules/interview/adaptive-select.selftest.ts` exits 0 printing
  `adaptive-select selftest OK`.

## Verification
```bash
npx tsx backend/modules/interview/adaptive-select.selftest.ts
```

Expected output: `adaptive-select selftest OK`, process exit code 0. Any assertion failure
exits non-zero — fix the code, never the assert.

## Notes

(Empty until the task is done. Fill with: what actually happened, any deviation from the B5
table, the exact `Scores` import path used, whether the `ChosenReason`/`Difficulty` types
imported cleanly from the Prisma client or needed a type shim, the selftest output verbatim,
and a "For D03" hand-off line noting the exact return-type shape D03 will branch on.)
