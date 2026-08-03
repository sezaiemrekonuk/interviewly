# R01 — Worker service + BullMQ report consumer: real producer into I07's hook, dequeue → `runReport`, `reports.status` lifecycle
REPO: (this repo) · Depends: F01, F02, F03, I01, I02, I06, I07, I09 · Status: done
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

**Note added 2026-07-30 — `worker/` now hosts a second job.** Auth A04 adds an `email.send`
consumer (K8.6) to the same workspace and the same BullMQ connection. Whichever task lands first
scaffolds `worker/`; the second one **registers another queue consumer and does not restructure the
first**. Keep the queue registration a list, not a hard-coded single worker, so the second job is an
append. The report job stays low-concurrency (K10); `email.send` is cheap and does not change that
setting.

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
- [x] **1. Confirm the cross-ledger gate.** `runReport` (`report-run.ts`), `enqueueReport`
  (`sse.ts`), `prisma` (`db.ts`), `config.REDIS_URL` (`env.ts`) and `@interviewly/ai` all exist.
  If any is missing, set this task `blocked` in STATE.md and stop.
- [x] **2. Create `backend/src/lib/queue.ts`** — `REPORT_QUEUE`, `reportQueue`, the BullMQ
  `connection` from `config.REDIS_URL`. One client; export it for the worker to reuse.
- [x] **3. Back I07's hook.** Replace `enqueueReport`'s stub body with
  `reportQueue.add(REPORT_QUEUE, { interviewId }, { jobId: interviewId })`; keep the
  `REPORT_JOB_ENQUEUED` log. Grep for `enqueueReport` callers; confirm the single `→ evaluating`
  emission point.
- [x] **4. Scaffold `worker/`** — `package.json` (deps `bullmq`, workspace `backend`; scripts),
  `tsconfig.json`, `Dockerfile`. Run `npm install` at the repo root; `npm run -w worker build`
  compiles clean.
- [x] **5. Write `worker/src/index.ts`** — the `Worker(REPORT_QUEUE)` bootstrap + graceful
  shutdown + boot log.
- [x] **6. Write `worker/src/consumer.ts`** — the processor: `generating` → `runReport(id)` →
  `ready`, with `REPORT_JOB_STARTED`/`REPORT_JOB_COMPLETED` logs. Upsert the `reports` row status
  idempotently.
- [x] **7. Wire the worker test harness** — `vitest`; a suite that starts a `Worker` against the
  local Redis (`docker compose up -d cache db`) with a `StubAiClient`-backed `runReport`,
  enqueues a job for a seeded `evaluating` interview, and asserts: `reports.status = ready`, the
  interview is `completed`, and a second `add` with the same `interviewId` enqueues no second
  job (BullMQ `getJob(interviewId)` count is 1).
- [x] **8. Confirm the `@report` acceptance scenario passes through the real worker.** The
  step-def "the report job completes for the interview" must be driven by the real consumer
  (enqueue → worker → `runReport`), replacing interview-core's direct-`runReport` shortcut. Fetch
  `GET /interviews/:id` returns the ready report.
- [x] **9. Run the `## Verification` command.**

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

**Producer.** `backend/src/lib/queue.ts` — `REPORT_QUEUE = 'report'` + one `reportQueue`
(`connection: { url: config.REDIS_URL }`). `enqueueReport` (`sse.ts`) is now `async` and its body
is `reportQueue.add(REPORT_QUEUE, { interviewId }, { jobId: interviewId })`; `machine.ts` awaits
it. Single emission point, unchanged: `applyTransition(… 'evaluating')`. No second producer.

**Consumer.** `worker/src/consumer.ts` exports `processReportJob`; `worker/src/index.ts`
registers it as a second `Worker` beside A04's `email.send` (queue registration is additive, per
the 2026-07-30 note). `REPORT_CONCURRENCY = 2` — `env.ts` exposes no override.

**Deviation — no `generating` status.** Step 6 asked for `reports.status = 'generating'` before
`runReport` and `'ready'` after. Not possible: `runReport` (I09, `report-run.ts:159`) *creates*
the row inside its own transaction, already `status: 'ready'`. There is no row to pre-set, and
inserting a placeholder would race that `create` (unique-free table, so it would double-insert).
The consumer therefore only logs `REPORT_JOB_STARTED`/`REPORT_JOB_COMPLETED` around the call.
R02/R03 that want a real `generating` window must change I09's row creation, not the consumer.

