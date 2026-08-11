---
task: N05
author: Fatih
sessions: [2026-08-11]
model: claude-sonnet-4.6
model_recommended: claude-sonnet-4.6
iterations: 1
tools: []
---

## Session 1 — 2026-08-11

### What I asked for / what came back
- Five read endpoints and two additive `/admin/stats` fields. Every table involved was already
  being written and read by nothing — `llm_calls` since I02, `audit_logs` since issue 86.
- No write path. `POST /admin/interviews/:id/report/requeue` stays the only route on this
  router that changes anything.

### Methodology trace
Console sections with no endpoint behind them → five handlers on the existing gate →
`filters.test.ts` red on 6 parser cases → green → `perModel` added to `/stats` →
`backend/modules/admin` `5 files / 27 tests`, typecheck clean.

### Friction
- **`getJobCounts('paused')` is not a valid BullMQ `JobType`.** The union is
  `JobState | 'repeat' | 'wait'`, and a paused *queue* is a queue-level flag, not a job state.
  Dropped rather than faked; the five counts that exist are the five reported.
- **next-intl cannot address a message key containing a dot** — it reads `a.b` as a path. The
  audit actions are dotted by design (`interview.soft_deleted`), so the console's labels are
  stored underscored and the table does `action.replaceAll('.', '_')` at lookup. Worth knowing
  before adding a new `AuditAction`: the key here and the key in `messages/*.json` differ by
  exactly that substitution.
- **One queue is the honest answer to "queue observability".** Generation and scoring run
  inline on the request, and the mail producer sits behind an interface the acceptance ring
  swaps out, so there is no BullMQ handle to count. Two rows where one is always zero would
  have looked more complete and told an operator less.
- `audit_logs` growing a row for every look at `audit_logs` is a real cost and the right way
  round. A reader sees their own last visit at the top; an audit surface readable without a
  trace is the one an attacker uses to find out what was noticed.

### What I rejected and rewrote by hand
- **An `errorRate` on `/admin/llm-calls`.** `llm_calls` has no success/failure column, so the
  only way to produce the number was to treat a non-null `fell_back_from` as a failure — which
  counts a *successful* fallback as one. Cut, and the module header says why so it does not
  get re-added.
- **A hardcoded action list for the audit filter**, copied from the `AuditAction` union. It
  drifts the first time an action is added (which this very task did, five times). Counted
  from the data with a `groupBy` instead.
- **`totalCostUsd` summed from `interviews.spent_usd`.** Rewrote to sum `llm_calls`, so the
  total and the `perModel` breakdown come from the same rows and cannot disagree — a cost panel
  whose total does not match its own table is worse than one with no total.
- **Ordered every list by `created_at desc` alone.** Calls inside one turn share a millisecond
  often enough that this is not a total order, and a cursor over a non-total order repeats or
  skips rows between pages. `id desc` as the tie-break on all four.
- **Sorted `perModel` in Node after a `findMany`.** Replaced with `groupBy` + `orderBy: {
  _sum: { cost_usd: 'desc' } }` — the result set is providers × models, a handful of rows,
  which is why this one can afford to be unbounded where the two scans issue 85 removed could not.
- **`sessionFilters(query)` reading `clock.now()` itself.** Passed `now` in instead, which is
  the only reason the active-session case is testable without freezing the clock.
