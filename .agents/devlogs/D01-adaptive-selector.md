---
task: D01
author: Fatih
sessions: [2026-08-01]
model: claude-opus-4.8
model_recommended: claude-opus-4.8
iterations: 1
tools: []
---

## Session 1 — 2026-08-01

### What I asked for / what came back
Implemented the D01 pure module `selectNextQuestion(rawScore, current)` in
`backend/modules/interview/adaptive-select.ts` plus its plain-`node:assert` self-check. The
module maps a validated answer score to the next question's difficulty/topic move (ai spec B5,
IDEA.md K4) and returns the `fallback` outcome for any score that fails `ScoresSchema` — the
ledger invariant that a malformed score can never select a graded question.

### Methodology trace
This task verifies against its own runnable self-check, not the Cucumber feature (D03 greens
`@adaptive-questions`; D01 cannot green a feature alone — REFERENCE.md § Tag note). So the ATDD
loop here is the self-check: wrote `adaptive-select.selftest.ts` asserting the 5 B5 rows, both
end-clamps, and the malformed guard four ways → implemented `adaptive-select.ts` → ran
`npx tsx backend/modules/interview/adaptive-select.selftest.ts` → `adaptive-select selftest OK`,
exit 0. One red→green cycle; no off-by-one on the clamp on the first attempt, so `iterations: 1`.

The clamp is the documented trap (index ±1 over `['easy','medium','hard']` under/overflows the
enum). I implemented it as `Math.min(len-1, Math.max(0, idx + delta))` and asserted both ends
explicitly (`hard`+5 → `hard`, `easy`+0 → `easy`) rather than trusting the mapping.

### Friction
- The task and REFERENCE.md pseudocode both say `import { Scores }` / `Scores.safeParse`, but the
  `@interviewly/ai` barrel exports the Zod **schema** as `ScoresSchema` and reserves `Scores` for
  the inferred **type**. Used `ScoresSchema` for `safeParse` and left `Scores` unimported (the
  module needs no `Scores` type). Noted in the task `## Notes` so the stale pseudocode does not
  bite D02/D03.
- Local env has no `.env`, so two unrelated vitest files (`csrf.test.ts`, `profile.test.ts`,
  I05/I06) crash at import on `env.ts` `process.exit(1)`. Confirmed D01 imports neither and all
  74 actual tests pass; this is a pre-existing environment gap, not a D01 regression. Did not
  fabricate credentials to paper over it (EXECUTE.md § 8).

### What I rejected and rewrote by hand
- Rejected an `if (idx > 0) idx--`-style ladder for the level shift — it is exactly the
  "silently falls through" shape the task warns against and hides the clamp. Rewrote as an
  ordered array with an arithmetic clamp so both bounds are one expression.
- Rejected inlining the `chosenReason` string unions as bare literals in the return type.
  Rewrote them as `Extract<ChosenReason, …>` against the Prisma enum so a renamed enum member
  fails the compile here instead of drifting (the "import the enums, don't restate them"
  convention). This also keeps `language_switch` — which belongs to I10, not this module —
  structurally excluded from D01's graded outcomes.
