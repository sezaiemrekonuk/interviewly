# Report — State

Last updated: 2026-08-05
Last session ended: **R04 done.** Added `profiling|hr_round|paused -> abandoned` edges in
`backend/modules/interview/machine.ts` + `machine.test.ts` assertions. New
`worker/src/jobs/abandon-sweep.ts`: staleness is a WHERE clause (`created_at`/`started_at`/
`chat_messages` vs a 24 h cutoff), so `take: 500` bounds transitions, not rows read; covered by
`abandon-sweep.integration.test.ts` because a stubbed `findMany` can only re-state the literal.
Then
`applyTransition(..., 'abandoned', endedReason: 'abandoned')`, `INVALID_STATE_TRANSITION`
skip, per-row failure isolation. Registered repeatable `interview.abandon-sweep` in
`worker/src/index.ts` with clean shutdown close. **bullmq 6 dropped `repeat` from `JobsOptions`
— schedule with `queue.upsertJobScheduler(id, { every }, { name, opts })`, not `queue.add`;
`add` with `repeat` fails `tsc` and, uncaught, enqueues a one-shot that never repeats.** One
trap for any later queue task: `npm run -w worker test` mocks bullmq and never loads
`index.ts`, so run `npm run -w worker build` before calling wiring done. Verification: worker
build clean, `npm run -w worker test` 6 files / 35 tests. Only open typecheck error in the repo
is w11's missing `recharts` in `frontend/src/components/admin/stats-panel.tsx`.

## Execution protocol (follow exactly)

Do not start from this file. `.agents/EXECUTE.md` is the prompt, and its § 4 decides which
task is yours — not the "Current task" pointer below, which is a human-readable summary and
can lag.

Read this file → read `REFERENCE.md` once → read only the task § 4 gave you →
check `MODELS.md` for the required tier and stop if it is not yours → do the work, ticking
checkboxes → run the task's `## Verification` command verbatim → fill in the task's
`## Notes` → update this file's ledger row, "Current task" pointer, and "Last session ended"
line → write `.agents/devlogs/{ID}-<slug>.md` (EXECUTE.md § Devlog) → **do not commit** →
re-apply EXECUTE.md § 4 and continue with what it gives you.

## Current task

R01–R04 are `done`. Report ledger complete.

## Environment

The cross-ledger tasks below must be `done` before the report task that depends on them starts
(per-task `Depends on` in the ledger table):

- **F01** provides `backend/src/lib/error-codes.ts` (no new report code needed) and
  `@interviewly/types`.
- **F02** provides `backend/prisma/schema.prisma` (`reports`, `report_questions`) and
  `backend/src/lib/db.ts` (`prisma`).
- **F03** provides `backend/src/lib/logger.ts`, `backend/src/lib/env.ts` (Redis URL, S3
  bucket config), `compose.yaml` (Postgres + Redis, and the `worker` service entry), and the
  CI acceptance runner.
- **I01/I02** provide `@interviewly/ai` (`AiClient.generateReport`, `ReportPayload` schema,
  `StubAiClient`) and provider execution/cost — used **inside** `runReport`.
- **I06** provides the transcript (`answers` + `chat_messages`) `runReport` reads.
- **I07** provides `enqueueReport` (the hook R01 backs with a real producer),
  `applyTransition` (`machine.ts`, sole state writer, reused by R03), and the SSE channel.
- **I09** provides `runReport(interviewId)` — the function the worker calls.
- **I12** provides `backend/src/lib/storage.ts` (`put`/`get`/`signedUrl`) and the download
  endpoint — used by R02.

Set up the environment once the deps land:

```bash
docker compose up -d db cache          # Postgres + Redis (BullMQ needs Redis)
cd backend && npm install && npx prisma migrate deploy && npm run seed
npm install                            # root: install worker workspace deps (after R01)
npm run -w worker build                # after R01
```

The acceptance runner runs from the repo root (F03/CI). The worker unit suite runs via
`npm run -w worker test` (R01 wires it). Confirm both are wired before running a Verification
command.

```bash
npm run test:acceptance -- --tags "@report"   # R01 end-to-end (real worker path)
npm run -w worker test                          # R01/R02/R03 worker-observable behaviour
```

## Open blockers / decisions for the user

None at ledger-write time.

## Task ledger (R01–R04)

