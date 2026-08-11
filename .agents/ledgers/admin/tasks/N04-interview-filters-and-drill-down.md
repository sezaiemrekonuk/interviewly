# N04 — Interview list facets and the per-interview drill-down
REPO: (this repo) · Depends: N01, N03 · Status: done
Read first: STATE.md, REFERENCE.md, then this.
**Model: claude-sonnet-4.6** — relational reads behind a gate N01 already authored and hardened on opus. No new trust boundary lands here: the facets narrow an already-audited query and the drill-down is a `findUnique` plus two `findMany`s. If the K11 bypass interaction (a facet accidentally restoring `deleted_at`) worries you, code-review the diff with `claude-opus-4.8` — cheaper than running the whole task expensive.

## Goal
Owner's ask:

> "The interview list needs the filters the spec has always listed — cluster, state, user —
> and clicking a row has to open the interview: every provider call it paid for, and every
> event the system recorded against it."
> — admin ledger backlog promotion (backend spec `.agents/specs/2026-07-29-backend.md:151-152`,
> US-26, US-28, US-29)

Two things, one surface. `interviewFilters` closes the spec row that had only `cursor`/`limit`
implemented, and `GET /admin/interviews/:id` is the drill-down the STATE backlog held open
"until the admin drill-down UI (US-29) or a scenario is specced". The `events` array has no
data source without N03 — that is the whole reason this depends on it. It does **not** touch
the role gate, the delete route, `/admin/stats`, or the schema.

## Non-negotiables
- **Facets narrow and can never widen.** The K11 soft-delete bypass must survive every
  combination of `?occupationCluster&state&userId` — a filtered page still shows deleted rows.
  No facet may introduce a `deleted_at` clause.
- **An unknown facet value is dropped, not `422`'d.** The same rule `pageLimit` already
  follows for a nonsense `?limit=`. A console typo is not an error condition.
- **Nothing here may throw on a hostile query string.** Express turns `?userId=a&userId=b`
  into an array and `?q[x]=y` into an object; a `where` built from either is a 500 on a URL
  anyone can type. Drop both.
- **`occupationCluster` matches the cluster KEY**, which is what the list projects. The
  cluster id never leaves the server.
- **The drill-down does not filter `deleted_at`.** A deleted interview is exactly the one an
  admin opens this page for (K11). Absent → `INTERVIEW_NOT_FOUND`.
