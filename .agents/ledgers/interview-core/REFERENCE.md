# Interview-core — REFERENCE (read this once, then you don't need to spelunk)

Single orientation doc for any agent executing a task in this ledger. It reflects the
project layout **as it exists after foundations F01/F02/F03 and auth A01 are done**. If a
path listed here does not exist, its providing task has not landed — check STATE.md
blockers before proceeding. Verified against the foundations and auth task files and the
`backend`/`ai` specs as of 2026-07-30. If reality diverges, trust the code and patch this
file.

## Services, ports, roles

| Service | Package | Port (internal) | DB role | Trust |
|---|---|---|---|---|
| `api` | `backend/` | 3001 | reads/writes all tables | trusted internal; Caddy terminates TLS |
| `db` | Postgres (compose) | 5432 | persistence | not published on host (K14) |
| `cache` | Redis (compose) | 6379 | rate-limit counters, SSE fan-out, BullMQ | not published on host |
| `web` | `frontend/` | 3000 | none | public via Caddy |
| `edge` | Caddy | 443 (host) | none | single published port (F03) |
| object store | S3-compatible bucket | — | private report/avatar objects | signed URLs only (K14, I12) |

The interview module runs inside `api`. The browser calls Caddy → Caddy proxies `/api/*`
to `api:3001`. `@interviewly/ai` is a workspace package imported by both `api` and
`worker`.

## Commands

```bash
# Start all services (from repo root)
docker compose up -d

# Backend development (from backend/)
npm install
npm run dev                     # tsx watch

# Apply the F02 migration + seed
cd backend && npx prisma migrate deploy && npm run seed

# Build / test the shared AI package (from repo root)
npm run -w @interviewly/ai build
npm run -w @interviewly/ai test

# The Cucumber acceptance runner runs from the repo root (wired by I01, not F03).
#
# Layout (ADR-I15): root `cucumber.js` is the config. Its `paths` is an explicit ALLOW-LIST
# over `.agents/features/` — the feature files are read where Stage 2 authored them, with no
# second copy under backend/. Step definitions live in `backend/features/step_definitions/`
# and load through `tsx/cjs`. `strict: true`, so an undefined or ambiguous step fails.
#
# >>> Your task MUST append its feature file to `cucumber.js` `paths` when it wires the
# >>> steps. Forget, and your scenarios silently do not run.
#
# I05 (ADR-I25): a file owned by several tasks goes into `paths` whole, and the scenarios
# whose steps do not exist yet carry `@unwired` — the default profile runs `not @unwired`.
# >>> If your task's scenario is tagged @unwired, DELETE that tag when you wire its steps.
# >>> Same trap as `paths`: leave it and the scenario silently does not run.
#
# I04: `cucumber.js` forces AI_ENABLED=false for every run. The suite generates through the
# app's own AiClient now, and the local .env carries live provider keys — an unguarded run
# would bill them and make assertions non-deterministic. ai_provider.feature is unaffected
# (it fakes ProviderTransport inside the World). A shared Before hook in server.ts clears
# `ratelimit:*` and upserts the two personas, since register is 3/hour per IP and CI runs
# `migrate deploy` without `npm run seed`.
#
# Running it LOCALLY needs host-reachable URLs — .env points at the compose hostnames, which
# do not resolve from the host:
#
#   export DATABASE_URL=postgresql://interviewly:interviewly@localhost:5432/interviewly
#   export REDIS_URL=redis://localhost:6380
#
# Verification commands in this ledger use area tags; scope compound files with `and`.
npm run test:acceptance -- --tags "@security"
npm run test:acceptance -- --tags "@ai-provider"
npm run test:acceptance -- --tags "@question-generation and @AC-6"
npm run test:acceptance -- --tags "@interview-flow and @AC-16"
npm run test:acceptance -- --tags "@upload"
npm run test:acceptance -- --tags "@object-storage"
npm run test:acceptance -- --tags "@rate-limits"
npm run test:acceptance -- --tags "@reliability"
npm run test:acceptance -- --tags "@config"
npm run test:acceptance -- --tags "@language-detection"
npm run test:acceptance -- --tags "@schema-validation"
```

