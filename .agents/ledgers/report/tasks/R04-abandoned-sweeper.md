# R04 — 24 h `abandoned` sweeper: a BullMQ repeatable job that ends interviews stale past 24 h
REPO: (this repo) · Depends: R01 · Status: done
Read first: STATE.md, REFERENCE.md, then this.
**Model: claude-opus-4.8** — this job writes the interview state machine on a schedule with no user
in the loop. It must add the missing `→ abandoned` edges to the sole guarded writer, derive
staleness from a column that does not exist yet (`interviews` has no `updated_at`), and be idempotent
across replicas and repeats — the same idempotency/state-correctness class as R03, which the ledger
already runs at the expensive tier. A cheaper model writes `interviews.state` directly or double-ends
a racing interview.

## Goal
Owner's ask (promoted from this ledger's backlog, per PLAN_FRONTEND_LEDGER.md §6.2):

> "A BullMQ repeatable job in the existing `worker/src/index.ts` that moves interviews stale in
> `paused`/`hr_round`/`profiling` past 24 h to `abandoned` with `ended_reason = 'abandoned'`,
> idempotent, no AI call. Depends on R01 (it lands with the worker's queue wiring). The sweeper
> lives in `report`, not a new `worker` ledger."
> — PLAN_FRONTEND_LEDGER.md §6.2; K10; report STATE backlog "24 h `abandoned` sweeper"

`EndedReason.abandoned` (schema line 59) and the `abandoned` state (line 50) already exist, and
admin's N02 stats count `unfinished`/`abandoned`, but **nothing writes them** — no request path and,
until this task, no job. This closes that: a repeatable sweeper that ends long-stale interviews.

## Security boundaries
- **The sweeper is the only actor with no user in the loop** — it must therefore respect every
  invariant a request path does. It writes `interviews.state` **only** through `applyTransition`
  (I07's sole guarded writer), never a raw `prisma.interview.update`, so the WHERE-clause state guard
  and the `INTERVIEW_STATE_CHANGED` log hold exactly as for a user-driven transition.
- **No AI call, no cost row.** Abandonment is a state fact, not an evaluation; the job touches no
  provider and writes no `llm_calls`. It never enqueues a report.
- **Soft-deleted interviews are out of scope** — the query excludes `deleted_at IS NOT NULL` (K13);
  a deleted interview is already gone from the user's view and must not be resurrected as `abandoned`.

## Non-negotiables
- **Add the `→ abandoned` edges to `machine.ts` — they do not exist yet.** `TRANSITIONS`
  (`backend/modules/interview/machine.ts:16`) currently has **no** edge to `abandoned` from any
  state: `profiling: ['hr_round']`, `hr_round: ['tech_round','evaluating','paused']`,
  `paused: ['hr_round']`. This task adds `abandoned` as a permitted target from exactly the three
  stale-able states — `profiling`, `hr_round`, `paused` — and nothing else. (`created` is pre-start
  and `tech_round`/`evaluating`/terminal states are excluded by the owner's list.) Without this edge
  `applyTransition` throws `INVALID_STATE_TRANSITION` and the sweeper cannot do its job through the
  guarded writer — adding the edge is the point, not a workaround.
- **Staleness is derived, because `interviews` has no `updated_at`.** The model
  (`schema.prisma:239`) has `created_at`, `started_at`, `ended_at` — no last-activity column. Define
  "stale" as **`now() - lastActivity > 24 h`** where `lastActivity` is the most recent of
  `MAX(chat_messages.created_at)` for the interview (the last answered turn) and `started_at`, falling
  back to `created_at` when the interview has no messages and never started. Pin this definition in
  code; do not invent an `updated_at` column (a migration to add one is a heavier, separate change —
  note it, don't do it here).
- **Only `profiling`, `hr_round`, `paused` are swept.** A `created` interview (never started),
  `tech_round`, `evaluating`, and every terminal state (`completed`/`failed`/`abandoned`) are left
  alone — matching both the owner's list and the edges added above.
- **`ended_reason = 'abandoned'`** is written **with** the state, via `applyTransition(interview,
  'abandoned', { traceId, endedReason: 'abandoned' })` — the writer sets both in one `updateMany` so
  they cannot disagree (the machine's existing contract).
- **Idempotent and race-safe.** A second sweep, or two worker replicas running the repeatable at
  once, must not double-end an interview: `applyTransition`'s WHERE re-checks `state = from` at write
  time, so the loser's `updateMany` matches zero rows and throws `INVALID_STATE_TRANSITION` — the
  sweeper treats that as a **no-op skip**, not a job failure. A racing user transition (e.g. a resume
  moving `paused → hr_round`) likewise makes the sweep a no-op for that row.
- **Repeatable, not a per-interview enqueue.** One BullMQ repeatable job (cron/every, e.g. every
  15 min) that scans for stale interviews and transitions each — not one queued job per interview.
  Use a fixed `jobId` for the repeatable so re-registering on worker restart does not stack duplicate
  schedulers.
- **A per-row failure does not abort the sweep.** One interview's transition throwing (an unexpected
  error, not the benign `INVALID_STATE_TRANSITION` skip) is logged and the loop continues to the next
  row; the job does not dead-letter the whole batch for one bad row.

## Context (anchors)
- `backend/modules/interview/machine.ts` (:I07) — **modify.** Add `abandoned` to the `TRANSITIONS`
  targets for `profiling`, `hr_round`, and `paused` (three edges). Do not touch the other edges, the
  TOCTOU WHERE guard, or the `endedReason` write. This is the only backend-module change.
- `worker/src/jobs/abandon-sweep.ts` — **create.** `sweepAbandoned(ctx)`: query the stale set
  (the derived-staleness query above, excluding `deleted_at`), loop, call `applyTransition(interview,
  'abandoned', { traceId, endedReason: 'abandoned' })` per row, catch `INVALID_STATE_TRANSITION` as a
  skip, log `INTERVIEW_ABANDONED` per swept row and a batch summary. No AI, no report enqueue.
- `worker/src/index.ts` (:R01) — **modify.** Register a BullMQ repeatable job (a `Queue` +
  `Worker`, or a `repeat` on an existing queue) named e.g. `interview.abandon-sweep`, fixed `jobId`,
  a cron/every schedule, whose processor calls `sweepAbandoned`. Sits alongside the existing
  `email.send` worker and R01's report worker; add a `.close()` to the existing `shutdown()`.
- `backend/prisma/schema.prisma` — **read only.** `Interview` (line 239): `state`, `ended_reason`,
  `started_at`, `created_at`, `deleted_at`; `InterviewState`/`EndedReason` enums (the `abandoned`
  members already exist). `ChatMessage` (line 389): `created_at` is the last-activity signal.
- `backend/src/lib/db.ts` (:F02) — `prisma`. `backend/src/lib/logger.ts` (:F03) — `logger`.
- `worker/src/lib/`, `worker/src/jobs/email-send.ts` (:A04) — the existing worker job pattern to
  match (a `jobs/` module + a `Worker` in `index.ts`).

  **The trap:** two. (1) The `→ abandoned` edge does not exist in `machine.ts` — if you skip adding it
  and route around `applyTransition` with a raw update you break the "one guarded writer" invariant
  the whole state machine rests on; add the three edges and go through the writer. (2) There is no
  `updated_at` column — a naive `WHERE updated_at < now() - 24h` will not compile; staleness must be
  derived from `chat_messages`/`started_at`/`created_at` as pinned above.

## Steps
- [x] **1. Add the three `→ abandoned` edges** to `machine.ts` `TRANSITIONS` (`profiling`,
  `hr_round`, `paused` → `abandoned`); leave every other edge byte-identical.
- [x] **2. Write `worker/src/jobs/abandon-sweep.ts`** — the derived-staleness query (excluding
  `deleted_at`), the per-row `applyTransition(→ abandoned, endedReason: 'abandoned')` loop, the
  `INVALID_STATE_TRANSITION`-as-skip catch, per-row + batch logging. No AI, no report enqueue.
- [x] **3. Register the repeatable** in `worker/src/index.ts` — fixed `jobId`, a cron/every schedule,
  processor calls `sweepAbandoned`; add its `.close()` to `shutdown()`.
- [x] **4. Wire the worker tests** — three cases:
  - **Swept:** a `paused`/`hr_round`/`profiling` interview whose last activity is > 24 h old →
    ends `abandoned` with `ended_reason = 'abandoned'`, exactly one `INTERVIEW_STATE_CHANGED`
    (`→ abandoned`) and one `INTERVIEW_ABANDONED` log.
  - **Not swept:** a fresh (< 24 h) interview, a `created` interview, a `tech_round`/`evaluating`
    interview, a `completed`/`abandoned` terminal interview, and a soft-deleted one → all untouched.
  - **Idempotent / race-safe:** running the sweep twice ends the interview exactly once (the second
    run's `applyTransition` is a no-op skip, not a failure); a row that a concurrent resume moved out
    of the stale state is skipped.
- [x] **5. Run the `## Verification` command.**

## Definition of done
- `machine.ts` permits `profiling|hr_round|paused → abandoned` and nothing else new; every other edge
  is unchanged.
- The repeatable sweeper ends interviews whose derived last-activity is > 24 h old and are in
  `profiling`/`hr_round`/`paused`, setting `state = abandoned` + `ended_reason = 'abandoned'` through
  `applyTransition` — no raw state write, no AI call, no report enqueued, soft-deleted rows excluded.
- Running the sweep twice (or with a racing user transition) ends each interview exactly once; a
  benign `INVALID_STATE_TRANSITION` is a skip, not a job failure; an unexpected per-row error is
  logged and the batch continues.

## Verification
```bash
docker compose up -d db cache
npm run -w worker test
```

Expected: the sweeper suite passes — stale `profiling`/`hr_round`/`paused` interviews end
`abandoned` with `ended_reason = 'abandoned'`; fresh/`created`/`tech_round`/`evaluating`/terminal/
soft-deleted interviews are untouched; and a double run (or a racing resume) ends each interview
exactly once.

## Notes

Added `profiling|hr_round|paused -> abandoned` edges in `backend/modules/interview/machine.ts`
and pinned them with new assertions in `machine.test.ts`.

New `worker/src/jobs/abandon-sweep.ts`: scans only non-deleted interviews in
`profiling|hr_round|paused` (bounded, `take: 500` + `orderBy created_at asc` — the derived
staleness predicate cannot be pushed into SQL, so candidate rows are loaded before being judged;
a swept row leaves the state set, so the next tick continues, and a full batch is reported as
`truncated`), derives `lastActivity = max(chat_messages.created_at, started_at, created_at)`,
marks stale rows (`>24h`) as `abandoned` through `applyTransition(..., { endedReason:
'abandoned' })`. `from` is captured **before** the call — `applyTransition` writes `state` back
onto the object it is given, so reading `candidate.state` afterwards logs `abandoned`.

Race/idempotency branch implemented by handling `INVALID_STATE_TRANSITION` as
`INTERVIEW_ABANDON_SKIP`; unexpected row error logs `INTERVIEW_ABANDON_FAILED` and loop continues.

`worker/src/index.ts` registers one repeatable queue/worker pair, `interview.abandon-sweep`,
closed in shutdown alongside the other workers. **bullmq 6 removed `repeat` from `JobsOptions`**
— `queue.add(name, data, { jobId, repeat: { every } })` does not compile (`TS2353`) and, without
the type error, would enqueue a single job that never repeats. Scheduling goes through
`queue.upsertJobScheduler('interview-abandon-sweep-v1', { every: 15 min, immediately: true },
{ name, opts })`; the `jobSchedulerId` is the fixed identity the task asks for, so a worker
restart upserts the one scheduler instead of stacking a second.

New worker unit file `worker/src/jobs/abandon-sweep.test.ts` covers swept (asserting the `from`
state per row), not-swept (query shape for the excluded states + soft-deleted, freshness for
in-scope rows), idempotent/race-safe, continue-on-row-failure, and batch truncation.

Verification: `docker compose up -d db cache && npm run -w worker test` — 6/6 files, 35/35 tests.
Plus `npm run -w worker build` (the task command alone does not cover `index.ts`: the suite mocks
bullmq, so the registration bug above passed the tests and failed `tsc`).
