---
task: I08
author: Sezai
sessions: [2026-08-03]
model: claude-opus-4.8
model_recommended: claude-opus-4.8
iterations: 4
tools: [superpowers:test-driven-development]
---

## Session 1 — 2026-08-03

Model note: `MODELS.md` names `claude-opus-4.8`; this ran on `claude-opus-4.8`. Same opus tier,
which is what EXECUTE.md § 5 gates on.

### What I asked for / what came back
- Picked up a half-finished handover: a previous session left `budget.ts` as a sketch with a
  `TODO(opus)` saying the transaction plumbing was undecided, plus comment-only stubs in
  `answers.ts` and `machine.ts`. Kept the `machine.ts` `endedReason` shape (the enum value
  `budget_exhausted` checks out against F02), rewrote everything else.
- The sketch's open question — thread `tx` through `@interviewly/ai` so `recordLlmCall` joins
  the gate's transaction — turned out to be the wrong question. Answer: don't (ADR-I33).

### Methodology trace
task §Verification → deleted `@unwired` from `interview_flow.feature` @AC-11 → wrote
`budget.steps.ts` → red (`200 !== 402`, and `TECH_BATCH_REQUESTED` in the log confirming the
gate site was the right one) → `withBudget` + `answers.ts` → green.

### Friction
- Iteration 2: literal spec shape (`SELECT … FOR UPDATE` + charge joining the tx via an
  `AsyncLocalStorage`) passed @AC-11 and broke 4 other scenarios — each hung 5 s, then the
  `AfterAll` `server.close()` timed out and cucumber exited before printing its summary, so
  the failure list was invisible until I isolated by tag. Cause: `generateRound`'s question
  insert takes `FOR KEY SHARE` on the same `interviews` row from a second connection.
- Iteration 3: advisory lock, two wrong signatures in a row — a bound JS number arrives as
  `bigint` so `pg_advisory_xact_lock(bigint, integer)` does not resolve (`::int`), and the
  function returns `void`, which `$queryRaw` cannot deserialize (`$executeRaw`).

### What I rejected and rewrote by hand
- **The sketch's `withBudget(id, tx, fn)`** — deleted with its TODO. `findUniqueOrThrow`
  inside a transaction takes no lock under READ COMMITTED, so it reads the same stale total
  the race is about; it would have looked correct and closed nothing.
- **Threading `tx` into `@interviewly/ai`** — rejected on its own terms too: the package is
  shared with `worker` and deliberately Prisma-free.
- **`FOR NO KEY UPDATE` as the deadlock fix** — rejected after tracing the second caller.
  It clears the FK-insert conflict but not `applyTransition(→ paused)` on the provider-failure
  path, which wants the same row from a third connection.
- **Charging inside the gate's transaction at all** — the deciding argument, and it is not the
  deadlock: a throw after a paid attempt rolls back `llm_calls` and the `spent_usd` increment
  for a call that really was billed. A retry loop would bill without limit while `spent_usd`
  stayed 0 — the failure the ceiling exists to prevent.

## Session 2 — 2026-08-03 — CI red + PR review

### What I asked for / what came back
- Docker `build` job failed: `budget.test.ts` TS1378, top-level `await import('./budget')`.
  `backend/tsconfig.json` is `module: commonjs`; the root one is `esnext`, so `npm run
  typecheck` (and the CI `lint` job) never saw it. Filed the job-disagreement in the
  foundations Backlog.
- Fix: static `import` — vitest hoists `vi.mock` above imports, so the `await import` dance
  bought nothing in the first place.

### Methodology trace
`npm run -w @interviewly/backend build` locally → same TS1378 → static import → build clean →
rings 33/33 + 11/11, 97 unit.

### Friction
- Two rounds: the first fix added the static import and left the `await import` line, so the
  build then had TS2440 *and* TS1378. Read the file, not the diff.
- A `prisma generate` was stale mid-session and produced a wall of unrelated `@prisma/client`
  type errors that looked like my regression. Regenerating cleared all of them.

### What I rejected and rewrote by hand
- **Copilot, medium, `machine.ts`:** `applyTransition` writes `ended_reason` to the row but
  only syncs `interview.state` in memory. Checked before applying — no in-request reader today
  (`answers.ts` throws immediately after; `state.ts` re-reads the row on a later GET), so it
  is latent, not a live bug. Applied anyway: it is one line and the same reason
  `interview.state = to` exists two lines above.