**Tag-collision rule (read before writing any Verification command):** `@AC-<n>` tags are
**not** globally unique across feature files. Where a task owns a whole feature file, scope
by that file's unique **area** tag alone (`@security`, `@ai-provider`, `@upload`,
`@object-storage`, `@rate-limits`, `@reliability`, `@config`, `@language-detection`,
`@schema-validation`). Where a task owns a slice of a shared file, combine
`@area and @AC-n` (e.g. `@interview-flow and @AC-8`). Never verify a shared file by
`@AC-n` alone.

## HTTP contracts (interview surface)

All error responses use the envelope `{ "error": { "code": "…" } }` with a stable
SCREAMING_SNAKE_CASE code — never a display string. All `:id` routes are ownership-checked
(ADR-I11): a non-owned id is `404 INTERVIEW_NOT_FOUND`, never 403.

| Method + Path | Auth | Success | Error codes | Task |
|---|---|---|---|---|
| `POST /uploads` | `requireAuth` | 201 `{ uploadId }` | `UPLOAD_TOO_LARGE`, `UNSUPPORTED_MEDIA_TYPE`, `UPLOAD_TOO_MANY_PAGES`, `PDF_TEXT_TOO_SHORT`, `VALIDATION_ERROR`, `RATE_LIMITED` | I11 |
| `POST /interviews` | `requireAuth` | 201 `{ interviewId, hrCount, techCount }` | `LISTING_REQUIRED`, `VALIDATION_ERROR`, `DAILY_INTERVIEW_LIMIT`, `RATE_LIMITED`, `CSRF_ORIGIN_MISMATCH` | I03, I13 |
| `GET /interviews/:id/state` | `requireAuth` | 200 room-state | `INTERVIEW_NOT_FOUND`, `UNAUTHENTICATED` | I03 |
| `POST /interviews/:id/profile` | `requireAuth` | 200 `{ state }` | `INTERVIEW_NOT_FOUND`, `INVALID_STATE_TRANSITION`, `CSRF_ORIGIN_MISMATCH`, `AI_OUTPUT_INVALID` | I04, I05 |
| `POST /interviews/:id/answers` | `requireAuth` | 200 `{ state, nextIndex }` | `INTERVIEW_NOT_FOUND`, `QUESTION_NOT_CURRENT`, `INVALID_STATE_TRANSITION`, `BUDGET_EXCEEDED`, `CSRF_ORIGIN_MISMATCH` | I06, I08 |
| `POST /interviews/:id/resume` | `requireAuth` | 200 `{ state }` | `INTERVIEW_NOT_FOUND`, `INVALID_STATE_TRANSITION`, `CSRF_ORIGIN_MISMATCH` | I07 |
| `GET /interviews/:id/report/download` | `requireAuth` | 200 `{ url }` (signed, ≤ 300 s, not under `/assets/`) | `INTERVIEW_NOT_FOUND` | I12 |
| `GET /events/interviews/:id` | `requireAuth` | 200 SSE stream | `INTERVIEW_NOT_FOUND` | I07 |
| `GET /healthz` | — | 200 `{ ok: true }` | — | I14 |
| `GET /readyz` | — | 200 `{ ready: true }` / 503 `NOT_READY` | `NOT_READY` | I14 |

Room-state shape (`GET /state`, backend spec §6, implemented I03): `{ interviewId, state,
mode, currentIndex, targetQuestionCount, endedReason, language, persona: { role, name,
avatarState } | null, currentQuestion: { id, text, kind, widget, deliveredAt } | null,
transcriptCursor }`. This supersedes an earlier draft of this shape that used `question` +
`hrQuestionCount`/`spentUsd`/`budgetUsd` instead — the spec.md §6 jsonc is the one actually
built. Resumable after a refresh — `currentIndex` and `state` reconstruct the room with no
client memory (§3.8). `persona`/`currentQuestion` are null until a round exists (I04);
`avatarState` is a fixed `'idle'` placeholder until I07 wires it to live SSE state; `widget`
is always null until I04/I06 build widget-kind questions.

