# Admin — REFERENCE (read this once, then you don't need to spelunk)

Single orientation doc for any agent executing a task in this ledger. It reflects the
project layout **as it exists after foundations F01/F02/F03, auth A01/A02, and
interview-core I03/I06/I08 are done**. If a path listed here does not exist, its providing
task has not landed — check STATE.md blockers before proceeding. Verified against the
foundations, auth and interview-core task files and the `backend`/`db` specs as of
2026-07-30. If reality diverges, trust the code and patch this file.

## Services, ports, roles

| Service | Package | Port (internal) | DB role | Trust |
|---|---|---|---|---|
| `api` | `backend/` | 3001 | reads/writes all tables | trusted internal; Caddy terminates TLS |
| `db` | Postgres (compose) | 5432 | persistence | not published on host (K14) |
| `cache` | Redis (compose) | 6379 | rate-limit counters, SSE fan-out | not published on host |
| `web` | `frontend/` | 3000 | none | public via Caddy |
| `edge` | Caddy | 443 (host) | none | single published port (F03) |

The admin module runs inside `api`. The browser calls Caddy → Caddy proxies `/api/*` to
`api:3001`.

## Commands

```bash
# Start Postgres + Redis (from repo root)
docker compose up -d db cache

# Backend dev + migrate + seed (from backend/)
npm install
npx prisma migrate deploy
npm run seed                     # seeds the role=admin demo user (db AC-10)
npm run dev                      # tsx watch

# The Cucumber acceptance runner runs from the repo root (wired by F03/CI).
npm run test:acceptance -- --tags "@admin-cost and @AC-17"   # N01 scope
npm run test:acceptance -- --tags "@admin-cost and @AC-18"   # N02 scope
npm run test:acceptance -- --tags "@admin-cost"              # whole feature (after N02)
```

**`admin_cost.feature` is in the `default` profile** (N01), not `auth`. `npm run
test:acceptance` IS the default profile — the auth ring needs `npx cucumber-js -p auth` — so
the commands above only work from there. Steps: `backend/features/step_definitions/admin.steps.ts`
against `AiWorld`, which has booted the real app over HTTP against Postgres since I03.

**Running acceptance from the host** (not inside compose): root `.env` uses the
docker-internal hostnames `db`/`cache`, which do not resolve. Override:

```bash
export DATABASE_URL="postgresql://interviewly:interviewly@localhost:5432/interviewly_test"
export REDIS_URL="redis://localhost:6380"      # compose.dev maps 6380 -> 6379
docker compose -f compose.yaml -f compose.dev.yaml up -d db cache
npx prisma migrate deploy --schema backend/prisma/schema.prisma
```

`db/init.sql` creates `interviewly_test` only on a **fresh** volume; on an older volume
create it by hand (`CREATE DATABASE interviewly_test`) before the migrate.

**Tag-collision note.** `@AC-<n>` tags are not globally unique across feature files, but
`@AC-17` and `@AC-18` appear **only** in `admin_cost.feature` (verified 2026-07-30). Scoping
with `@admin-cost and @AC-17` is unambiguous and is the form the task Verification commands
use. `@admin-cost` alone runs both scenarios.

## HTTP contracts (admin + soft-delete surface)

All error responses use the envelope `{ "error": { "code": "…" } }` with a stable
SCREAMING_SNAKE_CASE code — never a display string. Every `/admin/*` route is gated by
`requireAuth` → `requireAdmin` (non-admin → `403 FORBIDDEN`). The `:id` interview routes are
ownership-checked by I03's resolver (non-owner → `404 INTERVIEW_NOT_FOUND`, never 403).

