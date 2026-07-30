# R01 — Worker service + BullMQ report consumer: real producer into I07's hook, dequeue → `runReport`, `reports.status` lifecycle
REPO: (this repo) · Depends: F01, F02, F03, I01, I02, I06, I07, I09 · Status: todo
Read first: STATE.md, REFERENCE.md, then this.
**Model: claude-sonnet-4.6** — mechanical worker + BullMQ wiring over an existing `runReport`; the one correctness knob (`jobId = interviewId` idempotency) is a single BullMQ option, not bespoke logic. If the retry-safety of the consumer turns out subtler than a `jobId`, code-review the diff with `claude-opus-4.8`.

## Goal
Owner's ask:

> "The real `worker/` BullMQ consumer that dequeues the report job I07 enqueues and calls I09's
> `runReport`. Wire the real `Queue.add` into I07's `enqueueReport` hook so exactly one job is
> enqueued per interview, run it in a low-concurrency worker container, and drive the
> `reports.status` job lifecycle to `ready`. Scenario `@report` (AC-20) green end-to-end through
> the real worker."
> — report ledger decomposition (K10, ADR-R01, ADR-R02)

This task scaffolds the `worker/` workspace, creates the shared `report`-queue producer, backs
I07's `enqueueReport` stub with the real `Queue.add`, and runs the BullMQ `Worker` that calls
`runReport(interviewId)` (I09) and walks `reports.status` `generating → ready`. It does **not**
render the PDF or write `pdf_key` (R02) or add retry/dead-letter handling (R03) — the happy path
only; a thrown error may surface as a failed job here and is hardened in R03.

## Non-negotiables
- **`runReport` is called, never re-implemented.** The worker calls
  `runReport(interviewId)` (I09) for the schema gate, the `reports.payload` write, and the
  `evaluating → completed | failed` interview transition. The worker owns only `reports.status`
  and the surrounding wiring. (ADR-R02, PLAN scope boundary.)
- **Exactly one job per interview.** The producer uses `jobId = interviewId`; a re-add for an id
  whose job is still known is a no-op (AC-20: "no additional report job is enqueued" on
  re-entering `evaluating`). Do not add a bespoke dedupe table (that is an F02 schema change).
- **The real producer lives inside I07's hook.** Replace the body of `enqueueReport(interviewId)`
  (currently a stub that only logs `REPORT_JOB_ENQUEUED`) with `reportQueue.add(...)`; keep the
  `REPORT_JOB_ENQUEUED` log. Do not create a second, parallel enqueue path.
- **`interviews.state` is never written directly.** Interview transitions happen only inside
  `runReport`/`applyTransition`. The worker writes `reports.status` only.

## Context (anchors)
- `backend/src/lib/queue.ts` — **create.** Exports `REPORT_QUEUE = "report"`, a single BullMQ
  `Queue` (`reportQueue`) constructed from `config.REDIS_URL` (F03 `env.ts`), and the shared
  `connection` object worker reuses. Nothing else — this is the producer + the queue name/const,
  imported by both `api` (the hook) and `worker` (the consumer).
- `backend/modules/interview/sse.ts` — I07. Holds `enqueueReport(interviewId)`, today a stub that
  logs `REPORT_JOB_ENQUEUED`. **Replace its body** with
  `await reportQueue.add(REPORT_QUEUE, { interviewId }, { jobId: interviewId })`, keeping the
  `REPORT_JOB_ENQUEUED` log. Grep for other callers of `enqueueReport` and confirm there is only
  the one `→ evaluating` emission point.
- `backend/modules/interview/report-run.ts` — I09. `runReport(interviewId)` — call it; do not
  re-implement. On success it has transitioned the interview `→ completed` and stored
  `reports.payload`. On a schema-invalid payload it has transitioned `→ failed` and returned
  **without throwing**.
- `backend/src/lib/db.ts` — F02. `prisma`; `reports` row (`status`, `payload`, `pdf_key`,
  `prompt_uuid`, `prompt_version`).
- `backend/src/lib/logger.ts` — F03. `const logger = createLogger('worker')`.
- `backend/src/lib/env.ts` — F03. `config.REDIS_URL` and worker concurrency if F03 exposed one;
  otherwise pick a low constant (e.g. `2`) and note it.
- `worker/` — currently empty except `.workerhere`. **Scaffold here.**
  - `worker/package.json` — **create.** `name: "worker"`, `type: "module"`. Deps: `bullmq`, and
    a workspace dependency on `backend` (`"backend": "*"`) so the consumer can import `runReport`
    and (in R03) `applyTransition`. Dev deps: `tsx`, `typescript`, `vitest`. Scripts:
    `build` (`tsc`), `dev` (`tsx watch src/index.ts`), `start` (`node dist/index.js`),
    `test` (`vitest run`).
  - `worker/tsconfig.json` — **create.** Extends the repo base; emits `dist/`.
  - `worker/src/index.ts` — **create.** Construct `new Worker(REPORT_QUEUE, processor, {
    connection, concurrency: <low> })`; graceful shutdown on `SIGTERM`/`SIGINT`
    (`await worker.close()`); a boot log `logger.info({ concurrency }, "WORKER_STARTED")`.
  - `worker/src/consumer.ts` — **create.** The `processor(job)`:
    1. `const { interviewId } = job.data`; bind `{ interviewId, traceId, jobId: job.id }`.
    2. `logger.info({ interviewId, jobId }, "REPORT_JOB_STARTED")`.
    3. Set `reports.status = 'generating'` for the interview's report row (upsert if the row
       does not yet exist — the enqueue side may have created it `queued`).
    4. `await runReport(interviewId)` (I09).
    5. On return, set `reports.status = 'ready'` and
       `logger.info({ interviewId, jobId }, "REPORT_JOB_COMPLETED")`. (PDF + `pdf_key` are R02;
       here `ready` means the payload is persisted and the interview is `completed`.)
    6. Let a throw propagate (R03 adds retry/dead-letter; here a throw fails the job).
  - `worker/Dockerfile` — **create** (build context = repo root; K10/§8.2). Minimal Alpine Node
    image running `node dist/index.js`. If `compose.yaml` (F03) has no `worker` service entry,
    add a minimal one (a compose entry is config, not schema); note it in `## Notes`.
