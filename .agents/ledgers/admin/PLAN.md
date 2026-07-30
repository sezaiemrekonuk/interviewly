# Admin — PLAN (Architecture)

Written once. Amend only via a new `DECISIONS.md` ADR-N entry referenced here.
Codebase orientation: `REFERENCE.md` (read that before touching any task).

## Goal

When this ships, a `role = 'admin'` account signed in with email + password can read
every interview in the system — including soft-deleted ones — with a `deleted` flag, a
token total and a USD cost per interview, and can read aggregate metrics (average duration,
completed/unfinished counts, total tokens, per-occupation breakdown, weakest questions) at
`GET /admin/stats`. A candidate can soft-delete their own interview, after which it vanishes
from their `GET /me/interviews` list but stays visible and cost-intact to admins. Every
`/admin/*` route is gated on the admin role; a non-admin is refused `403 FORBIDDEN`.
`docker compose up` → candidate deletes an interview → it disappears for the user yet an
admin still sees it with `deleted: true` and unchanged cost is the observable end-to-end
result (`admin_cost.feature`, backend AC-17 and AC-18).

## The invariant this initiative must not weaken

> A soft-deleted interview never leaks into a user-facing list, and never disappears from
> the admin audit trail; the `/admin/*` surface is reachable only by an authenticated admin
> role. (K11, K13, §7.2)

Deleted-row leakage is a visible failure of a 5-point criterion (db spec Security), and an
open admin surface is a trust-boundary breach. This ledger touches `backend/modules/admin/`
and adds two user-facing interview routes (`DELETE /interviews/:id`, `GET /me/interviews`)
that interview-core deliberately delegated here (interview-core PLAN *Out of scope*). It
deliberately does not touch the auth credential path, the interview state machine, question
generation, the report job, or the schema — it **reads and aggregates** what those own.

## Scope boundary — `admin_auth.feature` is owned by auth A02, not here

`admin_auth.feature`'s single scenario `@AC-4` ("Admin accounts can sign in only with
password") is implemented and kept green by **auth task A02** (its check is
`@AC-4 or @AC-5`; see `.agents/ledgers/auth/STATE.md` and
`.agents/ledgers/auth/tasks/A02-google-oauth-admin-restriction.md`). The admin-must-use-
password rule (checked twice — Google callback and session issuance) is A02's, not this
ledger's. **This ledger owns `admin_cost.feature` and the admin dashboard / soft-delete
endpoints only.** It does not re-implement the admin-password rule (ADR-N04). It *consumes*
the admin session A02's password sign-in produces.

## Topology

```
Browser (admin)                         Browser (candidate)
  │ GET /admin/interviews                 │ DELETE /interviews/:id
  │ GET /admin/stats                      │ GET /me/interviews
  ▼                                       ▼
edge/ (Caddy — single published port, F03)
  ▼
backend/src/app.ts        ← Express app (auth A01); this ledger mounts modules/admin/router.ts
  │                           and adds the two interview routes below
  ├── modules/admin/
  │     router.ts          ← binds /admin/* behind requireAuth + requireAdmin (N01)
  │     middleware.ts      ← requireAdmin: req.user.role === 'admin' else 403 FORBIDDEN (N01)
  │     interviews.ts      ← GET /admin/interviews: ALL interviews incl. deleted, `deleted`
  │                           flag, token total + USD cost — bypasses the soft-delete helper (N01)
  │     stats.ts           ← GET /admin/stats: the K11 aggregate metrics (N02)
  │
  ├── modules/interview/   ← I03 built router.ts + ownership.ts + csrf.ts; this ledger adds:
  │     delete.ts          ← DELETE /interviews/:id: soft delete `deleted_at = now()` (N01)
  │     my-interviews.ts   ← GET /me/interviews: userInterviews() helper, deleted excluded (N01)
  │
  ├── src/lib/
  │     db.ts              ← F02 Prisma singleton + userInterviews()/activeInterview() (helpers)
  │     error-codes.ts     ← F01 registry (FORBIDDEN, INTERVIEW_NOT_FOUND, UNAUTHENTICATED)
  │     logger.ts          ← F03 pino factory
  │
  └── Postgres (F02): interviews (incl. `deleted_at`, `spent_usd`), llm_calls (tokens+cost),
                      report_questions (weakestQuestions), occupation_clusters (perOccupation)
```

The admin reads are the **only** callers that bypass `userInterviews()` and query
`prisma.interview.findMany` directly (K13) — annotated at every such call site (ADR-N02).

## Decision table (full ADRs in DECISIONS.md)

| # | Decision | Chosen | Reason |
|---|----------|--------|--------|
| ADR-N01 | Admin authorization | `requireAdmin` middleware layered on `requireAuth`; single `/admin/*` chokepoint; non-admin → `403 FORBIDDEN` | One trust-boundary point beats per-handler role checks that drift; `admin_cost.feature` @AC-18 asserts the gate |
| ADR-N02 | Deleted-row visibility for admins | Admin reads call `prisma.interview.findMany` directly (bypassing `userInterviews`), annotated at each call site | K11 counts deleted interviews ("Total tokens … deleted included"); the K13 helper is for user-facing modules only — this is the ONE sanctioned bypass |
| ADR-N03 | Soft delete + user list | `DELETE /interviews/:id` = `UPDATE deleted_at = now()` (never `DELETE`); `GET /me/interviews` = `userInterviews()`; both reuse I03's ownership resolver and CSRF middleware | Consume F02's helper, do not rebuild it; non-owner is `404 INTERVIEW_NOT_FOUND` (existence not leaked); the audit row survives |
| ADR-N04 | `admin_auth.feature` ownership | Owned by auth A02; this ledger builds no admin-auth task | The admin-password rule is a single security rule; double-owning it invites a divergent second implementation |

