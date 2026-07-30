# Report — PLAN (Architecture)

Written once. Amend only via a new `DECISIONS.md` ADR-R entry referenced here.
Codebase orientation: `REFERENCE.md` (read that before touching any task).

## Goal

When this ships, a completed interview is turned into a delivered report by the **real
`worker/` BullMQ consumer**: the job `interview-core` enqueues on `→ evaluating` is dequeued
by a low-concurrency worker, which calls interview-core's `runReport(interviewId)` to produce
and persist the validated `ReportPayload`, renders that payload to a PDF, stores it and writes
`reports.pdf_key`, and — on a report-job failure that exhausts its retries — dead-letters the
interview to `failed`. `docker compose up` → answer an interview to its last question →
the report job runs in the worker → `GET /interviews/:id` returns the ready report and
`GET /interviews/:id/report/download` hands back a short-lived signed URL for the rendered
PDF is the observable end-to-end result.

## The invariant this initiative must not weaken

> A report is delivered only after its `ReportPayload` passed the schema gate; a report job
> never bills twice, never double-transitions an interview, and a permanently-bad report ends
> the interview `failed` rather than looping. (K10, K15, §5.5 layer 2, §8.3)

Report delivery is a correctness-and-cost invariant on the queue boundary: a job that runs
twice bills the LLM twice and can double-write, and a report that lands unvalidated is the
exact failure the K15 schema gate exists to stop. This ledger touches only `worker/`, a small
BullMQ producer helper in `backend/src/lib/`, and interview-core's `enqueueReport` hook. It
**consumes, and does not rebuild,** interview-core's `runReport`, the `ReportPayload` schema
gate and the `evaluating → completed | failed` transition (I09), the enqueue hook that fires
one job per interview (I07), and the object-storage signed-URL wrapper + download endpoint
(I12). It deliberately does not touch the state machine, the answer flow, the AI package, the
auth boundary, or the admin read endpoints.

## Scope boundary — consumed, not rebuilt (read this before anything)

Interview-core **already builds** these; this ledger calls them and must not re-implement them:

- **I09** — `runReport(interviewId)` in `backend/modules/interview/report-run.ts`: loads the
  transcript, calls `AiClient.generateReport`, validates against the `ReportPayload` Zod
  schema, and branches `evaluating → completed` (stores `reports.payload`,
  `prompt_uuid`/`prompt_version`) or `evaluating → failed` (no payload, logs
  `AI_OUTPUT_SCHEMA_INVALID`). **The worker calls this function; it never re-derives the
  schema gate or the state transition.**
- **I07** — the `enqueueReport(interviewId)` hook that fires exactly once on `→ evaluating`
  (idempotent by `interviewId`, logs `REPORT_JOB_ENQUEUED`) and `applyTransition` on
  `machine.ts`, the sole writer of `interviews.state`. This ledger wires the **real** BullMQ
  `Queue.add` into that hook and reuses `applyTransition` for the dead-letter `→ failed` edge.
- **I01 / I02** — `@interviewly/ai` (`AiClient.generateReport`, `ReportPayload` schema,
  `StubAiClient`) and the provider execution/cost/`llm_calls` layer. `runReport` uses these;
  the worker never touches a provider SDK directly.
- **I12** — `storage.ts` (`put`/`get`/`signedUrl`, 300 s cap) and
  `GET /interviews/:id/report/download`. This ledger renders the PDF and writes
  `reports.pdf_key`; **I12's endpoint signs it — this ledger adds no download route.**
- **I06** — the transcript (`answers` + `chat_messages`) `runReport` reads.

**What this ledger owns (what interview-core deliberately left out):** the real `worker/`
service and its BullMQ `report`-queue consumer; the `reports.status` job lifecycle
(`queued → generating → ready | failed`); server-side PDF rendering of the completed
`ReportPayload` and the `reports.pdf_key` write; denormalising `payload.questions[]` into
`report_questions` when the artifact is finalised; and the retry / backoff / dead-letter
handling that ends a report-job failure as `failed` (K10).

## Topology