- `backend/src/lib/error-codes.ts` — F01. No new code needed for this task.

  **The trap:** I07 only **stubbed** `enqueueReport`. The AC-20 assertion "exactly one report job
  is enqueued" and "no additional report job is enqueued" is only truly satisfied once the real
  `Queue.add` with `jobId = interviewId` backs that hook. If you add a *new* producer elsewhere
  and leave the stub, you get two enqueue paths and the idempotency assertion is meaningless.
  Replace the stub body; keep the single emission point.

## Steps
- [ ] **1. Confirm the cross-ledger gate.** `runReport` (`report-run.ts`), `enqueueReport`
  (`sse.ts`), `prisma` (`db.ts`), `config.REDIS_URL` (`env.ts`) and `@interviewly/ai` all exist.
  If any is missing, set this task `blocked` in STATE.md and stop.
- [ ] **2. Create `backend/src/lib/queue.ts`** — `REPORT_QUEUE`, `reportQueue`, the BullMQ
  `connection` from `config.REDIS_URL`. One client; export it for the worker to reuse.
- [ ] **3. Back I07's hook.** Replace `enqueueReport`'s stub body with
  `reportQueue.add(REPORT_QUEUE, { interviewId }, { jobId: interviewId })`; keep the
  `REPORT_JOB_ENQUEUED` log. Grep for `enqueueReport` callers; confirm the single `→ evaluating`
  emission point.
- [ ] **4. Scaffold `worker/`** — `package.json` (deps `bullmq`, workspace `backend`; scripts),
  `tsconfig.json`, `Dockerfile`. Run `npm install` at the repo root; `npm run -w worker build`
  compiles clean.
- [ ] **5. Write `worker/src/index.ts`** — the `Worker(REPORT_QUEUE)` bootstrap + graceful
  shutdown + boot log.
- [ ] **6. Write `worker/src/consumer.ts`** — the processor: `generating` → `runReport(id)` →
  `ready`, with `REPORT_JOB_STARTED`/`REPORT_JOB_COMPLETED` logs. Upsert the `reports` row status
  idempotently.
- [ ] **7. Wire the worker test harness** — `vitest`; a suite that starts a `Worker` against the
  local Redis (`docker compose up -d cache db`) with a `StubAiClient`-backed `runReport`,
  enqueues a job for a seeded `evaluating` interview, and asserts: `reports.status = ready`, the
  interview is `completed`, and a second `add` with the same `interviewId` enqueues no second
  job (BullMQ `getJob(interviewId)` count is 1).
- [ ] **8. Confirm the `@report` acceptance scenario passes through the real worker.** The
  step-def "the report job completes for the interview" must be driven by the real consumer
  (enqueue → worker → `runReport`), replacing interview-core's direct-`runReport` shortcut. Fetch
  `GET /interviews/:id` returns the ready report.
- [ ] **9. Run the `## Verification` command.**

## Definition of done
- Entering `evaluating` enqueues exactly one `report` job (`jobId = interviewId`); re-entering
  `evaluating` for the same id enqueues no second job (AC-20).
- The worker dequeues the job, sets `reports.status = generating`, calls `runReport(interviewId)`,
  and on success sets `reports.status = ready`; the interview is `completed` and
  `GET /interviews/:id` returns the ready report.
- `enqueueReport` has a single real producer body (no parallel enqueue path); the worker never
  writes `interviews.state` directly.
- `npm run -w worker build` compiles; `npm run -w worker test` passes; `@report` is green through
  the real worker.

## Verification
```bash
docker compose up -d db cache
npm run -w worker test
npm run test:acceptance -- --tags "@report"
```

Expected: the worker suite passes (status `ready`, interview `completed`, single job per id); the
`@report` scenario passes end-to-end with the real consumer. Then confirm no secrets leak:
```bash
docker compose logs worker | grep -E "payload|transcript|password|Bearer"
# Must print nothing
```

## Notes

(Empty until the task is done. Fill with: what actually happened, every deviation from the plan,
the worker-suite and Cucumber output verbatim, where `queue.ts` landed and how the worker reuses
the connection, whether a `compose.yaml` `worker` service entry had to be added, how the
acceptance step-def was rewired from the direct-`runReport` shortcut to the real consumer, and a
"For R02/R03" hand-off paragraph naming the `consumer.ts` seam where finalise (R02) and the
dead-letter handler (R03) attach.)
