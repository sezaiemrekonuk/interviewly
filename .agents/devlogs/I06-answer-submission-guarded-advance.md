---
task: I06
author: Sezai
sessions: [2026-07-31]
model: claude-opus-4.8
model_recommended: claude-opus-4.8
iterations: 2
tools: [superpowers:using-superpowers, ponytail, caveman]
---

## Session 1 — 2026-07-31

`model` ≠ `model_recommended`: `MODELS.md` names `claude-opus-4.8`, the session ran
`claude-opus-4.8`. Both are opus-tier, which is what EXECUTE.md § 5 gates on — the tier matched,
the point release moved on. Not quietly aligned.

### What I asked for / what came back

- Handler, guard, machine, steps in one pass. The guarded `updateMany` and the handover came
  out right first time; the failure was in my own test assertion, not the code.

### Methodology trace

- Deleted `@unwired` from @AC-8/9/10 → red: `3 scenarios (3 undefined)`.
- Wrote `clock.ts`, `machine.ts`, `answers.ts`, `state.ts` extraction, router mount, steps →
  `3 scenarios (1 failed, 2 passed)`. @AC-10 asserted `0 !== 12000` while the log line said
  `durationMs: 12000` — under the fixed clock every answer shares one `answered_at`, so the
  step's `orderBy: { answered_at: 'desc' }` picked question 1's row. Asserted by question id
  instead → 3/3.
- `machine.test.ts` for the closed half of the table; acceptance only walks the open half.

### Friction

- **The Verification command was a false green.** First run, before any code:
  `0 scenarios`, exit 0. ADR-I25 claims a CLI `--tags` replaces the profile expression;
  cucumber-js ANDs them, so `not @unwired` was still filtering my own scenarios out. If I had
  trusted the exit code, I would have "verified" a task I had not written. ADR-I26, and the
  claim is corrected in `cucumber.js` and REFERENCE.md.
- `let state = interview.state` narrowed to the two guarded states and `tsc` rejected the
  assignment. Explicit `InterviewState` annotation — the guard's narrowing is real, the
  variable's type should not inherit it.

### What I rejected and rewrote by hand

- **Stamping `asked_at` in two places** (state read *and* on advance in `answers.ts`). Two
  writers of one timestamp drift; question 1 is never advanced into, so the read path is
  needed anyway and the advance path is redundant. One writer (ADR-I27).
- **`machine.test.ts` asserting `canTransition('profiling', 'hr_round') === false`.** True
  today, but I07 legitimately adds that edge — a test that fails when the table grows
  correctly is a landmine. Kept only edges that stay illegal (backwards, self, restart).
- **Faking global `Date` for @AC-10.** Prisma runs in the same process; a subclassed `Date`
  would reach it. Four-line `clock.ts` seam instead of a fake-timer dependency.
- **`hr_round: ['tech_round']` alone**, as the task specified. `target = 2` splits to
  `hr 2 / tech 0`, and that interview 409s at its last answer. Added the `evaluating` edge
  (ADR-I28) rather than shipping a 409 on a legal input.
