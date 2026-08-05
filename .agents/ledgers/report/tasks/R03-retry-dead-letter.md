# R03 — Retry, backoff, dead-letter `→ failed`; idempotent; transient vs schema-gate branch
REPO: (this repo) · Depends: R01 · Status: todo
Read first: STATE.md, REFERENCE.md, then this.
**Model: claude-opus-4.8** — retry-correctness on the queue boundary. Distinguishing a retryable transient throw from a permanent schema-gate `failed`, and making the dead-letter transition idempotent, is the K10 invariant a cheaper model gets subtly wrong — either looping a bad report three times (cost) or retrying a transient fault zero times (a recoverable report lost).

## Goal
Owner's ask:

> "Retry and dead-letter handling on the `failed` branch: a transient report-job failure retries
> three times with backoff, then dead-letters the interview to `failed`; a permanent schema-gate
> failure (I09) is never retried. Every retry is idempotent — no double transition, no double
> bill."
> — report ledger decomposition (K10, ADR-R04, §8.3)

This task hardens the R01 consumer: it sets the BullMQ `attempts`/`backoff` policy, distinguishes
a **thrown** (transient) error from `runReport` — which BullMQ retries — from the schema-invalid
case I09 handled internally (no throw, no retry), and adds the dead-letter handler that, on
exhaustion, transitions the interview `evaluating → failed` via `applyTransition` (I07) and sets
`reports.status = failed`. It does **not** re-implement `runReport` or the schema gate — the
schema-`failed` path is already I09's; this task only routes the *transient* failures.

## Non-negotiables
- **Three attempts, exponential backoff, then dead-letter `→ failed`** (K10). BullMQ job option
  `attempts: 3`, `backoff: { type: 'exponential', delay: 1000 }`. On the final failed attempt the
  dead-letter handler runs.
- **A schema-gate `failed` is never retried.** `runReport` handles a schema-invalid payload
  internally — it transitions the interview `→ failed`, stores no payload, logs
  `AI_OUTPUT_SCHEMA_INVALID`, and **returns without throwing**. That job therefore completes on
  attempt 1. Do not wrap `runReport` in a catch that turns a schema failure into a throw/retry.
- **The dead-letter transition goes through `applyTransition`.** `evaluating → failed` on
  exhaustion is written only via I07's `applyTransition` (the sole guarded `interviews.state`
  writer) — never a raw `prisma.interview.update`. If the interview is already `failed`/`completed`
  (a racing retry finished first), `applyTransition` rejects the illegal edge and the handler
  is a no-op — that is the idempotency guarantee, not an error to swallow silently.
- **Idempotent retries.** Every attempt re-runs the processor from `evaluating`; because
  `runReport` re-runs from that state and `applyTransition` is guarded, a retry does not
  double-transition. A transient throw *after* a partial write must leave the row re-processable
  (no half-`ready` state that blocks the next attempt).

## Context (anchors)
- `worker/src/failure.ts` — **create.** Exports the job options
  (`{ attempts: 3, backoff: { type: 'exponential', delay: 1000 } }`) the producer applies, and
  `handleDeadLetter(interviewId, cause)`: `applyTransition(interview, 'failed', ctx)` (I07),
  `reports.status = 'failed'`, `logger.error({ interviewId, cause }, "REPORT_JOB_FAILED")` +
  `logger.warn({ interviewId }, "REPORT_DEAD_LETTERED")`.
- `backend/src/lib/queue.ts` — R01. The producer's `reportQueue.add(...)` gains the `attempts`/
  `backoff` options from `failure.ts` (or they are set as queue defaults). Keep `jobId =
  interviewId`.
- `worker/src/index.ts` — R01. Attach BullMQ `Worker` event listeners: on `failed` with
  `job.attemptsMade >= job.opts.attempts`, call `handleDeadLetter(job.data.interviewId, err)`.
- `worker/src/consumer.ts` — R01. Confirm a **thrown** error propagates (so BullMQ retries) and
  that the schema-`failed` path (no throw) completes without retry. Do not add a catch that
  hides a transient throw.
- `backend/modules/interview/machine.ts` — I07. `applyTransition` — the sole `interviews.state`
  writer; `evaluating → failed` is a listed edge. Import from `backend`.
- `backend/modules/interview/report-run.ts` — I09. `runReport` — the schema-invalid branch that
  returns without throwing (do not change it; rely on it).
- `backend/src/lib/error-codes.ts` — F01. `AI_PROVIDER_UNAVAILABLE` (the typical transient throw
  from the exhausted provider chain); no new code is added by this task.

  **The trap:** two failure branches converge on the same terminal state (`failed`) by different
  paths. The schema branch is immediate and cost-bounded (one report call, handled inside
  `runReport`, no retry). The transient branch is retried 3× then dead-lettered. If you retry the
  schema branch you burn three LLM calls (three `llm_calls` cost rows) to reproduce the same
  rejected output and fail anyway. Assert both branches separately in the tests.

## Steps
- [x] **1. Write `failure.ts`** — the job-options export and `handleDeadLetter(interviewId,
  cause)` using `applyTransition(→ failed)` + `reports.status = 'failed'` + the two log events.
- [x] **2. Apply `attempts`/`backoff`** to the producer in `queue.ts` (or as queue defaults),
  preserving `jobId = interviewId`.
- [x] **3. Attach the dead-letter listener** in `index.ts` — on the final failed attempt, call
  `handleDeadLetter`. Make it idempotent: if `applyTransition` rejects (already terminal), no-op.
- [x] **4. Confirm the consumer's throw/return contract** — a transient throw propagates to
  BullMQ (retryable); the schema-`failed` return does not throw (no retry).