## `@interviewly/ai` — the one seam

`AiClient` interface (I01, executed I02). Every method takes a context
`{ interviewId, traceId }`, binds a per-attempt timeout, records `llm_calls`, and returns a
Zod-validated value:

| Method | Returns | Prompt name | Timeout | Owner of use |
|---|---|---|---|---|
| `generateRoundQuestions({ round, count, ctx })` | `QuestionBatch` (length == count) | `interview.question.generate` | 15 s | I04 |
| `generateReport({ interview, ctx })` | `ReportPayload` | `interview.report.generate` | 90 s | I09 |
| `scoreAnswer({ question, answer, ctx })` | `Scores` | `interview.answer.score` | 15 s | interface I01; adaptive ledger |
| `generateCandidates({ slot, ctx })` | `Candidate[]` | `interview.question.candidates` | 15 s | interface I01; adaptive ledger |
| `detectLanguage(text, current)` | `{ language, ambiguous }` (**no** LLM, no `llm_calls`) | — | — | I10 |

`StubAiClient` (I01) returns canned schema-valid content for every method and is the §5.5
fake for every scenario not asserting the provider chain. It compiles its prompts through the
real `PromptBuilder` — `security.feature` @AC-5 only passes because generation crosses the
trust boundary, so a stub-mode shortcut past the builder would break it. It **does not** write
the `cost_usd = 0` `llm_calls` row: that needs Prisma, and `@interviewly/ai` is shared by
`api` and `worker` and depends on neither, so the row and the `AI_DISABLED_STUB_MODE` log
belong to **I02**'s `backend/modules/ai/index.ts`.

`PromptBuilder` (I01) is the prompt-injection boundary asserted **directly** by
`security.feature` (a stub would mask listing content).

Argument shapes follow the ai spec, not the older per-task sketches:
`generateRoundQuestions({ roundType, count, jobListing, candidateProfile, candidateCv,
language, priorTopics?, ctx })`. Payload schemas (`ReportPayload`, `Scores`) are **snake_case**
— they are stored verbatim in `reports.payload`/`answers.scores` and asserted key-by-key by
`schema_validation.feature`.

## Key code anchors

All paths relative to repo root. Each exists once its providing task lands.

