# Report — Recommended Model Per Task

The report ledger sits on the queue boundary. The task that must not run twice, must not
double-transition, and must tell a transient fault apart from a permanent one runs at the
expensive tier. The worker wiring and the PDF template are mechanical and run at the moderate
tier.

| ID | Title | Model | Why |
|----|-------|-------|-----|
| R01 | Worker service + BullMQ report consumer: real producer into I07's hook, dequeue → `runReport`, `reports.status` lifecycle | `claude-sonnet-4.6` | Mechanical worker + BullMQ wiring over an existing `runReport`; `jobId = interviewId` idempotency is a one-line BullMQ option, not bespoke logic |
| R02 | Render `ReportPayload` to PDF, write `reports.pdf_key` via I12 storage, denormalise `report_questions` | `claude-sonnet-4.6` | PDF template + a mechanical payload→rows denormalisation over a validated payload; no trust boundary, no state machine |
| R03 | Retry, backoff, dead-letter `→ failed`; idempotent; transient vs schema-gate branch | `claude-opus-4.8` | Retry-correctness on the queue boundary: distinguishing a retryable transient throw from a permanent schema-gate `failed`, and an idempotent dead-letter transition, is the K10 invariant a cheaper model gets subtly wrong |
| R04 | 24 h `abandoned` sweeper: repeatable job ends interviews stale in `profiling`/`hr_round`/`paused` past 24 h → `abandoned`, idempotent, no AI | `claude-opus-4.8` | Writes the state machine on a schedule with no user in the loop: adds the missing `→ abandoned` edges to the sole guarded writer, derives staleness without an `updated_at` column, and must be idempotent across replicas/repeats — the same state-correctness class as R03 |

## Summary

- **`claude-opus-4.8` (2 tasks):** R03, R04
- **`claude-sonnet-4.6` (2 tasks):** R01, R02

Rule of thumb: **retry / dead-letter / idempotency correctness = expensive tier; worker wiring
and the PDF template = moderate tier.** When unsure on R01 or R02 — e.g. the idempotency of R01's
consumer under a retry turns out to be subtler than a `jobId` — run the task with sonnet and
code-review the diff with `claude-opus-4.8`, cheaper than running the whole task expensive.
Never use haiku, mini, or flash for R03: a mis-branched retry either loops a bad report three
times (cost) or retries a transient fault zero times (loses a recoverable report).