- [x] **5. Wire the worker tests** — three cases:
  - **Transient, recovers:** a `runReport` stub that throws on attempts 1–2 and succeeds on 3 →
    the job ends `completed`, `reports.status = ready`, exactly one `→ completed` transition.
  - **Transient, exhausts:** a stub that always throws → after 3 attempts the interview is
    `failed`, `reports.status = failed`, `REPORT_DEAD_LETTERED` logged, and no PDF/`ready`.
  - **Schema-gate failure:** a stub whose payload fails the `ReportPayload` gate (e.g.
    `overall_score 7`) → `runReport` sets `failed` with **no throw**; the job is **not** retried
    (`attemptsMade === 1`), `AI_OUTPUT_SCHEMA_INVALID` logged, no `report_questions`, no `pdf_key`.
- [x] **6. Assert idempotency** — a retry that runs after a partial transient write leaves exactly
  one terminal transition (no double `→ failed`/`→ completed`); `applyTransition` guards it.
- [x] **7. Run the `## Verification` command.**

## Definition of done
- A transient report-job failure retries 3× with exponential backoff, then dead-letters:
  interview `→ failed` (via `applyTransition`), `reports.status = failed`, `REPORT_JOB_FAILED` +
  `REPORT_DEAD_LETTERED` logged.
- A schema-gate failure (I09) is **not** retried (`attemptsMade === 1`); it ends `failed` with no
  `report_questions` and no `pdf_key`, `AI_OUTPUT_SCHEMA_INVALID` logged.
- Retries are idempotent: no double transition, no half-`ready` row that blocks re-processing; the
  dead-letter handler is a no-op when the interview is already terminal.

## Verification
```bash
docker compose up -d db cache
npm run -w worker test
```

Expected: all three failure-branch cases pass — transient-recovers ends `completed`,
transient-exhausts dead-letters to `failed` after 3 attempts, schema-gate ends `failed` on the
first attempt with no retry — and the idempotency assertion holds.

## Notes

**Deviation — job options live in `backend/src/lib/queue.ts`, not `failure.ts`.** The Context said
`failure.ts` exports them and the producer applies them; the producer is in `backend`, and
`backend` cannot import `worker` (the dependency runs one way). `REPORT_JOB_OPTIONS = { attempts:
3, backoff: { type: 'exponential', delay: 1000 } }` is therefore the `reportQueue`
`defaultJobOptions` — queue defaults, not per-`add`, so no future producer can enqueue an
unretried report job — and `failure.ts` imports it back through `worker-exports.ts` to recognise
the final attempt. `jobId = interviewId` is unchanged (per-`add` opts win over defaults).

**Branch detection is the throw, not the state.** `runReport`'s no-throw schema contract held as
I09 documents it: `failure.integration.test.ts` drives a gate-rejected payload through a real
queue and the processor is entered exactly once (`attempts === 1`), interview `failed`, no
`reports` row, no object. Nothing in `failure.ts` runs on that path — only a thrown error reaches
the `failed` listener at all.

**BullMQ 6 `attemptsMade`.** Incremented inside `moveToFailed` *before* the `failed` event fires
(`job.js:513`, `worker.js:638`), so on the exhausting attempt `attemptsMade === opts.attempts`
exactly. `attemptsMade < attempts` → `REPORT_JOB_RETRY`; `>=` → `handleDeadLetter`. Verified
against real Redis, not stubs — retry delays observed 1 s then 2 s.

**Idempotency = `applyTransition`'s guard, and the order matters.** Transition first, then
`reports.status`. If a racing retry already finished the interview (`completed`) or another
dead-letter beat this one (`failed`), the edge is illegal → `INVALID_STATE_TRANSITION` →
`REPORT_DEAD_LETTER_NOOP`, and the `reports` write is skipped, so the `ready` row the winning run
wrote is never clobbered. Any other error from `applyTransition` propagates.

**`reports.status = failed` usually updates 0 rows.** I09 creates the row already `ready` inside
its own transaction (R01's "no `generating` status" deviation), so the ordinary dead-letter — a
throw *inside* `runReport` — has no row to mark; the interview state is the durable signal.
`updateMany({ where: { interview_id, status: { not: 'ready' } } })` covers the case where one
exists without touching a landed report.

**`handleReportJobFailed` never rejects.** An unhandled rejection from an event listener kills the
process and takes `email.send` and `voice.reconcile` down with the report queue; a failed
dead-letter is `REPORT_DEAD_LETTER_FAILED` + an interview stuck in `evaluating` instead.

**R02's "a retry never reaches finalise" is stale.** `consumer.ts:28-31` already swallows
`INVALID_STATE_TRANSITION` from `runReport`, so a retry after a partial run does reach
`finalizeReport` and `pdf_key` is recovered. Also fixed the `any` on that line — `npm run lint`
was **red on `master`** before this task (`no-explicit-any`, `worker/src/consumer.ts:30`).

**Verification (2026-08-05).** `npm run -w worker test` 5 files / 29 tests. `npm run
test:integration` 2 files / 9 tests — needs published ports (`localhost:15432` / `16380`) **and
`docker compose stop worker`**: the container consumes the same `report` queue off the shared
Redis and stole R01/R02's jobs, failing them against live providers. R03's own ring is immune (one
throwaway queue name per test). `lint`, `typecheck`, `npm test` 43/309, `npm run test:acceptance`
79/79 (export the two host URLs — `.env`'s `db:5432` hangs cucumber), `npm run -w worker build`
all clean.

**For R04.** `applyTransition` is now exported from `worker-exports.ts`; the `→ abandoned` edges
R04 adds to `machine.ts` are reachable from the worker without a second export. `failure.ts` is
report-queue-specific — the sweeper needs no part of it.