- **Money is a six-decimal string throughout.** `Decimal(12,6)` through a JS number stops
  being the figure the ledger holds. `totalTokens` stays a number with nulls coalesced to 0
  (N01's contract).
- **A truncated call list says so.** A silently short list reads as a complete one.
- **The read is audited**, like every other read on this router.

## Context (anchors)
- `backend/modules/admin/interviews.ts` (:N01) — add an exported `interviewFilters(query)`
  returning a `Prisma.InterviewWhereInput`, and apply it as the `where` of the existing
  `findMany`. The nine `InterviewState` values are listed as a runtime `Set`: Prisma exports
  the enum as a *type*, and a membership test needs values. The row projection gains
  `userEmail` (joined from `users.email_lower`), `budgetUsd`, `startedAt`, `createdAt`; the
  `admin.interviews_read` audit row's `metadata` gains the applied filters.
- `backend/modules/admin/interview-detail.ts` — **create.** `GET /admin/interviews/:id` →
  `{ interview, calls, callsTruncated, events }`. Three reads, not one nested include:
  `llm_calls` and `audit_logs` are unrelated and a join would multiply one by the other.
  Calls ascending, `MAX_CALLS = 500`; events newest-first, `MAX_EVENTS = 200`. Split the wire
  mapping into a pure `shapeInterviewDetail(interview, calls, events, callsTruncated)`.
- `backend/modules/admin/router.ts` (:N01) — `router.get('/interviews/:id', getAdminInterview)`.
  The gate is inherited from `router.use` (ADR-N01); do not restate it.
- `backend/src/lib/audit.ts` — add `admin.interview_read`.
- `backend/src/lib/api-error.ts` (:F01) — `INTERVIEW_NOT_FOUND` (present; no new codes).

  **The trap:** the drill-down's `events` query keys on `subject_type = 'interview'` +
  `subject_id = :id`, and the admin *list* read writes `subject_type = 'interview_list'` with
  a null `subject_id` (N01). Key on `action` instead and the timeline fills with "an admin
  looked at the list", crowding out the injection and exhaustion rows the page exists to
  show. The second trap is `interviewFilters`: it is applied to a `findMany` that has **no**
  `deleted_at` filter, so spreading in anything conditional there is the one way to
  reintroduce the K11 leak from the other direction.

## Steps
- [x] **1. Write `interviewFilters(query)`** in `modules/admin/interviews.ts` — `state`
  (membership-checked against the nine), `userId`, `occupationCluster` (→
  `occupation_cluster: { key }`). Non-string values dropped.
- [x] **2. Apply it** as the list's `where`; add `userEmail`, `budgetUsd`, `startedAt`,
  `createdAt` to the projection and the filters to the audit row's `metadata`.
- [x] **3. Create `modules/admin/interview-detail.ts`** — `findUnique` (no `deleted_at`
  filter), `INTERVIEW_NOT_FOUND` when absent, `llm_calls` asc capped at `MAX_CALLS`,
  `audit_logs` desc capped at `MAX_EVENTS`, `admin.interview_read` audit row, log
  `ADMIN_INTERVIEW_READ`.
- [x] **4. Split the projection** into `shapeInterviewDetail` so the wire mapping is testable
  without a database. `interview.report` carries `{ status, promptUuid, promptVersion }` —
  the US-28 rollback handle. A voice call keeps `unitKind: 'second'` on its own row.
- [x] **5. Mount `GET /interviews/:id`** on the admin router; add `admin.interview_read` to
  `AuditAction`.
- [x] **6. Tests** — `modules/admin/interviews.test.ts` on the filter parser (5 cases,
  including the repeated-param and the never-adds-`deleted_at` case);
  `modules/admin/interview-detail.test.ts` on the projection (7 cases: six-decimal money, the
  full US-26 call row, the per-second voice row, a deleted interview, the US-28 prompt
  lineage, the US-29 event timeline, truncation).
- [x] **7. Run the Verification commands.**

## Definition of done
- `?occupationCluster=…&state=…&userId=…` narrow the admin list; an unknown `state`, an empty
  value, a repeated param and a structured param are all dropped rather than 422'd or thrown on.
- No combination of facets adds a `deleted_at` clause — deleted rows stay in a filtered page.
- The list row carries `userEmail`, `budgetUsd`, `startedAt`, `createdAt` in addition to N01's
  fields, and the read's audit row carries the applied filters.
- `GET /admin/interviews/:id` returns `{ interview, calls, callsTruncated, events }` for a
  deleted interview as readily as a live one; an unknown id is `INTERVIEW_NOT_FOUND`.
- `calls` is capped at 500 with `callsTruncated` set; `events` is capped at 200, newest first,
  and contains the N03 rows rather than the admin's own list reads.
- Every money field is a six-decimal string; a voice call appears as its own `unitKind:
  'second'` row.
- `shapeInterviewDetail` is pure and unit-tested with no database.

## Verification
```bash
npm test -- --run backend/modules/admin
npm run typecheck
```

Expected: all `backend/modules/admin` test files pass (12 of the cases are this task's),
typecheck silent.

Regression check — the two existing scenarios read only fields this task preserved:
```bash
npm run test:acceptance -- --tags "@admin-cost"
```

## Notes

Done 2026-08-11. `npm test -- --run backend/modules/admin` → `5 files / 27 tests` green;
`npm run typecheck` clean. Commits `fcdf2a9` (filters) and `d83fae5` (drill-down).

**What exists now**
- `interviewFilters(query)` exported from `modules/admin/interviews.ts` — the parser, separate
  from the handler, which is what makes it testable at all (`listAllInterviews` needs Prisma).
- `modules/admin/interview-detail.ts` — `getAdminInterview` + the pure `shapeInterviewDetail`.
  `MAX_CALLS = 500`, `MAX_EVENTS = 200`.
- `admin.interview_read` in `AuditAction`.

**Deviations from the plan**
- The `events` cap is 200 and is **not** reported as truncated, unlike `calls`. A capped
  newest-first timeline reads correctly as "the last 200 things"; a capped ascending call list
  does not, because the rows you are missing are the ones you were looking for.
- `MAX_CALLS` carries a `ponytail:` comment naming cursor-paging as the upgrade path if an
  interview ever legitimately exceeds it. An interview asks at most 20 questions, so 500 is a
  runaway-retry ceiling, not a page size.

**How things were queried**
- Three reads, one `findUnique` + a `Promise.all` of two `findMany`s. A nested include would
  have multiplied calls by events.
- `facets` are deliberately absent here (that pattern lands in N05, on the lists where the
  filter vocabulary is unknown); an interview's own calls need no vocabulary.

**Not done, deliberately**
- No `@AC` scenario maps this endpoint — `COVERAGE.md` has none, and inventing one would mean
  inventing an acceptance criterion. The unit tests are the gate.
- **`npm run test:acceptance` was NOT run this session** (it needs the compose stack up). The
  claim that `@AC-17`/`@AC-18` are unaffected is a reading of the feature file, not a run:
  both assert only on fields this task preserved (`deleted`, `costUsd`, `totalTokens`, and the
  K11 stats keys), and the projection only gained fields. Run it before the PR.

**For N05**
`asString` sits in each module rather than in a shared file — a three-line guard next to the
parser it belongs to. Follow that, and keep the same "narrow or drop" rule:
`filters.test.ts` asserts it across all four of N05's parsers at once.
