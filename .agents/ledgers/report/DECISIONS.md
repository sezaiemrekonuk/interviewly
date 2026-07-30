# Report — Decisions (append-only ADR log)

Never edit past entries. Supersede with a new dated entry referencing the one it changes.
Prefix `ADR-R` to avoid collision with foundations (`ADR-F`), auth (`ADR-A`), interview-core
(`ADR-I`) and other ledgers. Referenced back into `PLAN.md`.

---

## ADR-R01 — 2026-07-30 — The report ledger wires the real BullMQ producer + consumer; `jobId = interviewId`

**Context:** Interview-core's I07 exposes an `enqueueReport(interviewId)` **hook stub** that
logs `REPORT_JOB_ENQUEUED` on `→ evaluating`; it deliberately does not talk to a broker ("the
real BullMQ job is the report ledger's"). This ledger must decide where the producer and
consumer live and how "exactly one report job per interview" (AC-20) is guaranteed. Options:
(A) wire a real BullMQ `Queue.add` into I07's hook (producer in `api`) and a `Worker` in
`worker/`, keyed `jobId = interviewId`; (B) have the worker poll for interviews in `evaluating`
without a queue; (C) an application-level dedupe table checked before enqueue.

**Decision:** (A). A shared `backend/src/lib/queue.ts` exports `reportQueue` and the
`REPORT_QUEUE` name; this ledger replaces I07's stub body with
`reportQueue.add(REPORT_QUEUE, { interviewId }, { jobId: interviewId })`. `worker/src/index.ts`
runs a BullMQ `Worker(REPORT_QUEUE)` at low concurrency. `jobId = interviewId` is BullMQ's own
idempotency key — a second `add` for an id whose job is still known is a no-op, which is
exactly the AC-20 "no additional report job is enqueued" assertion, with no bespoke dedupe
table.

**Why not polling (B):** A poll loop reinvents backoff, retry, priority and dead-letter that
BullMQ already provides on the Redis already in the stack (K10) — the specific machinery K10
chose BullMQ to avoid hand-rolling.

**Why not an app-level dedupe table (C):** It adds a table (an F02 schema change, forbidden
here) and a race window between the check and the insert. `jobId` dedupe is atomic in Redis
and free.

**Consequences:** `worker/` gains a workspace dependency on `backend` so it can import
`runReport` (I09) and `applyTransition` (I07). The producer lives in `api` (inside I07's hook);
the consumer lives in `worker/`. Live interviews keep resource priority because the worker runs
at low concurrency in its own container (K10) — the asymmetry that justifies the split.

---

## ADR-R02 — 2026-07-30 — The worker calls I09's `runReport`; it never re-derives the schema gate or the interview transition

**Context:** The report job must produce a validated `ReportPayload`, transition the interview
`evaluating → completed | failed`, and persist the payload — all of which I09 already builds as
`runReport(interviewId)`. The fork: (A) the worker calls `runReport` and layers only the job
lifecycle (`reports.status`, PDF, `pdf_key`, `report_questions`) on top; (B) the worker
re-implements report generation and the schema gate inline so it is "self-contained".

**Decision:** (A). `runReport` is the single owner of `AiClient.generateReport`, the
`ReportPayload` Zod gate, the `reports.payload`/`prompt_uuid`/`prompt_version` write, and the
`evaluating → completed | failed` transition. The worker's consumer sets `reports.status =
generating`, calls `runReport(interviewId)`, and — on the success path only — renders the PDF,
writes `pdf_key`, denormalises `report_questions` and sets `reports.status = ready`. The
`reports.status` job lifecycle and everything downstream of a valid payload are the worker's;
the payload and the interview transition are I09's.

**Why not re-implement (B):** Two copies of the schema gate drift, and a drifted gate is a
malformed report reaching a caller — the exact failure §5.5 layer 2 and K15 exist to prevent.
The scope boundary in `PLAN.md` names this as the duplication to avoid.

**Consequences:** The worker treats `runReport` as a black box that either returns (interview
now `completed`, or `failed` on a handled schema-invalid payload — no retry) or throws a
transient error (retryable, ADR-R04). The worker never inspects the payload for validity; it
only reads the persisted `reports.payload` to render the PDF and denormalise
`report_questions`.

---

## ADR-R03 — 2026-07-30 — `pdfkit` renders the report PDF over headless-Chromium HTML→PDF

**Context:** K15 renders `reports.payload` to a PDF server-side in `worker`. Options:
(A) `pdfkit` — a pure-JavaScript document builder, programmatic layout, no browser; (B)
Puppeteer / `playwright` rendering an HTML template through headless Chromium; (C)
`@react-pdf/renderer` — a React reconciler that emits PDF.

**Decision:** `pdfkit`. It has no native toolchain and no bundled browser, so it does not
fight the Alpine worker image — the same constraint that chose `unpdf` (K12, "ESM, no native
dependencies, doesn't fight Alpine") and `@node-rs/argon2` (K8). The report layout is a fixed,
boring document (header, overall score, strengths/improvements, per-round, per-question) that a
programmatic builder renders deterministically.

**Why not headless Chromium (B):** It pulls a ~300 MB Chromium binary into the worker image,
needs extra Alpine system libraries, and adds a browser process per job — heavyweight for one
fixed one-page-ish document, and the opposite of the lean-image reasoning above.

**Why not `@react-pdf/renderer` (C):** It adds a second React renderer dependency to a service
that has no other React surface, for one document `pdfkit` renders directly. Boring over clever
(YAGNI).

**Consequences:** The PDF layout is code, not an HTML/CSS template — richer visual design is
harder, which is acceptable because PDF export is a §12 bonus (K15) and the mandatory report is
the JSON `payload`. `render-pdf.ts` takes a validated `ReportPayload` and returns a `Buffer`; it
holds no I/O and is unit-testable without Redis or the store.

---

## ADR-R04 — 2026-07-30 — Retry three times with backoff, then dead-letter `→ failed`; never retry a schema-gate failure

**Context:** K10 mandates "three retries, then dead-letter → `failed` state, visible in admin".
The report job can fail two distinct ways: a **transient** fault (provider chain exhausted →
`AI_PROVIDER_UNAVAILABLE`, a DB blip, the store unreachable) that a retry might clear, and a
**permanent** one (I09's `ReportPayload` schema gate rejects the model output) that a retry
cannot clear because the model is deterministic-enough that the same prompt reproduces the same
bad shape. The fork: (A) treat every failure the same — retry all three times; (B) retry only
transient faults, and let a schema-gate failure end the interview `failed` immediately.

**Decision:** (B). I09's `runReport` handles the schema-invalid case internally — it transitions
`evaluating → failed`, stores no payload, logs `AI_OUTPUT_SCHEMA_INVALID`, and **returns without
throwing** — so that job completes on its first attempt and is never retried. Only a **thrown**
error from `runReport` (transient) is retried: BullMQ attempts 3 times with exponential backoff
(base 1000 ms). On exhaustion the worker's dead-letter handler calls
`applyTransition(evaluating → failed)` (I07), sets `reports.status = failed`, and logs
`REPORT_JOB_FAILED` + `REPORT_DEAD_LETTERED`. Every retry is idempotent because `runReport`
re-runs from `evaluating` and `applyTransition` is the sole, guarded state writer.

**Why not retry everything (A):** Retrying a deterministic schema failure burns three LLM calls
(and three `llm_calls` cost rows) to reproduce the same rejected output, then fails anyway —
cost with no chance of success.

**Consequences:** The two failure branches converge on the same terminal state (`failed`) but by
different paths: schema-invalid is immediate and cost-bounded (one report call), transient is
retried and dead-lettered. Admin reads `reports.status = failed` for both; the dead-letter cause
(the last thrown error) is logged for the transient path, and `AI_OUTPUT_SCHEMA_INVALID` for the
schema path. The worker imports `applyTransition` from `backend` so the dead-letter transition
goes through the one guarded writer — the worker never writes `interviews.state` directly.