Statuses: todo → in_progress → done → (blocked if waiting on user).
`Repo`: blank = this repo (the `worker/` workspace is in this repo).

| ID | Title | Repo | Status | Depends on |
|----|-------|------|--------|------------|
| R01 | Worker service + BullMQ report consumer: real producer into I07's hook, dequeue → `runReport`, `reports.status` lifecycle | | done | F01, F02, F03, I01, I02, I06, I07, I09 |
| R02 | Render `ReportPayload` to PDF, write `reports.pdf_key` via I12 storage, denormalise `report_questions` | | done | R01, I12 |
| R03 | Retry, backoff, dead-letter `→ failed`; idempotent; transient vs schema-gate branch | | done | R01 |
| R04 | 24 h `abandoned` sweeper: repeatable job ends interviews stale in `profiling`/`hr_round`/`paused` past 24 h → `abandoned` via `applyTransition` (adds the `→ abandoned` edges), idempotent, no AI | | done | R01 |

## Critical path

Cross-ledger (foundations + interview-core spine through I07/I09) → **R01** → {R02, R03, R04}.
R02, R03 and R04 depend only on R01 and are **independent of each other** — any order is safe
once R01 is green. R04 also modifies `machine.ts` (adds the `→ abandoned` edges) but shares no
file with R02/R03.

## Cross-ledger dependencies (blocks this ledger)

**No report task may be merged until its cited cross-ledger tasks are green.** A partial state
(e.g. I07 done but I09 not) means the worker has a queue to dequeue from but no `runReport` to
call — R01 cannot complete.

| Ledger task | Provides | Needed by |
|---|---|---|
| F01 | `error-codes.ts` (report adds no new code; consumes `AI_OUTPUT_INVALID`, `INTERVIEW_NOT_FOUND`), `@interviewly/types` | R01–R03 |
| F02 | `schema.prisma` (`reports`, `report_questions`), `db.ts` (`prisma`) | R01–R03 |
| F03 | `logger.ts`, `env.ts` (Redis URL, S3 config), `compose.yaml` (Postgres + Redis + `worker` service), CI acceptance runner | R01–R03 |
| I01 | `@interviewly/ai`: `AiClient` interface, `ReportPayload` schema, `StubAiClient` | R01 (via `runReport`), R02 (payload shape) |
| I02 | Provider execution + per-attempt `llm_calls` + cost (the real `generateReport`) | R01 (via `runReport`) |
| I06 | Transcript writer (`answers` + `chat_messages`) `runReport` reads | R01 (via `runReport`) |
| I07 | `enqueueReport` hook (R01 backs with real `Queue.add`), `applyTransition` (R03 reuses for `→ failed`), SSE channel | R01, R03 |
| I09 | `runReport(interviewId)` + `ReportPayload` schema gate + `evaluating → completed \| failed` | R01 |
| I12 | `storage.ts` (`put`/`signedUrl`) + `GET /interviews/:id/report/download` | R02 |

## Cross-ledger dependencies (this ledger blocks — waiting ledgers cite these task IDs)

| This task | Provides | Consumed by ledger |
|---|---|---|
| R02 | `reports.pdf_key` populated + `report_questions` rows denormalised from the payload | admin (weakest-question stats read `report_questions`; download surfaces the PDF) |
| R03 | `reports.status = failed` + dead-letter cause on report-job exhaustion | admin (dead-letter/"try again" surfacing, K10) |

## Backlog (deferred, unnumbered — promote to a task when its trigger fires)

- **24 h `abandoned` sweeper** — **promoted to R04** (2026-08-03, PLAN_FRONTEND_LEDGER.md §6.2 +
  ADR-R05): it is one repeatable job in the existing `worker/` process, not a new ledger's worth of
  work, so it lives here beside the report consumer rather than in a separate `worker`/ops ledger.
- **Voice-usage reconciliation job** — also `worker/`, owned by the `voice` ledger's
  reconciliation slice (`voice_reconciliation.feature`). Not a report concern.
- **`report_questions(question_id)` index** — the admin weakest-question aggregation may want
  it; F02 has no such index yet. Promote as a safe additive migration rebased on F02 when the
  admin query is specced and measured slow.
- **Richer PDF layout / branding** — R02 renders a boring, correct `pdfkit` document. Promote a
  visual pass only if PDF export is pulled from §12 bonus into a graded deliverable.
