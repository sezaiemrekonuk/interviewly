# Report — REFERENCE (read this once, then you don't need to spelunk)

Single orientation doc for any agent executing a task in this ledger. This file reflects the
project layout **as it will exist after foundations (F01–F03) and interview-core (I01, I02,
I06, I07, I09, I12) are done** — those tasks build everything this ledger consumes. If a path
listed here does not exist, its cross-ledger task has not landed — check STATE.md's
"Cross-ledger dependencies" table before proceeding. Verified against the interview-core and
foundations task files as of 2026-07-30. If reality diverges, trust the code and patch this
file.

## Services, ports, roles

| Service | Package | Port (internal) | DB role | Trust |
|---|---|---|---|---|
| `api` | `backend/` | 3001 | reads/writes all tables | trusted internal; produces report jobs (I07 hook) |
| `worker` | `worker/` | none (no HTTP) | reads/writes `reports`, `report_questions`, `interviews.state` (via I07) | trusted internal; consumes the `report` queue |
| `db` | Postgres (compose) | 5432 | persistence | not published on host (K14) |
| `cache` | Redis (compose) | 6379 | BullMQ `report` queue + SSE fan-out | not published on host |
| `edge` | Caddy | 443 (host) | none | single published port (F03) |

The report consumer runs inside `worker`, a **separate container at low concurrency** so report
load never touches `api` request threads (K10). It has no HTTP surface; it is driven entirely by
the BullMQ `report` queue on Redis.

## Commands

```bash
# Start dependencies (from repo root)
docker compose up -d db cache          # Postgres + Redis — BullMQ needs Redis

# Backend migrate + seed (from backend/)
cd backend && npm install && npx prisma migrate deploy && npm run seed

# Worker (from repo root; workspace is worker/)
npm install                            # installs worker deps once R01 adds them
npm run -w worker build                # tsc → worker/dist
npm run -w worker dev                  # tsx watch — runs the Worker against local Redis
npm run -w worker test                 # vitest — worker unit/integration suite (R01 wires it)

# Report acceptance path (from repo root)
npm run test:acceptance -- --tags "@report"
```

## The `report` queue contract (this ledger's spine)

| Thing | Value | Owner |
|---|---|---|
| Queue name | `REPORT_QUEUE = "report"` (const in `backend/src/lib/queue.ts`) | R01 |
| Job payload | `{ interviewId: string }` | R01 |
| Job id (idempotency) | `jobId = interviewId` — BullMQ dedupes a re-add (AC-20) | R01 |
| Connection | BullMQ `Redis` from `config.REDIS_URL` (F03 `env.ts`); reuse one client | R01 |
| Attempts / backoff | `attempts: 3`, `backoff: { type: 'exponential', delay: 1000 }` | R03 |
| Producer | `reportQueue.add(...)` inside I07's `enqueueReport` hook (`api` side) | R01 |
| Consumer | `Worker(REPORT_QUEUE, processor, { concurrency: <low> })` in `worker/src/index.ts` | R01 |

`worker/` declares a workspace dependency on `backend` so the consumer can
`import { runReport } from "backend/modules/interview/report-run"` (I09) and
`import { applyTransition } from "backend/modules/interview/machine"` (I07). Both operate on the
shared Postgres (`db.ts`) and Redis, so they are safe to call from the worker process.

## `reports.status` job lifecycle (owned here)

`reports.status ∈ { queued | generating | ready | failed }` (K13) is the **job's** status, not
the interview's state. The `interviews.state` machine (`evaluating → completed | failed`) is
I07/I09's and is written **only** through `applyTransition`.

| Transition | Set by | When |
|---|---|---|
| `→ queued` | R01 (producer side / on enqueue) | I07 hook adds the job |
| `→ generating` | R01 (consumer) | worker picks up the job, before `runReport` |
| `→ ready` | R02 (finalise) | after `runReport` success + PDF stored + `pdf_key` written |
| `→ failed` | R03 (dead-letter) | after 3 transient retries exhausted |

I09's `runReport` sets the **interview** state (`completed`/`failed`) and writes
`reports.payload`; it does not manage `reports.status`. On a schema-invalid payload, `runReport`
sets the interview `failed` and returns without throwing — the worker leaves `reports.status`
consistent (`failed`) and does **not** retry.

## Key code anchors

All paths are relative to repo root. Rows marked **create** are authored by this ledger; the
rest exist once their cross-ledger task lands.

