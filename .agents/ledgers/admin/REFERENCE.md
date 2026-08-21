# Admin — REFERENCE (read this once, then you don't need to spelunk)

Single orientation doc for any agent executing a task in this ledger. It reflects the
project layout **as it exists after foundations F01/F02/F03, auth A01/A02, and
interview-core I03/I06/I08 are done**. If a path listed here does not exist, its providing
task has not landed — check STATE.md blockers before proceeding. Verified against the
foundations, auth and interview-core task files and the `backend`/`db` specs as of
2026-07-30; patched 2026-08-11 for N03–N06. If reality diverges, trust the code and patch this
file.

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

# Unit tests + typecheck (from repo root). N03–N06's gate: no AC maps those endpoints.
npm test -- --run backend/modules/admin
npm test -- --run packages/ai/src/prompt-builder.test.ts   # N03's security sink
npm run typecheck

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
| `GET /admin/interviews` | `requireAuth` + `requireAdmin` | `200` `{ items, nextCursor }` (deleted included) + [list envelope](#search-sort-and-the-list-envelope-n06--all-five-lists) | `FORBIDDEN`, `UNAUTHENTICATED` | N01, facets N04, `q`/`sort`/`dir` N06 |
| `GET /admin/interviews/:id` | `requireAuth` + `requireAdmin` | `200` [drill-down shape](#get-admininterviewsid-drill-down-shape) | `FORBIDDEN`, `INTERVIEW_NOT_FOUND` | N04 |
| `GET /admin/stats` | `requireAuth` + `requireAdmin` | `200` [stats shape](#admin-stats-shape) | `FORBIDDEN`, `UNAUTHENTICATED` | N02, `perModel` N05 |
| `GET /admin/llm-calls` | `requireAuth` + `requireAdmin` | `200` [shape](#get-adminllm-calls) | `FORBIDDEN`, `UNAUTHENTICATED` | N05, `q`/`sort`/`dir` N06 |
| `GET /admin/users` | `requireAuth` + `requireAdmin` | `200` [shape](#get-adminusers) | `FORBIDDEN`, `UNAUTHENTICATED` | N05, `q`/`sort`/`dir` N06 |
| `GET /admin/sessions` | `requireAuth` + `requireAdmin` | `200` [shape](#get-adminsessions) | `FORBIDDEN`, `UNAUTHENTICATED` | N05, `q`/`sort`/`dir` N06 |
| `GET /admin/audit` | `requireAuth` + `requireAdmin` | `200` [shape](#get-adminaudit) | `FORBIDDEN`, `UNAUTHENTICATED` | N05, `q`/`sort`/`dir` N06 |
| `GET /admin/queue` | `requireAuth` + `requireAdmin` | `200` [shape](#get-adminqueue) | `FORBIDDEN`, `UNAUTHENTICATED` | N05 |

Every `/admin/*` read writes one `audit_logs` row per request (issue 86) — the read is itself
the privileged act. `GET /admin/audit` is no exception: a reader sees their own last visit at
the top, which is the right way round.

### Search, sort and the list envelope (N06 — all five lists)

The five `items`-returning lists (`/admin/interviews`, `/llm-calls`, `/users`, `/sessions`,
`/audit`) take three more query parameters and echo two more objects. `/admin/interviews/:id`,
`/admin/stats` and `/admin/queue` do not — they are not lists.

| Param | Meaning |
|---|---|
| `q` | the query language below, compiled against that table's spec in `backend/modules/admin/specs.ts` |
| `sort` | a field name from `sort.sortable`; anything else falls back to that table's default (`created` on all five) |
| `dir` | `asc`, or `desc` for anything else |

`q` grammar — one for every table (`backend/modules/admin/query-language.ts`). It is the **wire
format**, not an interface: the console composes it by clicking (W13's filter builder), so a
term normally arrives well-formed by construction. It is still a query string, so everything
below has to survive being written by hand:

```text
ada@example.com      bare word — matched against the table's freeText columns, OR'd
"senior backend"     quoted phrase — the same, spaces kept
state:completed      field:value — exact, enum-checked or contains, per the field's kind
action:security.*    trailing * on a text field — prefix match
deleted:true         presence — the column IS NOT NULL / IS NULL
cost>0.10            > < >= <= on a number, a Decimal or a date
created:2026-08-11   a bare date is the whole DAY, not the instant midnight
active:true          computed — built from two columns and the request's clock (ADR-N11)
```

Terms **AND**. There is no `OR`, no parenthesis and no negation. An unknown field, an
out-of-enum value, a comparison on an unordered kind, a `computed` field whose `build` declines
and an unparseable number/date all come back in `query.ignored` and narrow nothing — never a
`422`, never a silent drop (ADR-N08). The compiled query is **ANDed with** the discrete facets
each endpoint already takes, and the applied terms go into the read's
`audit_logs.metadata.query`.

Every one of the five envelopes gains:

```jsonc
{
  "items": [ /* unchanged, per-endpoint */ ],
  "nextCursor": null,
  "query": {
    "applied": ["state:completed"],   // terms that compiled
    "ignored": ["stat:completed"],    // terms that did not — SHOW THESE
    // The table's whole whitelist, DESCRIBED — one entry per field, `values` on an enum
    // (and on `computed`, which is always true/false).
    "fields": [
      { "name": "account", "kind": "text" },
      { "name": "cost",    "kind": "decimal" },
      { "name": "created", "kind": "date" },
      { "name": "state",   "kind": "enum", "values": ["created", "profiling", "hr_round", "…"] }
    ]
  },
  "sort": { "field": "created", "dir": "desc", "sortable": ["created", "cost", "…"] }
}
```

`fields` is `FieldDescriptor[]` — `{ name, kind, values? }` — not a list of names. Kinds are the
eight `FieldKind`s: `text`, `exact`, `enum`, `number`, `decimal`, `date`, `presence`, `computed`.
It is described rather than listed because the console **builds its filter controls from it**: a
date field gets a date input, an enum gets a select of exactly the values the server accepts, so
a control cannot propose a term that comes back ignored. A client keeping its own copy of the
kinds is a copy of the whitelist, and a copy goes stale the first time a field is renamed.

**The cursor changed on these five** (ADR-N09): `base64url(sort:dir:id)`, not `base64url(id)`.
A cursor minted under a different order is dropped and the caller gets page one — Prisma seeks
to the cursor row's position *in the given order*, so re-using one across a re-sort pages from
the middle of a list nobody asked for. `compileSort` appends `id` to every order, so the order
is total and the position is unique. `/me/interviews` and `/me/questions` keep the plain
`encodeCursor`/`decodeCursor`: one order each, nothing to mismatch.

**Sortable per table:** interviews `created,started,ended,cost,budget,state,occupation,account`
· llm-calls `created,cost,latency,provider,model,version,attempt` · users
`created,email,role,interviews` · sessions `created,expires,email` · audit
`created,action,actor`. `users.interviews` is the relation **count** — sortable natively, and
**not** filterable, so it is absent from `query.fields` and `interviews>5` is ignored as a term
(ADR-N10).

**Filterable per table** (the field count each envelope echoes): interviews 15 · llm-calls 15 ·
users 9 · sessions 8 · audit 8. `sessions.active` is the one `computed` field — "neither revoked
nor past its expiry", built from `revoked_at`, `expires_at` and the **request's** clock, which
`listParams(query, spec, now)` threads down from the handler's `clock.now()` (ADR-N11). Nothing
else needs a clock, and nothing else may reach for `new Date()` inside the compiler.

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
  "costUsd": "0.041200",            // interviews.spent_usd, six-decimal string
  "userEmail": "ada@example.com",   // N04 — users.email_lower (anonymised if erased)
  "budgetUsd": "0.500000",          // N04
  "startedAt": "2026-08-11T09:00:00.000Z",   // N04, null until started
  "createdAt": "2026-08-11T08:59:00.000Z"    // N04
}
```

Deleted interviews are **included** (the whole point of @AC-17); `costUsd`/`totalTokens` are
read verbatim from the untouched `spent_usd` / `llm_calls` rows — a soft delete never changes
them.

**Facets** (N04): `?occupationCluster=<cluster key>&state=<InterviewState>&userId=<cuid>`,
alongside `?cursor&limit`. Every facet **narrows**; none can widen, so the K11 bypass survives
any combination — a filtered page still shows deleted rows. An unknown `state`, an empty
value, a repeated param (`?userId=a&userId=b` → array) and a structured param (`?q[x]=y` →
object) are all **dropped**, not `422`'d — the same rule `pageLimit` follows. The applied
filters go into the read's `audit_logs.metadata`.

### `GET /admin/interviews/:id` drill-down shape

`findUnique` with **no** `deleted_at` filter — a deleted interview is exactly the one an admin
opens this for (K11). Absent → `INTERVIEW_NOT_FOUND`.

```jsonc
{
  "interview": {
    "id": "…", "userId": "…", "userEmail": "ada@example.com",
    "mode": "text", "language": "en", "state": "completed",
    "endedReason": "completed", "deleted": false,
    "occupation": "developer", "occupationCluster": "software", "occupationLabel": "Software",
    "targetQuestionCount": 5, "hrQuestionCount": 2,
    "budgetUsd": "0.500000", "spentUsd": "0.123456", "elapsedSeconds": 300,
    "createdAt": "…", "startedAt": "…", "endedAt": null, "deletedAt": null,
    // US-28 rollback handle; null when no report row exists
    "report": { "status": "ready", "promptUuid": "…", "promptVersion": 3 }
  },
  "calls": [                        // llm_calls, created_at ASC, capped at MAX_CALLS = 500
    { "id": "…", "provider": "openai", "model": "gpt-4.1-mini",
      "promptUuid": "…", "promptVersion": 3, "attemptNo": 1, "fellBackFrom": null,
      "units": "1200", "unitKind": "token",     // a voice call is its own `second` row (K12/§3.5)
      "inputTokens": 800, "outputTokens": 400,
      "costUsd": "0.000400", "latencyMs": 950, "traceId": "…", "createdAt": "…" }
  ],
  "callsTruncated": false,          // said out loud — a silently short list reads as complete
  "events": [                       // audit_logs, subject_type='interview' + subject_id=:id,
    { "id": "…",                    // created_at DESC, capped at 200 (N03 writes these)
      "action": "security.prompt_injection_suspected",
      "actorUserId": "…", "traceId": "…",
      "metadata": { "field": "jobListing", "patternId": "ignore-previous-instructions" },
      "createdAt": "…" }
  ]
}
```

`events` keys on `subject_type`+`subject_id`, **never** on `action`: admin list reads are
recorded as `subject_type = 'interview_list'` with a null `subject_id`, so they cannot crowd
out the timeline.

### Admin stats shape

`GET /admin/stats` (backend spec *Admin stats*, K11 fixed definitions):

```jsonc
{
  "averageDurationMs": 512000,      // mean(ended_at − started_at) over state='completed'
  "completed": 12,                  // state='completed' (cut_short counts as completed)
  "cutShort": 3,                    // broken out of completed
  "unfinished": 4,                  // abandoned + failed
  "totalTokens": 84210,             // Σ input+output tokens, DELETED INTERVIEWS INCLUDED
  "totalCostUsd": "12.404100",      // N05 — Σ llm_calls.cost_usd, NOT interviews.spent_usd
  "perModel": [                     // N05 — read from llm_model_stats, a running total (perf fix, see below)
    { "provider": "openai", "model": "gpt-4.1-mini",
      "calls": 812, "tokens": 41220, "costUsd": "3.104000", "averageLatencyMs": 940 }
  ],
  "perOccupation": [                // grouped by occupation_cluster, labelled by modal occupation
    { "cluster": "software", "label": "Backend Engineer", "count": 9 }
  ],
  "weakestQuestions": [             // lowest-scoring report_questions.question_id (no jsonb)
    { "questionId": "…", "score": 1 }
  ]
}
```

`totalCostUsd` and `perModel[]` are **additions** (N05); every K11 field above them is
unchanged, byte for byte (issue 85). The total is summed from `llm_calls` rather than
`interviews.spent_usd` so it cannot disagree with its own breakdown, and voice rolls into it —
a per-second row and a per-token row are both money spent; `unitKind` on the drill-down is
where the two split.

`perModel[]` was originally `groupBy(['provider','model'])` over every `llm_calls` row ever
written — unbounded, on every dashboard load. It now reads `llm_model_stats`, a per-`(provider,
model)` running total kept in step by `recordLlmCall` (db.ts) in the same transaction as the
`llm_calls` insert — the same pattern `interviews.spent_usd` already used. Sized to providers ×
models, not calls.

### `GET /admin/llm-calls`

```jsonc
{
  "items": [ /* the drill-down `calls` row shape, plus `interviewId` */ ],
  "facets": [ { "provider": "openai", "model": "gpt-4.1-mini", "count": 812 } ],
  "nextCursor": null
}
```

Filters `?provider&model&interviewId` (+ `?cursor&limit`). Ordered `created_at desc, id desc`
— calls inside one turn share a millisecond often enough that time alone is not a total order,
and a cursor over a non-total order repeats or skips rows. `facets` is **unfiltered** on
purpose: a facet list that narrowed with the selection could not be used to change it. There
is **no error rate**: `llm_calls` has no success/failure column, so none is derivable and none
is invented — `fellBackFrom` is the failure signal that does exist.

### `GET /admin/users`

```jsonc
{
  "items": [
    { "id": "…", "email": "ada@example.com", "role": "user", "locale": "en",
      "emailVerified": true, "onboarded": true,
      "consentVersion": "…", "consentedAt": "…",
      "erased": false,              // users.deleted_at (KVKK)
      "interviewCount": 4,          // deleted interviews INCLUDED (K11)
      "createdAt": "…" }
  ],
  "nextCursor": null
}
```

Filters `?role` (`admin`|`user`, anything else dropped) and `?q` (lowercased — `email_lower`
is what is stored). Projects **no** `password_hash`, `google_sub` or session token.

### `GET /admin/sessions`

The AUTH `sessions` table, not voice sessions — ADR-S01 deleted those with the ElevenLabs
agent (ADR-N07).

```jsonc
{
  "items": [
    { "id": "…",                    // a row's PK, not the signed cookie value
      "userId": "…", "userEmail": "ada@example.com", "role": "user",
      "active": true,               // revoked_at IS NULL AND expires_at > clock.now()
      "revokedAt": null, "expiresAt": "…", "createdAt": "…" }
  ],
  "nextCursor": null
}
```

Filters `?userId` and `?active=true`. `active` is computed **server-side** — a browser with a
wrong clock would draw a different answer. Anything but the literal `true` leaves the list
unfiltered rather than inverting it. Since N06 the same question is also a **field**:
`q=active:true` (and `active:false`, which the parameter cannot express) compiles to the same
condition through `SESSION_SPEC.active`'s `build`, which is what lets the console's filter
builder offer it beside every other field (ADR-N11). The parameter is still accepted and is no
longer sent by anything — W13 deleted the toggle with the facet bar.

### `GET /admin/audit`

```jsonc
{
  "items": [
    { "id": "…", "action": "interview.soft_deleted",
      "actorUserId": "…", "actorEmail": "…", "actorRole": "user",
      "subjectType": "interview", "subjectId": "…",
      "traceId": "…", "metadata": { }, "createdAt": "…" }
  ],
  "actions": [ { "action": "admin.interviews_read", "count": 91 } ],
  "nextCursor": null
}
```

Filters `?action&actorUserId&subjectId`. `actions` is counted from the rows, **not** from the
`AuditAction` union in `src/lib/audit.ts` — a hardcoded copy drifts the first time an action is
added.

### `GET /admin/queue`

```jsonc
{
  "queues": [
    { "name": "report", "waiting": 0, "active": 1, "delayed": 0, "failed": 2, "completed": 40 }
  ],
  "deadLetter": [                   // BullMQ `failed`, newest 20
    { "id": "…", "interviewId": "…",   // R01 sets jobId = interviewId, so they are the same
      "attemptsMade": 3, "failedReason": "…", "failedAt": "…" }
  ]
}
```

One queue, because it is the only real one: generation and scoring run inline on the request,
and the mail producer sits behind `auth/mail-queue.ts`, an interface the acceptance ring swaps
out — no BullMQ handle to count. `REPORT_JOB_OPTIONS.removeOnFail` keeps failures seven days,
and every dead-letter row has a matching `POST /admin/interviews/:id/report/requeue`. There is
no `paused` count: `paused` is not a BullMQ `JobType` (`JobState | 'repeat' | 'wait'`).

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
| `backend/modules/admin/stats.ts` | N02, N05 | `GET /admin/stats`: the K11 aggregate metrics; N05 adds `totalCostUsd` + `perModel[]` |
| `backend/src/lib/audit.ts` | issue 86 | `recordAudit(client, entry)` + the `AuditAction` union. The client is a **parameter** so a destructive caller can pass its transaction; reads pass `prisma` |
| `packages/ai/src/prompt-builder.ts` | N03 | `SecurityEventSink` type + optional 4th ctor arg; the sink fires alongside `logger.warn`, never instead of it |
| `backend/modules/ai/index.ts` | N03 | `recordSecurityEvent` — the sink → `recordAudit`. Detached (`void` + `.catch`); actor is the interview's own account |
| `backend/modules/interview/machine.ts` | I07, N03 | `recordExhaustion` in `applyTransition`: the ONE chokepoint that writes `interview.budget_exhausted` / `interview.time_exhausted` |
| `backend/modules/admin/interview-detail.ts` | N04 | `GET /admin/interviews/:id` + the pure `shapeInterviewDetail` (testable without a database) |
| `backend/modules/admin/llm-calls.ts` | N05 | `GET /admin/llm-calls` + `llmCallFilters` |
| `backend/modules/admin/users.ts` | N05 | `GET /admin/users` + `userFilters` |
| `backend/modules/admin/sessions.ts` | N05 | `GET /admin/sessions` + `sessionFilters(query, now)` |
| `backend/modules/admin/audit-log.ts` | N05 | `GET /admin/audit` + `auditFilters` |
| `backend/modules/admin/queue.ts` | N05 | `GET /admin/queue`: BullMQ counts + 20-row dead-letter sample |
| `backend/modules/admin/query-language.ts` | N06 | The `q` grammar → a Prisma `where` (`compileQuery(input, spec, now)`), the whitelist-checked sort, and the order-carrying cursor (`encodeListCursor`/`decodeListCursor`). Eight `FieldKind`s, the eighth being `computed` |
| `backend/modules/admin/specs.ts` | N06 | The five `TableSpec`s — field name → column path + kind (+ `values` on an enum, `build(value, now)` on a `computed`), `freeText`, `sortable`, `defaultSort`, `sortOverrides`. **The security boundary:** a column not named here is not reachable, and a field not named here is not offered by any control |
| `backend/modules/admin/list.ts` | N06 | `listParams` / `findManyArgs` / `listEnvelope` + `FieldDescriptor` — the paging, searching, sorting and field-describing all five lists share |

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

**Cursor pagination**: every list on this surface returns `{ items, nextCursor }` and uses
`modules/interview/cursor.ts`'s `encodeCursor`/`decodeCursor`/`pageLimit`. `nextCursor` is
opaque; `limit` defaults to a small page. **Order by `created_at desc, id desc`** on the N05
lists — `created_at` alone is not a total order (calls inside one turn share a millisecond),
and a cursor over a non-total order repeats or skips rows between pages.

**Query facets narrow or are dropped, never `422`** (N04/N05). An unknown enum value, an empty
string, a repeated param (Express → array) and a structured param (`?q[x]=y` → object) all
yield no clause. A `where` built from an array or an object is a 500 on a URL anyone can type;
`backend/modules/admin/filters.test.ts` pins that across the four N05 parsers and
`interviews.test.ts` across N04's. No facet may add a `deleted_at` clause — that would restore
the K11 leak from the other direction.

**Audit actions** (`src/lib/audit.ts`) are a union in TypeScript and a `String` column in
Postgres, so a new action is never a migration. Current set: `interview.soft_deleted`,
`auth.password_reset_completed`, `security.prompt_injection_suspected`,
`interview.budget_exhausted`, `interview.time_exhausted`, and the eight `admin.*_read` values
(`interviews`, `interview`, `stats`, `llm_calls`, `users`, `sessions`, `audit`, `queue`).
**No PII in a row** — ids, an action, and `metadata` for counts, flags and filter keys (issue
063). The injection sink carries the field NAME and the pattern id, never the matched text.
Note for the console: next-intl cannot address a message key containing a dot, so the labels
are stored underscored and looked up as `action.replaceAll('.', '_')`.

**Migration rule** (ADR-F02): no structural schema change in this ledger. If a task ever needs
an index (none is currently required beyond F02's §8.1 set), author it as a new Prisma migration
file (`backend/prisma/migrations/<timestamp>_<name>/`) rebased on the F02 migration before merge.
Never edit an existing migration SQL file, never add a column or enum value.