```
Browser
  │  POST /interviews/:id/answers        (last question → evaluating)   ← interview-core
  │  GET  /interviews/:id                (reads reports.payload)         ← interview-core
  │  GET  /interviews/:id/report/download (signs reports.pdf_key)        ← I12
  ▼
edge/ (Caddy — single published port, F03)
  ▼
backend/src/app.ts (api)                 ← interview-core mounts its router
  │
  ├── modules/interview/sse.ts           ← I07 enqueueReport() hook
  │        │  (this ledger replaces the stub with the REAL producer)
  │        ▼
  └── src/lib/queue.ts        ← NEW (R01): reportQueue producer, REPORT_QUEUE name,
                                 Queue.add(interviewId, { jobId: interviewId })   (idempotent)
                    │
                    ▼
              Redis (F03)   ← BullMQ `report` queue (K10: retry, backoff, dead-letter)
                    │
                    ▼
worker/  (separate container, low concurrency — K10)
  src/index.ts       ← NEW (R01): Worker(REPORT_QUEUE) bootstrap, graceful shutdown
  src/consumer.ts    ← NEW (R01): dequeue → set status generating → runReport(id) (I09)
                                     → set status ready → REPORT_JOB_COMPLETED
  src/render-pdf.ts  ← NEW (R02): ReportPayload → PDF bytes (pdfkit)
  src/finalize.ts    ← NEW (R02): storage.put(pdf) → reports.pdf_key; denormalise
                                     payload.questions[] → report_questions
  src/failure.ts     ← NEW (R03): retry/backoff config; on dead-letter →
                                     applyTransition(evaluating → failed) + status failed
                    │                    │
                    ▼                    ▼
        backend/src/lib/storage.ts   backend/modules/interview/machine.ts
        (I12: put + signedUrl)       (I07: applyTransition — sole state writer)
                    │
                    ▼
        Object store (private report bucket) — I12 signs, 300 s TTL

Postgres (F02): reports (status, payload, pdf_key, prompt_uuid, prompt_version),
                report_questions (question_id, score, reason, star_adherence)
```

## Decision table (full ADRs in DECISIONS.md)

| # | Decision | Chosen | Reason |
|---|----------|--------|--------|
| ADR-R01 | Producer + consumer wiring | This ledger wires the **real** BullMQ `Queue.add` into I07's `enqueueReport` hook and the `Worker` consumer; `jobId = interviewId` | K10 — the queue is report's; I07 only emitted the hook. `jobId = interviewId` is BullMQ's own idempotency and satisfies "exactly one report job per interview" |
| ADR-R02 | Report generation ownership | The worker **calls** I09's `runReport`; it owns only the `reports.status` lifecycle, PDF, `pdf_key` and `report_questions` denormalisation | The schema gate + interview transition are correctness-critical and already built (I09); re-implementing them in the worker is the exact duplication the scope boundary forbids |
| ADR-R03 | PDF rendering library | `pdfkit` (pure-JS, programmatic) renders `ReportPayload` server-side | K15 renders in `worker`; `pdfkit` needs no headless Chromium and no native toolchain on Alpine — the same reasoning that chose `unpdf` (K12) and `@node-rs/argon2` (K8) |
| ADR-R04 | Retry / dead-letter policy | 3 attempts, exponential backoff; a **transient** job error retries then dead-letters `→ failed`; a **permanent** I09 schema-gate `failed` never retries | K10 — three retries then dead-letter → `failed`; a schema failure is deterministic, so retrying it only burns three LLM calls for the same bad output |

## Data model additions

**No structural changes.** This ledger consumes the F02 schema in full and writes only into
columns F02 already declared:

| Table | Report worker reads | Report worker writes |
|---|---|---|
| `reports` | `interview_id`, `payload`, `status`, `pdf_key`, `prompt_uuid`, `prompt_version` | `status` (`generating`/`ready`/`failed`), `pdf_key` (R02) |
| `report_questions` | — | one row per `payload.questions[]` item: `question_id`, `score`, `reason`, `star_adherence` (R02) |
| `interviews` | `id`, `state` | `state = failed` on dead-letter, **only** via I07's `applyTransition` (R03) |

`reports.payload`, `reports.prompt_uuid`, `reports.prompt_version` and the
`evaluating → completed` transition are written by **I09's `runReport`**, not here.

No index is required beyond F02's §8.1 set. Should one become necessary (e.g. a
`report_questions(question_id)` index for the admin weakest-question query), it is authored as
a new Prisma migration file rebased on the F02 migration before merge — never an edit to the
existing migration SQL.

