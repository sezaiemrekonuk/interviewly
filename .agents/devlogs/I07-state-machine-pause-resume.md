---
task: I07
author: Sezai
sessions: [2026-08-03]
model: claude-opus-4.8
model_recommended: claude-opus-4.8
iterations: 1
tools: [caveman:caveman, ponytail:ponytail]
---

## Session 1 — 2026-08-03

### What I asked for / what came back
- Session opened on a half-finished run: a Sonnet session had left `machine.ts`,
  `generation.ts`, `router.ts` modified and `resume.ts`, `sse.ts` untracked, each marked
  `ponytail: I07 sketch … verify with opus before merge`. Treated all five as untrusted.
- The sketch's transition table and the `hr_round → paused` reroute survived. Everything else
  was rewritten.

### Methodology trace
- Deleted `@unwired` from `interview_flow.feature:60` (ADR-I26) → wrote
  `state-machine.steps.ts` → implemented → green.
- **Green on the first full run, which proves nothing**, so the emission was disabled
  (`publishStateChanged` commented out) and re-run: `AssertionError: no
  INTERVIEW_STATE_CHANGED carrying created -> profiling`. Restored → green. That is the red I
  should have seen before writing the code, taken late rather than not at all.
- @AC-16 asserts the emission off the **Redis channel**, not off pino: the channel is what
  `streamInterviewEvents` fans out, so a passing assertion means a room would have seen it.

### Friction
- `POST /interviews` inserted straight into `profiling`, and `POST /profile` wrote
  `state: 'hr_round'` inline with its own hand-rolled `INTERVIEW_STATE_CHANGED` log. Two of
  the six listed edges were therefore unguarded and one was uninstrumented. Fixing that, not
  the new table, was most of the diff (ADR-I31).
- `applyTransition` left the caller's `interview` object stale, so `POST /profile` →
  `profiling→hr_round` → failed generation computed `from: 'profiling'` for the pause. One
  in-place mutation, commented.
- Five of six table rows are HTTP; `hr_round → paused` has no route (ADR-I22 puts both
  batches inside the HR round), so it is driven at module level with a failing `AiClient`,
  the pattern @AC-1 already established.
- Local `typecheck` was red on missing `bullmq` / `nodemailer` before anything was touched —
  stale `node_modules`, fixed by `npm install`, unrelated to this task.

### Code review (Copilot, 3 comments — all valid, 2 narrowed)
- **State write was TOCTOU.** Table checked against a `from` read at `resolveInterview` time,
  written by id alone. Accepted: `updateMany where { id, state: from }` (ADR-I32) — the same
  shape ADR-I06 already uses for `current_index`. Caught a pre-existing I04 bug: concurrent
  `POST /profile` generated two HR batches.
- **Awaited publish could fail a committed transition.** Accepted for the fan-out. **Rejected
  for `enqueueReport`** — Copilot asked for both; a swallowed BullMQ failure (R01) is an
  interview that reaches `evaluating` and never gets a report, which must stay loud.
- **SSE write-after-end.** Accepted, as a `res.writableEnded` guard rather than the proposed
  closed-flag + listener teardown; `quit()` being async is the whole window.

### What I rejected and rewrote by hand
- **`sse.ts`, entirely.** The sketch opened two eager module-level `new Redis(...)`
  connections at import; `features/step_definitions/server.ts` documents exactly that mistake
  hanging cucumber after its summary. It also keyed off `req.params.id` rather than
  `req.interview`, so the "owner-scoped" claim rested on a resolver it never consulted, and
  one shared subscriber `unsubscribe`d a channel any concurrent stream might still need.
  Rewritten onto the shared `redis` for publish and one `duplicate()` per stream.
- **The `/events/interviews/:id` path from the task file.** Root-mounting it duplicates
  `requireAuth`, the ownership `router.param` and the CSRF GET exemption; `/interviews/:id/events`
  inherits all three (ADR-I29, REFERENCE.md patched).
- **`resume.ts`'s "resume to the round it left" derivation.** Only `hr_round` can pause today,
  so the branch was dead code guarding a state the table does not reach.