| Path | Task | What it does |
|---|---|---|
| `backend/src/lib/error-codes.ts` | F01 | Error-code registry; append new codes here in a task step |
| `backend/src/lib/db.ts` | F02 | Prisma singleton, `userInterviews()`, `activeInterview()` — user-facing modules MUST use these |
| `backend/src/lib/logger.ts` | F03 | Pino factory: `logger.<level>({obj}, "EVENT_NAME")` |
| `backend/src/lib/env.ts` | F03 | Zod env config; extended by I15 |
| `backend/src/app.ts` | A01 | Express app + global middleware; interview-core mounts its router here |
| `backend/modules/auth/middleware.ts` | A01 | `requireAuth`: cookie → session row → `req.user` |
| `backend/modules/auth/rate-limit.ts` | A01 | Redis sliding-window limiter factory reused by I13 |
| `packages/ai/src/AiClient.ts` | I01 | The one seam interface (5 methods) |
| `packages/ai/src/schemas.ts` | I01 | Zod: `QuestionBatch`, `ReportPayload`, `Scores`, `Question`, `Candidate` |
| `packages/ai/src/prompt-builder.ts` | I01 | Role separation, neutralisation, truncation, injection detection |
| `packages/ai/src/registry.ts` | I01 | `*.prompt.yaml` loader keyed by `(name, version)` / `uuid` |
| `packages/ai/prompts/*.prompt.yaml` | I01 | Versioned prompt files |
| `packages/ai/config/model-prices.yaml` | I01 | `(provider, model) → price`; missing row → `cost_usd = null` |
| `packages/ai/config/injection-patterns.yaml` | I01 | Injection detection patterns (log-not-block) |
| `packages/ai/src/stub.ts` | I01 | `StubAiClient` canned content |
| `packages/ai/src/providers.ts` | I02 | openai→gemini fallback chain, per-attempt `llm_calls`, cost |
| `packages/ai/src/detect-language.ts` | I01 | en/tr heuristic, no LLM |
| `backend/modules/ai/index.ts` | I02 | api-side adapter binding `AiClient` into request context |
| `backend/modules/interview/router.ts` | I03 | Mounts setup, state, profile, answers, resume, SSE, uploads |
| `backend/modules/interview/ownership.ts` | I03 | Resolve `:id` for session user → `INTERVIEW_NOT_FOUND` |
| `backend/modules/interview/setup.ts` | I03 | `POST /interviews`: split, occupation heuristic |
| `backend/modules/interview/state.ts` | I03 | `GET /state`: room-state shape |
| `backend/modules/interview/csrf.ts` | I03 | Origin/Referer check (first asserted I05) |
| `backend/modules/interview/profile.ts` | I04 | `POST /profile\|skip` → `hr_round` |
| `backend/modules/interview/generation.ts` | I04 | HR + tech batch generation, row insertion |
| `backend/modules/interview/answers.ts` | I06 | `POST /answers`: guarded advance, duration, transcript |
| `backend/modules/interview/machine.ts` | I06 | K2 transition table + guard (extended I07) |
| `backend/modules/interview/resume.ts` | I07 | `POST /resume`: `paused → round` |
| `backend/modules/interview/sse.ts` | I07 | `INTERVIEW_STATE_CHANGED` SSE fan-out |
| `backend/modules/interview/budget.ts` | I08 | In-transaction ceiling read |
| `backend/modules/interview/report-run.ts` | I09 | `evaluating → completed\|failed`, store payload |
| `backend/modules/interview/language.ts` | I10 | Two-consecutive-turn switch counting |
| `backend/modules/interview/uploads.ts` | I11 | `POST /uploads`: validate, extract, dedup |
| `backend/src/lib/storage.ts` | I12 | Object-store wrapper: put/get/`signedUrl(key, ttl)` |
| `backend/modules/interview/download.ts` | I12 | Report signed-URL handout |
| `backend/modules/interview/rate-limit.ts` | I13 | Daily interview cap + interview-start limiter |
| `backend/src/lib/probes.ts` | I14 | `/healthz`, `/readyz` |

## Schema (tables this ledger reads/writes)

Owned by F02 — **no structural change here** (ADR-F02 / ADR-I / §10). This ledger reads and
writes these columns; see `MODELS.md` for the full column-level contract.

- `interviews` — `state`, `current_index`, `hr_question_count`, `target_question_count`,
  `occupation`, `occupation_cluster_id`, `candidate_profile` (Json), `language`, `job_text`,
  `job_source`, `upload_id`, `mode`, `budget_usd`/`spent_usd` (Decimal 12,6), `ended_reason`,
  `started_at`/`ended_at`/`deleted_at`.
- `interview_rounds` — `type` (hr|tech), `persona_id`, `status`, `score`.
- `questions` — `round_id`, `order_index`, `text`, `kind`, `difficulty`, `topic`,
  `candidates` (Json), `chosen_reason`, `asked_at`; `@@unique([round_id, order_index])`.
- `answers` — `question_id`, `transcript`, `input_mode`, `started_at`, `answered_at`,
  `duration_ms`, `scores` (Json).
- `reports` — `interview_id`, `status`, `payload` (Json), `pdf_key`, `prompt_uuid`,
  `prompt_version`.
- `llm_calls` — one row **per attempt, failed attempts included**: `provider`, `model`,
  `prompt_uuid`, `prompt_version`, `attempt_no`, `fell_back_from`, `units`, `unit_kind`
  (the db `UnitKind` enum verbatim — `token`, not `tokens`), `input_tokens`/`output_tokens`,
  `cost_usd` (Decimal 12,6, **NOT NULL today** — the spec wants null for a missing price row;
  see STATE.md → Open blockers and ADR-I20), `latency_ms`, `trace_id`. Written through
  `backend/modules/ai` → `writeLlmCall(record, tx?)`, never assembled at a call site.
