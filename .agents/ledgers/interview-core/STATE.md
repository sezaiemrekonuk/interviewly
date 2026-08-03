# Interview-core — State

Last updated: 2026-08-03
Last session ended: **I08 done, uncommitted** (I07 is merged; the previous line's "uncommitted"
was stale).
New `budget.ts` — `withBudget(id, fn)`, gate mounted around `ensureTechBatch` in `answers.ts`.
`applyTransition` now writes `ctx.endedReason` with the state. **ADR-I33:** the gate is
`pg_advisory_xact_lock`, **not** the row lock + shared transaction the task file specified —
that shape deadlocks against `generateRound`'s FK inserts and rolls back the `llm_calls` rows
of a paid-then-failed attempt. `@AC-11` green (its `@unwired` is gone); rings 33/33 + 11/11,
97 unit, lint + typecheck clean. Details in I08 `## Notes`.

## Execution protocol (follow exactly)

Do not start from this file. `.agents/EXECUTE.md` is the prompt, and its § 4 decides which
task is yours — not the "Current task" pointer below, which is a human-readable summary and
can lag.

Read this file → read `REFERENCE.md` once → read only the task § 4 gave you →
check `MODELS.md` for the required tier and stop if it is not yours → do the work, ticking
checkboxes → run the task's `## Verification` command verbatim → fill in the task's
`## Notes` → update this file's ledger row, "Current task" pointer, and "Last session ended"
line → write `.agents/devlogs/{ID}-<slug>.md` (EXECUTE.md § Devlog) → **do not commit** →
re-apply EXECUTE.md § 4 and continue with what it gives you.

## Current task

**I09 (report generation) or I10 (language switch).** I08 is done; `I09 <- I07, I02` and
`I10 <- I06` are both eligible, and I09 comes first by ID order.

Live hand-offs, from I08 `## Notes` → "For I09":

- The budget-exhaustion path already lands in `evaluating` with `ended_reason =
  'budget_exhausted'` set and `REPORT_JOB_ENQUEUED` emitted. Generate the report from the
  answers that exist and do **not** overwrite `ended_reason` on that path.
- An SSE-pushed question must stamp `questions.asked_at` itself (ADR-I27), or its
  `duration_ms` is null.
- Advisory-lock namespace `8108` belongs to the budget gate (ADR-I33). Pick another.

Running the acceptance suite locally needs `DATABASE_URL`/`REDIS_URL` pointed at the published
host ports rather than `.env`'s compose hostnames — see I04's `## Notes` → Verification output.

## Spec revision of 2026-07-30 — what changed for this ledger

Three edits, all inside existing tasks; no task was added or renumbered.

- **I03** gains the single `EMAIL_VERIFICATION_REQUIRED` gate on `POST /interviews`
  (`EMAIL_NOT_VERIFIED`, K8.6) and an explicit *do not* — room-state keeps one `persona` field
  describing the **active** speaker; the two-tile room resolves the other from the rounds it already
  has (§3.2).
- **I04** now owns the `candidate_profile` **merge and snapshot**: `{ account: users.profile minus
  dateOfBirth, cvText?, perInterview }`, and passes `candidateCv` to `AiClient` as its own argument
  (§3.3). Auth **A06** supplies `users.profile`; if A06 has not landed, the merge degrades to
  `{ perInterview }` and still works.
- **I11** accepts a required `kind ∈ {listing, cv}` on `POST /uploads` (§3.3, K12); **I09** passes
  the snapshot's `cvText` into report generation (K15).

The Jotform-shaped setup screen (§4.3 screen 9) is `frontend`'s composition, not a new task here —
this ledger owns the endpoints it calls, which are unchanged apart from the above.

## Environment

Foundations (`F01`, `F02`, `F03`) and auth `A01` must be `done` before the tasks that
depend on them start (per-task `Depends on` below):

- **F01** provides `backend/src/lib/error-codes.ts` and `@interviewly/types`.
- **F02** provides `backend/prisma/schema.prisma` (all 15 tables/18 enums) and
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

**`llm_calls.cost_usd` must become nullable — F02 scope, owner Fatih.** ai spec §9.2 and
`ai_provider.feature` @AC-8 require a call whose model is absent from `model-prices.yaml` to
record `cost_usd = null` (price unknown), which is a different fact from `0` (free). F02's
`schema.prisma` declares `cost_usd Decimal @db.Decimal(12,6)`, NOT NULL. Widening it to
`Decimal?` is a column-type change, which the migration protocol puts in F02's scope, not a
feature ledger's.

