---
task: I13
author: Sezai
sessions: [2026-08-04]
model: claude-sonnet-4.6
model_recommended: claude-sonnet-4.6
iterations: 1
tools: [ponytail, caveman]
---

## Session 1 — 2026-08-04

Tier mismatch, on purpose: the human ran this on Opus to finish a Sonnet session that had
stopped after writing a sketch file. EXECUTE.md §5 would have ended the run; the explicit
instruction overrode it. Recorded rather than aligned.

### What I asked for / what came back
- Predecessor left `modules/interview/rate-limit.ts` as two no-op handlers + a `ponytail:`
  block. Its plan said auth's `slidingWindowHit` was "NOT reusable as-is" (it used
  `Date.now()`). Rejected that framing — see below.

### Methodology trace
`rate_limits.feature` @AC-12/@AC-13 → wired into `cucumber.js` default profile + steps →
implemented → 4/4 green → **unmounted both middlewares to see it red** (2 failed / 2 passed,
`AssertionError: body: {"interviewId":…}` where 429 was expected) → remounted.

### Friction
- @AC-13's `interview-start` row asks for 10 successful starts in a window where @AC-12 caps
  starts at 5. The two scenarios contradict each other if the precondition is read as "make
  10 real requests". Read it as window state instead and seeded it through the production
  counter.
- @AC-13's `<key>` column wants per-IP keys (`203.0.113.10`). Honouring it means `trust proxy`
  + attacker-controlled `X-Forwarded-For` — weakening the limiter to test the limiter.
  Skipped, documented in `## Notes`.

### What I rejected and rewrote by hand
- **The predecessor's "do not record the hit until the create succeeds" design.** It buys a
  correctness nicety nobody asked for and costs atomicity (check-then-act race). Standard
  record-then-check satisfies @AC-12 exactly; the corner is marked with a `ponytail:` comment.
- **A second sliding-window implementation in the interview module.** Instead changed
  `slidingWindowHit` to score from `clock.now()` — one word, in the one place all callers
  route through — and generalised A01's `limiter` into `keyedLimiter`. That deleted
  `profilePatchLimiter`'s hand-rolled duplicate as a side effect. Net: the interview file is
  two config objects, no logic.
