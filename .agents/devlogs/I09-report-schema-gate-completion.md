---
task: I09
author: Sezai
sessions: [2026-08-03]
model: claude-opus-4.8
model_recommended: claude-opus-4.8
iterations: 2
tools: [superpowers:test-driven-development, caveman, ponytail]
---

## Session 1 — 2026-08-03

`model` ≠ `model_recommended`: MODELS.md predates the Opus 5 release; opus tier was honoured.

### What I asked for / what came back
- Session opened on a half-finished `report-run.ts` sketch left by a Sonnet run that stopped
  at the tier check. Instruction was to finish it and to trust nothing in it.
- Sketch was structurally right and factually wrong in four places (see rejected, below).

### Methodology trace
`schema_validation.feature` @AC-11 → wired steps + `cucumber.js` `paths` → **red with the gate
stubbed out** (`no report payload is stored` → `1 !== 0`) → gate restored → 15/15 green.
Red run also surfaced an ambiguous step (my `an {string} event is emitted` vs
ai-provider.steps.ts's regex) — deleted mine, reused theirs.

### Friction
- **`failed` is terminal** in the K2 table, and the scenario runs the invalid branch then the
  valid one on "the interview". Second run had to provision a fresh subject; the step says so
  in a comment rather than pretending one interview did both.
- **Task step 3 was wrong to do.** Wiring `enqueueReport → runReport` would have moved the
  `evaluating` interview `interview_flow` @AC-16 parks, turning a green scenario red, and would
  have put a 90 s call inside an answer request. Recorded as ADR-I34 instead of implemented.
- No in-process observer for a log-only event; patched pino's `warn` in the step file
  (restored in `After`), same shape as the existing `clock.now` patch.

### What I rejected and rewrote by hand
- `status: 'completed'` on the `reports` row — `ReportStatus` is `queued|generating|ready|failed`.
  Would have failed at insert. Now `ready`.
- `import { AiError } from '@interviewly/ai/errors'` — no such subpath export; it is re-exported
  from the package root.
- `applyTransition` called inside `prisma.$transaction(tx)` — it uses the global client, so it
  never joined that transaction. Reordered: CAS transition first, then the write, with the
  residual crash window named in a `ponytail:` comment.
- `transcript = ''` placeholder — replaced with real Q/A turns carrying `question_id`, without
  which `report_questions` cannot be written at all.
- Added (not in the sketch): dropping model-invented `question_id`s before the FK insert.