## Data model additions

**No structural changes.** This ledger consumes the F02 schema in full and reads only:

| Table | Admin reads |
|---|---|
| `interviews` | `id`, `user_id`, `state`, `ended_reason`, `occupation`, `occupation_cluster_id`, `started_at`, `ended_at`, `spent_usd`, `deleted_at` |
| `llm_calls` | `interview_id`, `input_tokens`, `output_tokens`, `cost_usd` (token total + cost, deleted interviews included) |
| `report_questions` | `question_id`, score column (lowest-scoring → `weakestQuestions`, a plain relational query — db AC-12) |
| `occupation_clusters` | cluster key/label for the `perOccupation` grouping |

The only write this ledger performs is the soft delete: `interviews.deleted_at = now()`.

No index or column is required beyond F02's §8.1 set — `interviews(user_id, created_at)`,
`interviews(occupation_cluster_id)`, `interviews(state)` and `llm_calls(interview_id)` cover
every admin read. A composite `llm_calls(interview_id, created_at)` is backlogged as a safe
additive migration if aggregation is slow at scale (see STATE backlog).

## Admin read surface (the ledger's core mechanic)

Every `/admin/*` route runs `requireAuth` → `requireAdmin` before its handler. Numbers are
computed to K11's fixed definitions (backend spec *Admin stats*) — cited, never re-decided:

- `GET /admin/interviews` → `{ items, nextCursor }`, each item `{ id, userId, state, deleted,
  occupation, occupationCluster, totalTokens, costUsd }`, deleted interviews **included**.
- `GET /admin/stats` → `{ averageDurationMs, completed, cutShort, unfinished, totalTokens,
  perOccupation[], weakestQuestions[] }` where:
  - `averageDurationMs` = mean of `ended_at − started_at` over `state = 'completed'` only.
  - `completed` = `state = 'completed'` (`cut_short` counts as completed, broken out as
    `cutShort`); `unfinished` = `abandoned` + `failed`.
  - `totalTokens` = Σ `input_tokens + output_tokens` from `llm_calls`, **deleted included**.
  - `perOccupation[]` = grouped by `occupation_cluster`, labelled by the most frequent
    `occupation` in that cluster.
  - `weakestQuestions[]` = lowest-scoring `question_id`s from `report_questions` (no jsonb).

## Phasing / task clusters (see STATE.md ledger)

0. Admin-role gate + soft-delete audit path (N01) — `requireAdmin`, `GET /admin/interviews`,
   `DELETE /interviews/:id`, `GET /me/interviews`; greens `@admin-cost and @AC-17`.
1. Admin stats aggregation (N02) — `GET /admin/stats`; greens `@admin-cost and @AC-18`.

**Why two tasks, not more.** `admin_cost.feature` holds exactly two scenarios, and each is a
single end-to-end assertion that cross-cuts several endpoints. AC-17 needs the delete route,
the user list **and** the admin audit list together; AC-18 needs the role gate, the admin
list **and** the stats endpoint together. A finer split would leave a task with no runnable
acceptance tag — a placeholder, which the method forbids. So the two greenable units are the
two scenarios: N01 (AC-17) builds the shared `requireAdmin` + `GET /admin/interviews`, and
N02 (AC-18) adds only the stats endpoint on top. N01 → N02 is a linear chain, one owner.

## Out of scope (post-admin)

- **`admin_auth.feature` / the admin-must-use-password rule (AC-4)** — auth **A02** (ADR-N04).
- **`GET /admin/interviews/:id` per-call drill-down** (provider/model/prompt-version/latency
  rows) — no acceptance scenario maps it (not in `COVERAGE.md`); backlog, promote when the
  admin drill-down UI (US-29) or a scenario is specced.
- **The report pipeline that writes `report_questions`** — `report`/`worker` ledgers.
  Admin only *reads* `report_questions` (db AC-12); the acceptance ring seeds the rows.
- **Cost *computation* per call (`spent_usd`, `llm_calls`, per-attempt cost)** —
  interview-core **I02** (per-attempt cost) and **I08** (in-transaction `spent_usd`
  increment). Admin **aggregates** these; it never computes per-call cost.
- **The soft-delete exclusion helper `userInterviews`** — F02/db owns it; this ledger
  consumes it, it does not rebuild the `deleted_at IS NULL` filter.
- **`requireAuth`, the session cookie, the interview ownership resolver, CSRF middleware** —
  auth A01 (`requireAuth`) and interview-core I03 (`activeInterview` ownership resolver,
  `csrf.ts`). This ledger reuses them for `DELETE /interviews/:id`.
- **Rich admin filters** (`?occupationCluster&state&userId` faceting beyond a `cursor/limit`
  page) — implement only the cursor pagination the green run needs; backlog richer filters
  until a UI requires them.
- **The Recharts rendering of these numbers, the admin panel UI, locale strings** —
  `frontend`/`ui` ledgers. This ledger returns numbers and stable codes, never display text.

**The entire schema lives in F02. This ledger may add indexes and nullable columns only,
each in its own migration, rebased before merge. Any structural change is a change to F02's
scope and gets discussed, not merged — it is the week-one collision that breaks
`docker compose up` on a fresh clone, which §10 calls the one unacceptable failure.**
