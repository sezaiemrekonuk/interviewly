# N02 — Admin stats aggregation: `GET /admin/stats` (K11 metrics)
REPO: (this repo) · Depends: N01 · Status: todo
Read first: STATE.md, REFERENCE.md, then this.
**Model: claude-sonnet-4.6** — plain relational read/aggregation over F02 tables to K11's fixed definitions. No new trust boundary lands here: the `requireAdmin` gate this endpoint sits behind was authored and hardened on opus in N01. If a grouping edge case (empty `perOccupation`, no completed interviews for `averageDurationMs`) bites, code-review the diff with `claude-opus-4.8`.

## Goal
Owner's ask:

> "`GET /admin/stats` returning the K11 aggregate metrics — `averageDurationMs` from completed
> interviews only, `completed`/`unfinished` counts, `totalTokens` with deleted interviews
> included, `perOccupation` grouped by cluster, and `weakestQuestions` from the lowest-scoring
> report questions. Behind the admin role gate. Scenario AC-18 in `admin_cost.feature` must be
> green."
> — admin ledger task decomposition (backend spec *Admin stats*, K11 fixed definitions, db AC-12)

This task adds one handler, `GET /admin/stats`, mounted on the admin router N01 built (behind
the same `requireAuth` → `requireAdmin` gate). It computes the aggregate metrics to K11's fixed
definitions — cited, not re-decided. It does **not** touch the audit list, the delete route, or
the role gate (N01 owns those); it reuses them. The @AC-18 scenario also asserts the role gate
(non-admin → `403`) and the deleted-inclusive list from N01 — those pass because N01 is green.

## Non-negotiables
- **`GET /admin/stats` is mounted behind `requireAuth` → `requireAdmin`** (the N01 router's
  `router.use(requireAuth, requireAdmin)` covers it). A non-admin gets `403 FORBIDDEN`. Do not
  add a second gate or a per-handler role check.
- **Numbers are computed to K11's fixed definitions** (backend spec *Admin stats*) — cited, not
  invented:
  - `averageDurationMs` = mean of `ended_at − started_at` over `state = 'completed'` **only**
    (an interview without both timestamps is excluded; if none qualify, return `0` or `null`
    consistently and document which).
  - `completed` = count of `state = 'completed'` (`cut_short` counts as completed and is broken
    out as `cutShort`); `unfinished` = count of `abandoned` + `failed`.
  - `totalTokens` = Σ `input_tokens + output_tokens` over `llm_calls`, **deleted interviews
    included** (bypass the soft-delete helper, ADR-N02).
  - `perOccupation[]` = grouped by `occupation_cluster`, labelled by the most frequent
    `occupation` in that cluster.
  - `weakestQuestions[]` = lowest-scoring `question_id`s from `report_questions` — a plain
    relational query, **no jsonb traversal** (db AC-12).
- **No display strings, no per-user cost/token breakdown in logs.** Return numbers and keys;
  the frontend renders labels. Log `ADMIN_STATS_READ` ({ traceId }).

