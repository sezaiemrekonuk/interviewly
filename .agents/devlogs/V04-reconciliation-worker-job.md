---
task: V04
author: Fatih
sessions: [2026-08-04]
model: claude-opus-5
model_recommended: claude-opus-4.8
iterations: 2
tools: [cucumber, vitest, prisma, bullmq]
---

## Session 1 — 2026-08-04

Tier note: MODELS.md recommends `claude-opus-4.8`; ran `claude-opus-5`. Both are opus-tier, which
is what EXECUTE.md §5 gates on — the recommendation predates the model. Not silently aligned.

### What I asked for / what came back
- Asked for the whole task; the file layout it prescribed was wrong for the test ring (below).
- Route collision found by reading, not by failing: `webhook-router`'s `/:action` matches
  `post_call`. Mounted the new router ahead of it.

### Methodology trace
`voice_reconciliation.feature` added to `cucumber.js` `paths` → run → **red** (1 undefined scenario,
12 undefined steps) → `reconcile.ts` + `reconcile-webhook.ts` + worker job + steps → green
(13/13). Worker unit test written against the processor, green first run after the mock shape
was fixed.

### Friction
- **Two silent hangs, same root cause.** The new `voice.reconcile` BullMQ queue is constructed at
  import of `src/lib/queue.ts`, so both cucumber rings held the event loop open and printed nothing
  for minutes — a run that looks stuck, not failed. `server.ts` documents this exact trap for
  `reportQueue`; I hit it twice because the auth ring has its own teardown in
  `tests/support/harness.ts`. Both now close the queue.
- Auth profile refuses to run against the `interviewly` database (destructive-truncate guard).
  Pre-existing, unrelated to V04 — reran against `interviewly_test`.
- `llm_calls` has four NOT NULL columns that mean nothing for metered usage
  (`prompt_uuid`/`prompt_version`/`attempt_no`/`latency_ms`). Filled with empty/first values rather
  than inventing a prompt that never existed. Same for `cost_usd`, which the task said should be
  null on a missing price — the F02 column is NOT NULL, and I02 already resolved this as `0` +
  `PRICE_MISSING`.

### What I rejected and rewrote by hand
- **The task's file layout.** Putting the transaction in `worker/src/jobs/voice-reconcile.ts` as
  written would have left @AC-7 asserting a *copy* of the invariant: cucumber runs backend source
  via tsx and never builds `worker/`'s dist (`report-job.steps.ts` says so explicitly). Moved it to
  `backend/modules/voice/reconcile.ts`; wrote ADR-V04-2.
- **A vacuous idempotency test.** First version let BullMQ's `jobId` dedupe the redelivery — which
  passes "no additional row" without the in-transaction check ever running. Rewrote with
  `removeOnComplete: true` and an assertion that the processor ran **twice**.
- **A hand-waved "one transaction" step.** Atomicity is not observable on a success path. Replaced
  the placeholder with fault injection: a probe interview parked at the `Decimal(12,6)` ceiling so
  the increment overflows after the insert, then assert zero surviving `llm_calls` rows. It fails
  loudly if anyone ever splits the two statements.
- Hardcoded `0.4` in the cost assertion → read `per_minute_usd` from `model-prices.yaml`, so an
  edited price moves the test with it.