| Method + Path | Auth | Success | Error codes | Task |
|---|---|---|---|---|
| `DELETE /interviews/:id` | `requireAuth` + I03 ownership + I03 CSRF | `204` (soft delete) | `INTERVIEW_NOT_FOUND`, `CSRF_ORIGIN_MISMATCH`, `UNAUTHENTICATED` | N01 |
| `GET /me/interviews` | `requireAuth` | `200` `{ items, nextCursor }` (deleted excluded) | `UNAUTHENTICATED` | N01 |
| `GET /admin/interviews` | `requireAuth` + `requireAdmin` | `200` `{ items, nextCursor }` (deleted included) | `FORBIDDEN`, `UNAUTHENTICATED` | N01 |
| `GET /admin/stats` | `requireAuth` + `requireAdmin` | `200` [stats shape](#admin-stats-shape) | `FORBIDDEN`, `UNAUTHENTICATED` | N02 |

### `GET /admin/interviews` item shape

```jsonc
{
  "id": "…",
  "userId": "…",
  "state": "completed",             // InterviewState (F02)
  "deleted": true,                  // deleted_at IS NOT NULL
  "occupation": "Backend Engineer",
  "occupationCluster": "software",  // occupation_clusters key, null if unmatched
  "totalTokens": 4210,              // Σ input_tokens + output_tokens over llm_calls
  "costUsd": "0.041200"             // interviews.spent_usd, six-decimal string
}
```

Deleted interviews are **included** (the whole point of @AC-17); `costUsd`/`totalTokens` are
read verbatim from the untouched `spent_usd` / `llm_calls` rows — a soft delete never changes
them.

### Admin stats shape

`GET /admin/stats` (backend spec *Admin stats*, K11 fixed definitions):

```jsonc
{
  "averageDurationMs": 512000,      // mean(ended_at − started_at) over state='completed'
  "completed": 12,                  // state='completed' (cut_short counts as completed)
  "cutShort": 3,                    // broken out of completed
  "unfinished": 4,                  // abandoned + failed
  "totalTokens": 84210,             // Σ input+output tokens, DELETED INTERVIEWS INCLUDED
  "perOccupation": [                // grouped by occupation_cluster, labelled by modal occupation
    { "cluster": "software", "label": "Backend Engineer", "count": 9 }
  ],
  "weakestQuestions": [             // lowest-scoring report_questions.question_id (no jsonb)
    { "questionId": "…", "score": 1 }
  ]
}
```

## Key code anchors

All paths relative to repo root. Each exists once its providing task lands.

| Path | Task | What it does |
|---|---|---|
| `backend/src/lib/error-codes.ts` | F01 | Error-code registry; `FORBIDDEN` (403), `INTERVIEW_NOT_FOUND` (404), `UNAUTHENTICATED` (401) already present |
| `backend/src/lib/db.ts` | F02 | Prisma singleton, `userInterviews(userId)` (deleted excluded), `activeInterview(id)` (deleted excluded) |
| `backend/src/lib/logger.ts` | F03 | Pino factory: `logger.<level>({obj}, "EVENT_NAME")` |
| `backend/src/app.ts` | A01 | Express app + global middleware; admin mounts its router here, and the two interview routes attach to I03's router |
| `backend/modules/auth/middleware.ts` | A01 | `requireAuth`: cookie → session row → `req.user` (with `role`) |
| `backend/modules/interview/router.ts` | I03 | Interview router; `:id` ownership resolver mounted as param middleware; `DELETE` attaches here (N01) |
| `backend/modules/interview/ownership.ts` | I03 | `resolveInterview`: `activeInterview` + `user_id` check → `404 INTERVIEW_NOT_FOUND` on miss |
| `backend/modules/interview/csrf.ts` | I03 | `requirePublicOrigin`: `Origin`/`Referer` == `PUBLIC_ORIGIN` else `403 CSRF_ORIGIN_MISMATCH` |
| `backend/modules/admin/router.ts` | N01 | Mounts `/admin/*` behind `requireAuth` + `requireAdmin`; N02 adds `/admin/stats` here |
| `backend/modules/admin/middleware.ts` | N01 | `requireAdmin`: `req.user.role === 'admin'` else `403 FORBIDDEN` |
| `backend/modules/admin/interviews.ts` | N01 | `GET /admin/interviews`: deleted-inclusive audit list, `deleted` flag, token total + cost |
| `backend/modules/interview/delete.ts` | N01 | `DELETE /interviews/:id`: `UPDATE deleted_at = now()`, `204` |
| `backend/modules/interview/my-interviews.ts` | N01 | `GET /me/interviews`: `userInterviews(req.user.id)`, cursor-paginated |
| `backend/modules/interview/cursor.ts` | N01 | `encodeCursor`/`decodeCursor`/`pageLimit`, shared by both lists |
| `backend/modules/admin/stats.ts` | N02 | `GET /admin/stats`: the K11 aggregate metrics |

## Schema (tables this ledger reads/writes)

Owned by F02. Admin **reads** these and writes only `interviews.deleted_at`:

```
interviews
  id                    String   @id (cuid)
  user_id               String   FK → users.id RESTRICT
  state                 InterviewState   // created|profiling|hr_round|tech_round|paused|
                                         // evaluating|completed|failed|abandoned
  ended_reason          EndedReason?     // completed|cut_short|budget_exhausted|
                                         // time_exhausted|abandoned|error
  occupation            String
  occupation_cluster_id String?  FK → occupation_clusters.id RESTRICT
  spent_usd             Decimal(12,6)    // per-interview cost (I08 increments)
  started_at            DateTime?
  ended_at              DateTime?
  deleted_at            DateTime?        // soft delete — the ONLY column this ledger writes

llm_calls
  interview_id  String   FK → interviews.id RESTRICT   // @@index([interview_id])
  input_tokens  Int
  output_tokens Int
  cost_usd      Decimal(12,6)

report_questions
  question_id   String   FK → questions.id
  score         Int      // lowest-scoring → weakestQuestions (plain relational, db AC-12)

occupation_clusters
  id  String   @id
  key String   // grouping key for perOccupation
```

**Soft delete** (db spec Behaviour §1): deletion is `UPDATE interviews SET deleted_at = now()`,
never a hard `DELETE`. Only `interviews` has `deleted_at`. `userInterviews()`/`activeInterview()`
bake in `deleted_at IS NULL`; the admin reads deliberately bypass them (ADR-N02).

## Conventions

**Error codes** are imported from `backend/src/lib/error-codes.ts`, never inlined as strings.
All codes this ledger needs (`FORBIDDEN`, `INTERVIEW_NOT_FOUND`, `UNAUTHENTICATED`) are already
in the F01 registry — no new codes.

**Log shape**: `logger.info({ userId, interviewId, traceId }, "EVENT_NAME")` — structured
object first, event name second, no display strings. Admin events to emit:
`ADMIN_INTERVIEWS_LISTED`, `ADMIN_STATS_READ`, `INTERVIEW_SOFT_DELETED`. Never log
`spent_usd` breakdowns tied to a user, tokens, or any PII; `interviewId` + `traceId` are the
K6 keys (§7.2, K6).

**The soft-delete bypass** (ADR-N02): every admin `prisma.interview.findMany` (no `deleted_at`
filter) carries the comment
`// ADMIN AUDIT — intentionally bypasses userInterviews (K11: deleted interviews counted)`.
This is the only sanctioned direct `findMany`; outside `modules/admin/` it is a review red flag.

**Authorization order**: `requireAuth` (A01) always runs before `requireAdmin` (N01) — the
gate reads `req.user.role`, which `requireAuth` sets. A non-owned interview is `404
INTERVIEW_NOT_FOUND` (existence not leaked); a non-admin on `/admin/*` is `403 FORBIDDEN`
(the resource class is known to exist, only the role is wrong).

**Cursor pagination**: `GET /admin/interviews` and `GET /me/interviews` return
`{ items, nextCursor }`. `nextCursor` is opaque (encode the last row's `(created_at, id)`);
`limit` defaults to a small page. Only the minimal cursor page the green run needs is in scope
— richer faceted filters are backlogged (STATE).

**Migration rule** (ADR-F02): no structural schema change in this ledger. If a task ever needs
an index (none is currently required beyond F02's §8.1 set), author it as a new Prisma migration
file (`backend/prisma/migrations/<timestamp>_<name>/`) rebased on the F02 migration before merge.
Never edit an existing migration SQL file, never add a column or enum value.