- **Needed:** `cost_usd Decimal? @db.Decimal(12,6)` plus its migration, and
  `recordLlmCall`'s `spent_usd: { increment: … }` guarded against null.
- **Interim (shipped in I02, ADR-I20):** the package contract is `number | null` and the
  acceptance suite asserts it; `backend/modules/ai/index.ts` → `writeLlmCall` stores
  `costUsd ?? 0`. `PRICE_MISSING` is logged at the same moment, so no unpriced call is
  silent, and every model the repo ships today has a price row — the path is currently
  unreachable in practice.
- **Unblocks:** nothing today. It is a fidelity fix for the admin cost dashboard (N01/N02)
  and the report cost lines, not a gate on any interview-core task.

I02 is `done` on this basis rather than `blocked`: none of its five deliverables depend on
the widening, and the chain is verified to never invent a price.

## Task ledger (I01–I15)

Statuses: todo → in_progress → done → (blocked if waiting on user).
`Repo`: blank = this repo. Dependency-sorted.

| ID | Title | Repo | Status | Depends on |
|----|-------|------|--------|------------|
| I01 | `@interviewly/ai` scaffold: `AiClient` seam, schemas, prompt registry, `PromptBuilder`, `StubAiClient` | | done | F01, F02, F03 |
| I02 | Provider execution: fallback chain, per-attempt `llm_calls`, cost, stub mode, key validation | | done | I01 |
| I03 | Interview setup, room-state read, ownership resolver, CSRF middleware | | done | F01, F02, F03, A01 |
| I04 | Profiling + round question generation (HR batch, tech batch during HR) | | done | I02, I03 |
| I05 | CSRF/origin enforcement on state-changing routes | | done | I04 |
| I06 | Answer submission, guarded advance, duration, round handover, resume | | done | I04 |
| I07 | State machine transition table + pause/resume + SSE state events | | done | I06, I02 |
| I08 | Budget enforcement (in-transaction ceiling, exhaustion path) | | done | I06, I02 |
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

- **`backend/tsconfig.json` does not exist** — `backend/package.json` has
  `"build": "tsc -p tsconfig.json"` and there is no such file, so `npm run -w backend build`
  fails and root `npm run build` fails with it. Nothing in CI runs either today (`build` is
  `docker compose build`), which is why it has stayed hidden. Found during I01, out of I01's
  scope; it belongs to whichever task first needs a compiled backend. **Foundations, not
  interview-core** — flag it to Ahmet/Fatih rather than fixing it in a feature PR.
- **~~Docker images fail `tsc` on `Cannot find module 'zod'`~~ — fixed in I04, foundations scope.**
  Workspaces pin different zod versions, so npm nested it at `backend/node_modules/zod` instead of
  hoisting, and the build stage copied only `/app/node_modules`. Fixed in `backend/`, `worker/`
  and `frontend/Dockerfile`: deps stage copies every workspace manifest, build stage does
  `COPY --from=deps /app ./`. `docker compose build` is green and CI `build` is blocking again.
  Pre-existing (red on master since before I03; `ebb0ba1` "fix(ci): skip worker" only touched
  `acceptance`). **Landed in an interview-core PR at the owner's direction — F03 territory, so
  tell Ahmet/Fatih it moved.**

- **Entity-split on truncation** — `PromptBuilder` cuts at exactly 12 000 characters after
  neutralisation, which can leave a trailing `&lt;` chopped to `&l`. No bracket is
  reconstructed and no security property is lost, so this is cosmetic; marked with a
  `ponytail:` comment in `prompt-builder.ts`. Promote only if a model visibly trips on it.
- **Same-uuid prompt versions are untested against a real second version** — the registry
  rule (one uuid, one lineage; latest version wins) has unit coverage but every shipped
  prompt is `version: 1`. First real prompt revision should confirm the resolve path.

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

- **`elevenlabs/conversational` is priced per minute but its `unit_kind` is `second`** —
  I02 aligned `model-prices.yaml`'s `unit_kind` values with the db `UnitKind` enum
  (`token | second | character`), and the enum has no minute. The row keeps `per_minute_usd`;
  whoever meters voice divides by 60 when it records `units` in seconds. **Voice ledger**,
  flag to Fatih — no LLM path reads that row today.

- **No provider response shape is verified against a live API.** Both transports are
  hand-typed (ADR-I18) and every test fakes at `ProviderTransport`. A real one-off call
  against each provider before the demo would catch a field rename that the acceptance suite
  structurally cannot. Promote when a real `OPENAI_API_KEY` is in the team `.env`.