## Report job lifecycle (the core mechanic)

`reports.status` (`queued | generating | ready | failed`, K13) is the **job's** status and is
owned here; the `interviews.state` machine is I07's. One walk of a normal job:

1. `api` enters `evaluating` → I07's `enqueueReport` hook (now backed by the real producer)
   calls `Queue.add(REPORT_QUEUE, { interviewId }, { jobId: interviewId })`; `reports.status`
   is `queued`. Re-entering `evaluating` for the same id adds no second job (BullMQ dedupes on
   `jobId`) — the AC-20 assertion.
2. The worker dequeues, sets `reports.status = generating`, logs `REPORT_JOB_STARTED`.
3. It calls `runReport(interviewId)` (I09): success stores `reports.payload` and transitions
   the interview `evaluating → completed`; a schema-invalid payload transitions `→ failed`,
   stores no payload and logs `AI_OUTPUT_SCHEMA_INVALID` (I09 handles this branch and does
   **not** throw, so the job is not retried).
4. On the success path the worker renders the PDF (R02), `storage.put`s it, writes
   `reports.pdf_key`, denormalises `report_questions`, sets `reports.status = ready`, logs
   `REPORT_PDF_RENDERED` + `REPORT_JOB_COMPLETED`, and emits the SSE nudge via I07's channel.
5. A **transient** throw from `runReport` (e.g. `AI_PROVIDER_UNAVAILABLE`, a DB error) is
   retried by BullMQ (backoff). After 3 attempts the job dead-letters: the worker calls
   `applyTransition(evaluating → failed)` (I07), sets `reports.status = failed`, logs
   `REPORT_JOB_FAILED` + `REPORT_DEAD_LETTERED`. Admin surfaces the dead-letter cause.

## Error codes and events

**No new error codes.** The report worker sets state and status; it surfaces no HTTP error of
its own (`runReport`'s `AI_OUTPUT_*` and I12's `INTERVIEW_NOT_FOUND` are the API-facing codes,
both from F01). Events this ledger emits (K6 shape, `{ traceId, interviewId }`):
`REPORT_JOB_STARTED`, `REPORT_PDF_RENDERED`, `REPORT_JOB_COMPLETED`, `REPORT_JOB_FAILED`,
`REPORT_DEAD_LETTERED`. `REPORT_JOB_ENQUEUED` is emitted on the `api` side by I07's hook.

## Phasing / task clusters (see STATE.md ledger)

0. Consumer (R01) — worker service + real producer wired into I07's hook + dequeue → `runReport`
   + `reports.status` lifecycle; makes `@report` green end-to-end through the real worker.
1. Artifact (R02) — PDF render + `reports.pdf_key` + `report_questions` denormalisation.
2. Reliability (R03) — retry / backoff / dead-letter `→ failed`, idempotent.

R02 and R03 both depend only on R01 and are **independent of each other** — either order is
safe once R01 is green.

## Out of scope (post-report)

- The 24 h `abandoned` sweeper and voice-usage reconciliation — also `worker/`, but the
  `voice`/`worker` sweep is a different job type; this ledger builds only the report consumer.
- The report **download endpoint** and the signed-URL wrapper — I12 (interview-core). This
  ledger writes `reports.pdf_key`; I12's `GET /interviews/:id/report/download` signs it.
- The `ReportPayload` schema, `runReport`, and the `evaluating → completed | failed`
  transition — I09. Re-implementing any of them here is the scope violation this section
  fences off.
- The admin dead-letter/cost surfacing UI and `report_questions` **reads** — `admin` ledger.
  This ledger only **writes** `report_questions` when it finalises the artifact.
- Report PDF export is a §12 **bonus** deliverable (K15: "first thing cut, cutting it costs
  nothing mandatory"). The mandatory K15 report is the `reports.payload` served by
  `GET /interviews/:id`, delivered by R01. **R02 is therefore the cut-first task** if the
  deadline squeezes; R01 (consumer) and R03 (reliability) stand without it.

**The entire schema lives in F02. This ledger may add indexes and nullable columns only, each
in its own migration, rebased before merge. Any structural change is a change to F02's scope
and gets discussed, not merged. This is the week-one collision that breaks `docker compose up`
on a fresh clone, which §10 calls the one unacceptable failure.**