## Context (anchors)
- `backend/modules/admin/stats.ts` — **create.** `GET /admin/stats` handler computing the six
  metrics above; return the [admin stats shape](../REFERENCE.md#admin-stats-shape). `totalTokens`
  aggregates `llm_calls` across ALL interviews incl. deleted (the `ADMIN AUDIT` bypass comment,
  ADR-N02). `weakestQuestions` is `prisma.reportQuestion.findMany({ orderBy: { score: 'asc' },
  take: N })` — no jsonb.
- `backend/modules/admin/router.ts` (:N01) — mount `router.get('/stats', stats)` at the marked
  `// N02 mounts GET /stats below this line` slot. The router already applies `requireAuth` +
  `requireAdmin`.
- `backend/modules/admin/middleware.ts` (:N01) — `requireAdmin` (reused, not re-created).
- `backend/src/lib/db.ts` (:F02) — `prisma`. Admin aggregation uses `prisma.interview`,
  `prisma.llmCall`, `prisma.reportQuestion`, `prisma.occupationCluster` directly (the sanctioned
  admin bypass); never `userInterviews` (it would drop deleted interviews from `totalTokens`).
- `backend/src/lib/error-codes.ts` (:F01) — `FORBIDDEN`, `UNAUTHENTICATED` (present; no new codes).

  **The trap:** `totalTokens` must include deleted interviews (K11), but `averageDurationMs`
  and the `completed`/`unfinished` counts are over interview *state*, independent of
  `deleted_at` — a deleted-but-completed interview still counts as completed. Do not filter the
  stats query by `deleted_at` at all; the deleted flag is irrelevant to every stat except that
  `totalTokens` must not exclude them. `weakestQuestions` reads `report_questions`, which the
  report pipeline (report ledger) writes in production and the acceptance ring seeds via fixture.

## Steps
- [ ] **1. Confirm N01 artefacts exist** — `modules/admin/router.ts` with the `/stats` mount
  slot and `router.use(requireAuth, requireAdmin)`; `modules/admin/middleware.ts` exporting
  `requireAdmin`. If missing, set this task to `blocked` and stop.
- [ ] **2. Create `modules/admin/stats.ts`** — compute the six metrics to the K11 definitions.
  Aggregate `totalTokens` over all `llm_calls` (ADMIN AUDIT comment). Group `perOccupation` by
  `occupation_cluster`, label by modal `occupation`. `weakestQuestions` via `report_questions`
  ordered by score ascending, no jsonb. Log `ADMIN_STATS_READ`.
- [ ] **3. Mount `GET /stats`** on the N01 admin router at the marked slot.
- [ ] **4. Tests — negative and positive cases.** Wire the Cucumber step definitions for
  `admin_cost.feature` @AC-18: a non-admin fetching `/admin/interviews` → `403 FORBIDDEN`
  (negative); an admin fetching `/admin/interviews` → `200` with deleted interviews included
  (reuses N01); an admin fetching `/admin/stats` → `200` with `averageDurationMs` computed from
  completed interviews and `completed`, `unfinished`, `totalTokens`, `perOccupation`,
  `weakestQuestions` all present. The step fixtures seed a mix of completed/abandoned/deleted
  interviews with `llm_calls` and `report_questions` rows. Extend `tests/step-definitions/admin.ts`
  (created in N01).
- [ ] **5. Run the Verification command and confirm @AC-18 green.**
- [ ] **6. Re-run @AC-17 to confirm N01 is not regressed by the new route.**
  ```bash
  npm run test:acceptance -- --tags "@admin-cost and @AC-17"
  ```

## Definition of done
- `GET /admin/stats` requires an admin session; a non-admin gets `403 FORBIDDEN`.
- The response carries `averageDurationMs` (completed interviews only), `completed`, `cutShort`,
  `unfinished`, `totalTokens` (deleted included), `perOccupation[]` (grouped by cluster, labelled
  by modal occupation), and `weakestQuestions[]` (lowest-scoring `report_questions`, no jsonb).
- `totalTokens` includes deleted interviews; `averageDurationMs` and the state counts are
  independent of `deleted_at`.
- The stats query never calls `userInterviews`; every direct aggregation carries the `ADMIN
  AUDIT` comment (ADR-N02).
- `npm run test:acceptance -- --tags "@admin-cost and @AC-18"` exits 0, and
  `@admin-cost and @AC-17` still exits 0 (no regression).

## Verification
```bash
npm run test:acceptance -- --tags "@admin-cost and @AC-18"
```

Expected output: one scenario passes, zero failures, zero pending.

Regression check (run immediately after):
```bash
npm run test:acceptance -- --tags "@admin-cost and @AC-17"
```

Both commands must exit 0. A final whole-feature run may confirm the file:
```bash
npm run test:acceptance -- --tags "@admin-cost"
```

## Notes

- `totalTokens`: `prisma.llmCall.aggregate({ _sum })` — single aggregate over all llm_calls, no interview filter. Includes deleted.
- `perOccupation`: `prisma.interview.findMany` with `select: { occupation: true, occupation_cluster: { select: { key: true } } }`, then in-memory Map groupBy. Chosen over `groupBy` because groupBy can't pull the cluster key in one query without a join Prisma doesn't support there.
- `averageDurationMs`: returns `0` when no completed interviews have both timestamps (documented in handler comment via `0` literal).
- `weakestQuestions`: NOT seeded — creating `ReportQuestion` requires Question → InterviewRound chain. Step asserts `Array.isArray(body.weakestQuestions)` (empty array is valid).
- `@unwired` tag removed from `admin_cost.feature` before running red (undefined steps); then green after implementation.
- Verification: `2 scenarios (2 passed) / 24 steps (24 passed)` — full `@admin-cost` feature.
- Lint + typecheck: clean.
- For V01+: nothing. This ledger is now fully green.