| Path | Task | What it does |
|---|---|---|
| `backend/src/lib/queue.ts` | **R01, create** | `reportQueue` producer + `REPORT_QUEUE` name + BullMQ connection from `config.REDIS_URL` |
| `backend/modules/interview/sse.ts` | I07 | Holds `enqueueReport(interviewId)`; R01 replaces its stub body with `reportQueue.add(...)` |
| `backend/modules/interview/report-run.ts` | I09 | `runReport(interviewId)` — the worker calls this; do not re-implement |
| `backend/modules/interview/machine.ts` | I07 | `applyTransition(interview, to, ctx)` — sole `interviews.state` writer; R03 uses for `→ failed` |
| `backend/src/lib/storage.ts` | I12 | `put(key, bytes, mime)`, `signedUrl(key, ttl≤300)` — R02 stores the PDF here |
| `backend/src/lib/db.ts` | F02 | `prisma` singleton; `reports`, `report_questions` tables |
| `backend/src/lib/logger.ts` | F03 | pino factory: `logger.<level>({obj}, "EVENT_NAME")` |
| `backend/src/lib/env.ts` | F03 | `config` — `REDIS_URL`, `S3_BUCKET`, S3 endpoint/creds |
| `packages/ai/src/schemas.ts` | I01 | `ReportPayload` type — R02's PDF renderer takes this shape |
| `worker/package.json` | **R01, create** | `name: "worker"`, deps: `bullmq`, `pdfkit` (R02), workspace dep on `backend`; `build`/`dev`/`test` scripts |
| `worker/src/index.ts` | **R01, create** | Bootstrap the `Worker(REPORT_QUEUE)`, graceful shutdown (SIGTERM), `SERVER_STARTED`-style boot log |
| `worker/src/consumer.ts` | **R01, create** | The processor: status `generating` → `runReport(id)` → hand to finalise (R02) → status `ready` |
| `worker/src/render-pdf.ts` | **R02, create** | `renderReportPdf(payload: ReportPayload): Buffer` — pure, no I/O |
| `worker/src/finalize.ts` | **R02, create** | `storage.put` the PDF under `reports/<interviewId>.pdf` → `reports.pdf_key`. Not `report_questions` — I09 writes those (ADR-R06) |
| `worker/src/failure.ts` | **R03, create** | Retry/backoff config + dead-letter handler → `applyTransition(evaluating → failed)` + `reports.status = failed` |
| `worker/tests/**` | **R01, create** | vitest suite; BullMQ against local Redis, `StubAiClient` for `runReport`'s AI calls |

## Schema (tables this ledger reads/writes)

Owned by F02. This ledger writes only these columns:

```
reports
  id            String @id (cuid)
  interview_id  String FK → interviews.id
  status        ReportStatus  (queued|generating|ready|failed)   ← worker writes generating/ready/failed
  payload       Json?          ← written by I09's runReport, read by R02 to render the PDF
  pdf_key       String?        ← written by R02 (the storage key of the rendered PDF)
  prompt_uuid   String         ← written by I09
  prompt_version Int           ← written by I09
  created_at    DateTime @default(now())

report_questions                ← written by R02 (denormalised from payload.questions[])
  id             String @id (cuid)
  report_id      String FK → reports.id
  question_id    String FK → questions.id
  score          Int            (0..5)
  reason         String
  star_adherence Float          (0..1)
```

`interviews.state` is written **only** via `applyTransition` (I07); the worker never issues a
raw `prisma.interview.update({ data: { state } })`.

## Conventions

**No new error codes.** The report worker sets state/status and logs; it returns no HTTP error
of its own. `runReport`'s `AI_OUTPUT_INVALID`/`AI_OUTPUT_SCHEMA_INVALID` and I12's
`INTERVIEW_NOT_FOUND` are the only report-adjacent codes, all from F01.

**Log shape** (K6): `logger.info({ interviewId, traceId, jobId }, "REPORT_JOB_STARTED")` —
structured object first, SCREAMING_SNAKE event second. Events this ledger emits:
`REPORT_JOB_STARTED`, `REPORT_PDF_RENDERED`, `REPORT_JOB_COMPLETED`, `REPORT_JOB_FAILED`,
`REPORT_DEAD_LETTERED`. Never log the `payload`, the PDF bytes, the signed URL, the transcript,
or any PII/secret (K6, §7.2). `REPORT_JOB_ENQUEUED` is emitted on the `api` side by I07's hook.

**Idempotency.** `jobId = interviewId` dedupes the producer; every consumer path must be safe to
run twice, because a retry re-runs the processor from scratch. `runReport` re-runs from
`evaluating` and `applyTransition` is guarded, so a double-run does not double-transition. R02's
finalise is idempotent by construction (the PDF key is derived from `interviewId`, so a re-run
overwrites one object and rewrites one column).
`report_questions` is I09's, written once inside its report-row transaction (ADR-R06).

**Transient vs permanent failure** (ADR-R04). A **thrown** error from `runReport` is transient →
retried by BullMQ (3 attempts, exponential backoff base 1000 ms) → dead-letter `→ failed`. A
schema-invalid payload is handled **inside** `runReport` (interview set `failed`, no throw) → the
job completes on attempt 1 and is **not** retried. Do not wrap `runReport` in a catch that
converts a schema failure into a retry.

**Migration rule** (ADR-F02 / ADR-I…): no structural schema change here. A new index (e.g.
`report_questions(question_id)`) is a new Prisma migration file rebased on the F02 migration
before merge — never an edit to an existing migration SQL file.

**Worker container** (K10, §8.2). The worker is a separate image built from the repo root
(workspace packages live there). Its module README states what it may import: `backend`
(`runReport`, `applyTransition`, `storage`, `db`, `logger`, `env`), `@interviewly/ai`
(`ReportPayload`), `bullmq`, `pdfkit`. It imports no auth, admin, or voice module.
