# Interview-core — State

Last updated: 2026-07-30
Last session ended: **—** Ledger written; no task has started yet.

## Execution protocol (follow exactly)

Read this file → read `REFERENCE.md` once → read only the current task's file →
check `MODELS.md` for the recommended model → do the work, ticking checkboxes →
run the task's `## Verification` command verbatim → fill in the task's `## Notes` →
update this file's ledger row, "Current task" pointer, and "Last session ended" line →
commit as `{ID}: <title>` → **STOP. Do not roll into the next task.**

## Current task

**I01 — `@interviewly/ai` scaffold** is the first `todo` task. It depends on foundations
F01, F02, F03 being `done` (see Cross-ledger section). Do not start I01 until all three
foundations tasks are green. Once they are, read I01's file, confirm the `packages/ai/`
entry F03 wired is empty (no prior partial work), and begin.

## Environment

Foundations (`F01`, `F02`, `F03`) and auth `A01` must be `done` before the tasks that
depend on them start (per-task `Depends on` below):

- **F01** provides `backend/src/lib/error-codes.ts` and `@interviewly/types`.
- **F02** provides `backend/prisma/schema.prisma` (all 14 tables/15 enums) and
  `backend/src/lib/db.ts` (`prisma`, `userInterviews`, `activeInterview`).
- **F03** provides `backend/src/lib/logger.ts`, `backend/src/lib/env.ts`, `compose.yaml`
  (Postgres + Redis), CI acceptance-runner wiring, and the empty `packages/ai/` workspace
  entry this ledger fills.
- **A01** provides `requireAuth`, `backend/src/app.ts` (router mount point), the global
  error handler + traceId middleware, and the Redis rate-limit factory I13 reuses.

Set up the environment once foundations land:

```bash
docker compose up -d db cache
cd backend && npm install && npx prisma migrate deploy && npm run seed
npm run -w @interviewly/ai build      # after I01
```

Confirm the Cucumber acceptance runner is wired (F03/CI step) before running any
Verification command.

## Open blockers / decisions for the user

None at ledger-write time.

## Task ledger (I01–I15)

Statuses: todo → in_progress → done → (blocked if waiting on user).
`Repo`: blank = this repo. Dependency-sorted.

| ID | Title | Repo | Status | Depends on |
|----|-------|------|--------|------------|
| I01 | `@interviewly/ai` scaffold: `AiClient` seam, schemas, prompt registry, `PromptBuilder`, `StubAiClient` | | todo | F01, F02, F03 |
| I02 | Provider execution: fallback chain, per-attempt `llm_calls`, cost, stub mode, key validation | | todo | I01 |
| I03 | Interview setup, room-state read, ownership resolver, CSRF middleware | | todo | F01, F02, F03, A01 |
| I04 | Profiling + round question generation (HR batch, tech batch during HR) | | todo | I02, I03 |
| I05 | CSRF/origin enforcement on state-changing routes | | todo | I04 |
| I06 | Answer submission, guarded advance, duration, round handover, resume | | todo | I04 |
| I07 | State machine transition table + pause/resume + SSE state events | | todo | I06, I02 |
| I08 | Budget enforcement (in-transaction ceiling, exhaustion path) | | todo | I06, I02 |
| I09 | Report generation + `ReportPayload` schema gate + completion | | todo | I07, I02 |
| I10 | Language detection + two-consecutive-turn switch counting | | todo | I06 |
| I11 | Upload validation (MIME/magic/size/pages/text) + `sha256` dedup | | todo | A01, F02 |
| I12 | Object-storage signed-URL wrapper + report download endpoint | | todo | I03 |
| I13 | Rate limits: daily interview cap + interview-start limiter | | todo | I03, A01 |
| I14 | Reliability probes: `/healthz`, `/readyz` | | todo | F02, F03 |
| I15 | Config: extend env schema with this ledger's keys, fail-fast | | todo | F03 |

## Critical path

F01/F02/F03 → **I01 → I02 → I04 → I06 → I07 → I09** (the setup→generate→answer→
state-machine→report spine). Branches off the spine: I05 and I10 off I04/I06; I08 off
I06/I02. Independent of the spine (parallelisable once their deps are green): I03 (setup,
also gates I04/I12/I13), I11, I14, I15. I12 and I13 depend on I03.

