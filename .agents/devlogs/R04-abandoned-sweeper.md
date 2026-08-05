---
task: R04
author: Ahmet
sessions: [2026-08-05, 2026-08-05]
model: gpt-5.3-codex
model_recommended: claude-opus-4.8
iterations: 2
tools: [EXECUTE.md protocol, TDD]
---

## Session 1 — 2026-08-05

### What changed
- Added `profiling|hr_round|paused -> abandoned` edges in `backend/modules/interview/machine.ts`.
- Extended `backend/modules/interview/machine.test.ts` with positive and negative abandoned-edge assertions.
- Added `worker/src/jobs/abandon-sweep.ts`:
  - scan only `deleted_at: null` + states `profiling|hr_round|paused`
  - derive `lastActivity = max(chat_messages.created_at, started_at, created_at)`
  - stale if `now - lastActivity > 24h`
  - transition with `applyTransition(..., 'abandoned', { endedReason: 'abandoned' })`
  - `INVALID_STATE_TRANSITION` => skip (`INTERVIEW_ABANDON_SKIP`)
  - unexpected row error => log (`INTERVIEW_ABANDON_FAILED`) and continue batch
- Registered repeatable sweep in `worker/src/index.ts`:
  - queue: `interview.abandon-sweep`
  - repeat job id: `interview-abandon-sweep-v1`
  - cadence: every 15 minutes
  - worker + queue both closed in `shutdown()`

### TDD trace
- Red 1: `machine.test.ts` new abandoned assertions failed (`canTransition(..., 'abandoned') === false`).
- Red 2: new worker test failed on missing module `./abandon-sweep`.
- Green: implemented edges + sweeper file + registration.
- Adjusted stale fixtures once: tests initially used `started_at=now` and were correctly non-stale.

### Verification
Ran task command exactly:
- `docker compose up -d db cache`
- `npm run -w worker test`

Result:
- 6/6 test files passed
- 33/33 tests passed

### Notes for next session
- Report ledger tasks R01-R04 all done.
- `INTERVIEW_STATE_CHANGED` emission for abandoned transitions is already covered by `applyTransition`; sweeper tests assert sweeper-local events.
- Repeat scheduler uses a fixed `jobSchedulerId` to avoid duplicate registrations on restart.

## Session 2 — 2026-08-05 (review fixes)

### What changed
- **Blocker: the sweeper never repeated and `worker` did not build.** Registration used
  `queue.add(name, {}, { jobId, repeat: { every } })`, but bullmq 6 removed `repeat` from
  `JobsOptions` (`tsc`: `TS2353: 'repeat' does not exist in type 'JobsOptions'`) — a plain
  `add` enqueues one job and never schedules another. Replaced with
  `queue.upsertJobScheduler(ABANDON_SWEEP_JOB_ID, { every, immediately: true }, { name, opts })`;
  the `jobSchedulerId` is the fixed identity, so a restart upserts rather than stacks.
  `npm run -w worker test` passed with this bug present: the suite mocks bullmq and
  `index.ts` has no test, so nothing exercised the registration.
- `INTERVIEW_ABANDONED` logged `from: 'abandoned'` — `applyTransition` writes `state` back onto
  the object it is given, and the log read `candidate.state` after the call. `from` is now
  captured before the transition and asserted per row in the test.
- `findMany` is bounded (`take: 500`, `orderBy: created_at asc`) — the staleness predicate cannot
  be pushed into SQL, so every candidate row is loaded; a swept row leaves the state set, so the
  next tick continues. The batch summary carries `truncated`.
- Dropped the redundant in-loop `SWEEP_STATES.includes` re-check (the WHERE clause is the single
  source of truth) and reworked the not-swept test, which had been feeding it out-of-scope rows
  the query would never return: exclusion of `created`/`tech_round`/`evaluating`/terminal/
  soft-deleted rows is now asserted on the query shape, freshness on realistic rows.
- Replaced `applyTransition(candidate as never, ...)` with a `SweepCandidate` =
  `Pick<Interview, …>` type and a single `as Interview` cast; `ended_reason` joined the select
  since `applyTransition` writes it back.

### Verification
- `npm run -w worker build` — clean (was failing).
- `npm run -w worker test` — 6/6 files, 35/35 tests.
- `npm run typecheck` — only the pre-existing `recharts` error in
  `frontend/src/components/admin/stats-panel.tsx` (w11, untouched here).
- `eslint worker/src backend/modules/interview` — clean.

### Trap for next session
`npm run -w worker test` does **not** cover `worker/src/index.ts`. Run `npm run -w worker build`
before calling any queue-wiring task done — the whole R04 registration bug was invisible to the
test suite and visible to `tsc` immediately.
