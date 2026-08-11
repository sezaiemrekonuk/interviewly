---
task: N04
author: Fatih
sessions: [2026-08-11]
model: claude-sonnet-4.6
model_recommended: claude-sonnet-4.6
iterations: 1
tools: []
---

## Session 1 — 2026-08-11

### What I asked for / what came back
- The three spec facets on the interview list, and `GET /admin/interviews/:id`. Two commits
  (`fcdf2a9`, `d83fae5`) because they are two independently reviewable diffs, one task because
  the drill-down is what the facets are for.
- Backend only. The console page that renders this is the frontend ledger's.

### Methodology trace
Spec row `.agents/specs/2026-07-29-backend.md:151` (facets, unimplemented since N01) →
`interviews.test.ts` red on 5 parser cases → green → drill-down → `interview-detail.test.ts`
red on 7 projection cases → green. `5 files / 27 tests` across `backend/modules/admin`.

### Friction
- **The drill-down's `events` array had no data source.** That is why this task depends on N03
  rather than only on N01: before N03 the injection suspicions were pino lines and the
  budget/time trips were an `ended_reason`, so the US-29 half of this endpoint would have
  shipped as a permanently empty array. Sequencing it the other way round would have been a
  section of the console that looks broken.
- **`admin.interviews_read` nearly poisoned the timeline it feeds.** The list read is audited
  (N01), so an `events` query keyed on `action` would have filled the page with "an admin
  looked at the list". It keys on `subject_type`+`subject_id` instead, and the list read
  writes `subject_type = 'interview_list'` with a null `subject_id`, so the two never collide.
- Prisma exports `InterviewState` as a type only. A runtime membership test needs values, so
  the nine are listed with a comment saying why — a `Set` that looks hand-maintained for no
  reason is the kind of thing a later reader deletes.

### What I rejected and rewrote by hand
- **One `findUnique` with a nested `include` of calls and events.** It reads as the tidy
  version and it is a cartesian product: 300 calls × 40 events is 12,000 rows for a page that
  wants 340. Three reads, one `findUnique` plus a `Promise.all`.
- **`?state=nonsense` → `422 VALIDATION_ERROR`.** Rewritten to drop the facet, because
  `pageLimit` already drops a nonsense `?limit=` and two rules for the same class of input is
  how a console ends up showing an error for a typo it could have ignored.
- **Left the projection inline in the handler.** Then split it into `shapeInterviewDetail`
  after realising the six-decimal money, the `unitKind: 'second'` voice row and the US-28
  prompt lineage are the parts most likely to regress and none of them were testable without a
  Postgres. Seven tests, no database.
- **Generated `budgetUsd: Number(row.budget_usd)`.** `Decimal(12,6)` through a JS number stops
  being the ledger figure; `.toFixed(6)`, like N01's `costUsd`.
- **Did not add an `@AC` scenario.** `COVERAGE.md` maps none to this endpoint, and writing one
  would be inventing an acceptance criterion the owner did not state. Said so in the Notes
  instead of quietly leaving a coverage gap.