## Cross-ledger dependencies (blocks this ledger)

| Ledger task | Provides | Needed by |
|---|---|---|
| F01 | `error-codes.ts` registry (LISTING_REQUIRED, DAILY_INTERVIEW_LIMIT, INTERVIEW_NOT_FOUND, INVALID_STATE_TRANSITION, QUESTION_NOT_CURRENT, BUDGET_EXCEEDED, CSRF_ORIGIN_MISMATCH, UPLOAD_*, PDF_TEXT_TOO_SHORT, NOT_READY, ENV_VALIDATION_FAILED, PROVIDER_KEY_MISSING, AI_OUTPUT_INVALID, AI_PROVIDER_UNAVAILABLE, AI_PROMPT_BUILD_FAILED, VALIDATION_ERROR, RATE_LIMITED), `@interviewly/types` | I01–I15 |
| F02 | `schema.prisma` (interviews, interview_rounds, questions, answers, reports, report_questions, uploads, chat_messages, llm_calls, occupation_clusters, personas); `db.ts` (`userInterviews`, `activeInterview`) | I03–I14 |
| F03 | `logger.ts`, `env.ts`, `compose.yaml` (Postgres + Redis), CI acceptance runner, empty `packages/ai/` workspace entry | I01–I15 |
| A01 | `requireAuth`, `app.ts` router mount, error handler + traceId, Redis rate-limit factory | I03, I11, I13 |

**No interview-core task may be merged until its `Depends on` (including the foundations/
auth tasks above) are green.** A partial state — e.g. F02 done but F03's `packages/ai/`
entry not wired — means I01 has nowhere to publish the `@interviewly/ai` package.

## Cross-ledger dependencies (this ledger blocks — waiting ledgers cite these task IDs)

| This task | Provides | Consumed by ledger |
|---|---|---|
| I01 | `@interviewly/ai` package: `AiClient` interface, schemas, `PromptBuilder`, `StubAiClient` | report, voice, adaptive, worker |
| I02 | Real provider execution + per-attempt `llm_calls` + cost | report (report job), admin (cost dashboard reads) |
| I06 | Answer + `chat_messages` transcript writer (`POST /answers`) | report (transcript → report input), voice (voice-turn answers) |
| I07 | `evaluating` transition + SSE `INTERVIEW_STATE_CHANGED` + report enqueue hook | report (BullMQ job execution, PDF render), voice |
| I09 | `AiClient.generateReport` + `evaluating→completed\|failed` schema gate | report (runs the real job on this path, adds PDF) |
| I01 | `AiClient.scoreAnswer` + `generateCandidates` interface + stub | adaptive (B5 selection table, `adaptive_questions.feature`) |
| I12 | `storage.ts` signed-URL wrapper | report (signs the rendered PDF key), infra (configures the real bucket) |

## Backlog (deferred, unnumbered — promote to a task when its trigger fires)

- **K4 adaptive selection (B5 difficulty/topic table)** — I01 exposes
  `AiClient.scoreAnswer`/`generateCandidates` + I09-style scoring hook; the selection logic
  and `adaptive_questions.feature` green run belong to the `adaptive` ledger. Promote there,
  not here.
- **Report job execution + PDF rendering + `report.feature` (AC-20) green run** — I07/I09
  build the `evaluating→completed|failed` transition, the enqueue hook and the SSE mechanism;
  the real BullMQ job, PDF render and end-to-end report serving are the `report` ledger.
- **24 h `abandoned` sweeper** — no interview-core scenario drives it; `worker` ledger owns
  the cron sweep that moves stale `paused`/`hr_round` interviews to `abandoned`.
- **`llm_calls(interview_id, created_at)` cost-aggregation index** — the admin cost
  dashboard may want it; F02 has `@@index([interview_id])` already. Promote as a safe
  additive migration when the admin aggregation query is specced.
- **Same-tier retry before fall-through** — the MVP treats the two-tier chain as the whole
  retry (ADR-I04). Promote a same-tier retry only if provider flakiness data shows tier-2
  fall-through is over-triggering.