- `uploads` — `storage_key`, `mime`, `size_bytes`, `sha256` (`@unique` → dedup).
- `chat_messages` — `role`, `content`, `trace_id` (one per answered turn).
- `occupation_clusters` — `key` (`@unique`), `label` (seeded reference table).
- `personas` — HR + tech personas seeded by F02.

## Conventions

**Error codes** are imported from `backend/src/lib/error-codes.ts`, never inlined. Codes
this ledger uses (add any missing one to the registry in a task step): `LISTING_REQUIRED`,
`VALIDATION_ERROR`, `DAILY_INTERVIEW_LIMIT`, `RATE_LIMITED`, `INTERVIEW_NOT_FOUND`,
`INVALID_STATE_TRANSITION`, `QUESTION_NOT_CURRENT`, `BUDGET_EXCEEDED`,
`CSRF_ORIGIN_MISMATCH`, `UPLOAD_TOO_LARGE`, `UNSUPPORTED_MEDIA_TYPE`,
`UPLOAD_TOO_MANY_PAGES`, `PDF_TEXT_TOO_SHORT`, `NOT_READY`, `ENV_VALIDATION_FAILED`,
`PROVIDER_KEY_MISSING`, `AI_OUTPUT_INVALID`, `AI_PROVIDER_UNAVAILABLE`,
`AI_PROMPT_BUILD_FAILED`.

**Log shape:** `logger.info({ traceId, interviewId }, "EVENT_NAME")` — structured object
first, event name second, never a display string. Events this ledger emits:
`INTERVIEW_STATE_CHANGED`, `HR_BATCH_REQUESTED`, `TECH_BATCH_REQUESTED`, `ANSWER_RECORDED`,
`LANGUAGE_SWITCHED`, `INTERVIEW_CUT_SHORT`, `BUDGET_EXHAUSTED`, `DAILY_LIMIT_HIT`,
`RATE_LIMIT_HIT`, `AI_DISABLED_STUB_MODE`, `REPORT_JOB_ENQUEUED`, `LLM_CALL_STARTED`,
`LLM_CALL_COMPLETED`, `LLM_FALLBACK_TRIGGERED`, `LISTING_TRUNCATED`,
`SECURITY_PROMPT_INJECTION_SUSPECTED`, `PRICE_MISSING`, `AI_OUTPUT_SCHEMA_INVALID`. Never
log a job listing body, transcript, provider key, or signed URL.

**Validation:** Zod at every trust boundary (request bodies, and every `AiClient` response
via the method's schema). A failing body is `VALIDATION_ERROR` (422); a failing AI response
triggers the fallback and, chain-exhausted, `AI_OUTPUT_INVALID`.

**Rate limiting:** Redis sliding windows via the auth `rate-limit.ts` factory (A01), keyed
by `user_id` for interview limits. Reuse the single Redis client from `env.ts`; do not open
a second connection.

**Ownership:** every `:id` route goes through `ownership.ts` → `userInterviews`/
`activeInterview` (soft-delete baked in). A non-owned or deleted id is `INTERVIEW_NOT_FOUND`.

**CSRF:** `csrf.ts` compares `Origin` (fallback `Referer`) to `config.PUBLIC_ORIGIN`; a
mismatch is `CSRF_ORIGIN_MISMATCH` before the handler runs. **Mounted once as
`router.use(requirePublicOrigin)` above `router.param` (I05, ADR-I24) — never add it to a
route.** It exempts `GET`/`HEAD`/`OPTIONS` itself, so SSE and `/report/download` are safe.

**AI calls:** always through `AiClient`; never import a provider SDK in a module directly.
Every attempt records an `llm_calls` row (stub mode too, `cost_usd = 0`). `cost_usd` is
frozen at return time from `model-prices.yaml`.

**Migration rule** (ADR-F02 / ADR-I): no structural schema change in this ledger. A new
index or nullable column is a new Prisma migration file rebased on top of the F02 migration
before merge. Never edit an existing migration SQL file. Any structural change is a change
to F02's scope and is discussed, not merged.