**Deviation — cross-workspace import path.** `worker` imports `@interviewly/backend`, a new
barrel `backend/src/worker-exports.ts` (`runReport`, `REPORT_QUEUE`, `reportQueue`, `prisma`) —
`src/index.ts` cannot be the entry, it calls `app.listen()` on import. `backend/package.json`
`main`/`types` now point at `dist/src/worker-exports.{js,d.ts}` and `declaration: true` was added
to `backend/tsconfig.json`. `worker/tsconfig.json` keeps `paths: {}`, so this resolves through
node_modules to backend's **built** `dist` — `worker/Dockerfile` builds `@interviewly/ai` then
`@interviewly/backend` then the worker, and runs `prisma generate` in both `build` and
`prod-deps`. Root `tsconfig.json` maps `@interviewly/backend` to the source for typecheck.

**`GET /interviews/:id` did not exist.** AC-20's last step needs it; no dependency task builds it
(I12 owns only `/report/download`). Added `backend/modules/interview/get.ts` (state + `{ status,
payload }`), mounted in `router.ts` behind `resolveInterview`.

**Trap found and fixed — both acceptance rings hung.** `src/lib/queue.ts`'s BullMQ connection is
eager and module-level, so `app` importing the interview router keeps the event loop alive:
cucumber printed its summary and never exited (the exact failure `server.ts`'s `setEmailQueue`
seam exists for; the report queue can't take that route because AC-20 asserts on the real job).
`reportQueue.close()` added to both teardowns — `features/step_definitions/server.ts` (default
ring) and `tests/support/harness.ts` (auth ring).

**Two more red-at-first-run step-def defects:** the SSE `Given` had arity 0 against a `{string}`
parameter, and `'I submit an answer for the current question'` was redefined here though I08's
`budget.steps.ts:43` already owns it (ambiguous, not additive) — the duplicate was deleted, the
scenario reuses I08's.

**Acceptance wiring.** `report.feature` added to `cucumber.js` `default.paths`. The step
`the report job completes for the interview` builds a `Worker` over the real queue and calls
`runReport` — it does **not** import `worker/src/consumer.ts`: cucumber runs backend source via
tsx and worker's `logger`/`env.ts` would drag in a second Zod env schema (`S3_*`, `MAIL_FROM`,
`PUBLIC_ORIGIN`) that CI's acceptance job does not set, and `env.ts` calls `process.exit(1)`.
The processor body is mirrored, and `consumer.test.ts` is what covers the real one.

**Worker test harness.** `worker/vitest.config.mts` is its own project (aliases
`@interviewly/backend`/`@interviewly/ai` to source), composed into the root config; the root
`node` project's include dropped `worker` so files don't run twice. It sets
`env: { AI_ENABLED: 'false' }` — same forcing as `cucumber.js`, without it a developer `.env`
with `AI_ENABLED=true` bills live providers from a unit run.

**Verification (2026-08-04).** `npm run -w worker test` 2/2. `npm run test:acceptance --
--tags "@report"` 1 scenario / 13 steps passed. Full rings: default 47/47, auth 23/23
(`-p auth`, needs `…/interviewly_test`). `npm test` 21 files / 124 tests. `lint`, `typecheck`,
`npm run -w worker build` clean. `docker compose build worker` + `up -d worker` boots:
`WORKER_STARTED {"queues":["email.send","report"],"reportConcurrency":2}`.
`docker compose logs worker | grep -E "payload|transcript|password|Bearer"` printed nothing.
Local runs need the published host ports — `localhost:15432` / `redis://localhost:16380`, not
`.env`'s compose names.

**`compose.yaml`** already had a `worker` service (F03) — no entry added.

**For R02/R03.** The seam is `processReportJob` in `worker/src/consumer.ts`: R02's PDF render +
`pdf_key` write goes after the `await runReport(interviewId, { traceId })` line, R03's
retry/backoff/dead-letter attaches at the `new Worker(REPORT_QUEUE, …)` options in
`worker/src/index.ts` plus the existing `reportWorker.on('failed', …)` handler, which today only
logs `REPORT_JOB_FAILED`. Note for R03: `runReport` does **not** throw on a schema-invalid
payload (it transitions `→ failed` and returns), so the transient-vs-schema-gate branch has to
read state, not catch. Anything importing more of `backend` from `worker` must be added to
`backend/src/worker-exports.ts` — subpath imports are not resolvable from the built package.
