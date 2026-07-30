# Stage 2 coverage record

Maps every numbered acceptance criterion in each `.agents/specs/2026-07-29-<area>.md`
to the `feature-file::scenario` that covers it, the scenario it was **folded** into, or
an explicit **out-of-ring** classification with a one-line reason.

The acceptance ring is Cucumber against the HTTP API with a live Postgres/Redis and a
stubbed AI module (IDEA.md §5.3). Anything only observable in a browser, in the compose
topology, in a migration run, in CI, or on real hardware is **out of the acceptance ring**.

## backend — all 20 in-ring

| AC | Covered by |
|---|---|
| 1 | `auth.feature::Password registration creates only valid accounts` |
| 2 | `auth.feature::Email uniqueness is case-insensitive` |
| 3 | `auth.feature::Password login issues a session only for valid credentials` |
| 4 | `admin_auth.feature::Admin accounts can sign in only with password` |
| 5 | `auth.feature::Google links password accounts only with verified email` |
| 6 | `question_generation.feature::Interview setup fixes the HR and technical split` |
| 7 | `question_generation.feature::HR generation inserts only the first round` |
| 8 | `interview_flow.feature::An answer cannot target a non-current question` |
| 9 | `interview_flow.feature::State fetch resumes at the next unanswered question` |
| 10 | `interview_flow.feature::Answer duration is computed on the server clock` |
| 11 | `interview_flow.feature::Budget exhaustion preserves the triggering answer without an AI call` |
| 12 | `rate_limits.feature::The sixth interview within twenty-four hours is rejected` |
| 13 | `rate_limits.feature::Per-action rate limits reject only requests beyond the window` |
| 14 | `upload.feature::Only valid PDF uploads create upload handles` |
| 15 | `interview_flow.feature::State-changing requests require the public origin` |
| 16 | `interview_flow.feature::The state machine accepts only listed HTTP transitions` |
| 17 | `admin_cost.feature::Deleted interviews disappear for users and remain auditable for admins` |
| 18 | `admin_cost.feature::Admin interview and stats endpoints require admin role` |
| 19 | `reliability.feature::Probes report live process and ready dependencies` + `::Readiness fails when a dependency is unreachable` |
| 20 | `report.feature::Entering evaluation nudges clients and exposes the ready report once` |

## ai — all 13 in-ring

| AC | Covered by |
|---|---|
| 1 | `question_generation.feature::A generated round returns exactly the requested count of typed questions` |
| 2 | `profiling.feature::A skipped profile compiles to the explicit no-profile marker` |
| 3 | `security.feature::Angle brackets in the listing are neutralised and the system prompt is untouched` |
| 4 | `security.feature::A job listing is hard-truncated to 12000 characters` |
| 5 | `security.feature::A listing matching an injection pattern is logged but still generates questions` |
| 6 | `ai_provider.feature::A failed tier-1 attempt falls through to tier-2 and records both attempts` + `::A succeeding tier-1 call records a single attempt with no fallback` |
| 7 | `ai_provider.feature::Per-attempt cost is computed when the model has a price and null when it does not` |
| 8 | `ai_provider.feature::Per-attempt cost is computed when the model has a price and null when it does not` |
| 9 | `ai_provider.feature::With AI disabled the client returns canned schema-valid content at zero cost` |
| 10 | `ai_provider.feature::Startup validates provider keys only when AI is enabled` |
| 11 | `schema_validation.feature::A malformed report never reaches the caller` |
| 12 | `adaptive_questions.feature::The answer score drives the next question's difficulty and topic` + `::A malformed answer score never selects a graded next question` |
| 13 | `language_detection.feature::Language classification runs without an LLM call` + `::A below-margin turn does not advance a language switch` |

## db — 2 in-ring, 4 folded, 6 out-of-ring

| AC | Classification |
|---|---|
| 1 | **out-of-ring** — `prisma migrate deploy` creates 14 tables + enums; migration verification (infra F02 / migrate-check), not HTTP-driven |
| 2 | **out-of-ring** — enum rejects out-of-set literal at the DB level; DB-constraint verification in migration ring |
| 3 | in-ring: `upload.feature::A byte-identical PDF reuses the stored upload instead of duplicating it` (sha256 dedup); email_lower uniqueness folded into `auth.feature::Email uniqueness is case-insensitive` |
| 4 | **out-of-ring** — `budget_usd`/`spent_usd` defaults and six-decimal precision; schema-default verification in migration ring |
| 5 | **out-of-ring** — §8.1 indexes exist and `questions(round_id, order_index)` UNIQUE; migration verification (ordering indirectly exercised by `question_generation.feature`) |
| 6 | folded into `admin_cost.feature::Deleted interviews disappear for users and remain auditable for admins` — `userInterviews` helper excludes soft-deleted rows |
| 7 | folded into `interview_flow.feature::An answer cannot target a non-current question` — guarded `current_index` update (count 0 → `QUESTION_NOT_CURRENT`, count 1 otherwise) |
| 8 | folded into `voice_reconciliation.feature::The post-call webhook records elevenlabs seconds and reconciles spent_usd in one transaction` and `interview_flow.feature::Budget exhaustion…` — atomic `spent_usd` + `llm_calls` transaction |
| 9 | **out-of-ring** — every interview-scoped table resolves to one `interviews.id` with K6 log columns; schema-structural verification in migration ring |
| 10 | **out-of-ring** — `prisma/seed.ts` produces admin user, occupation_clusters, personas, sample interview; seed verification (also `infra` AC-1) |
| 11 | **out-of-ring** — all FKs `ON DELETE RESTRICT`, no cascade; migration/constraint verification |
| 12 | folded into `admin_cost.feature::Admin interview and stats endpoints require admin role` — lowest-scoring `report_questions` (weakestQuestions) is a plain relational query |

## infra — 2 in-ring, 10 out-of-ring

| AC | Classification |
|---|---|
| 1 | **out-of-ring** — `docker compose up` brings all services healthy + seeded app; compose/e2e verification, not HTTP acceptance ring |
| 2 | **out-of-ring** — only `edge` publishes a host port; `docker compose port` topology verification |
| 3 | **out-of-ring** — `migrate` exits 0 before `api`/`worker`; compose ordering verification |
| 4 | **out-of-ring** — `observability`/`dev` profiles gate elasticsearch/kibana/tunnel; compose-profile verification |
| 5 | in-ring: `config.feature::A missing required env var fails startup fast and a valid one serves` + `::Each missing or malformed required key is named at boot` |
| 6 | in-ring: `object_storage.feature::A private report is handed out only as a short-lived signed URL scoped to its owner` + `::A signed URL reads the private object until its TTL expires and then is refused` |
| 7 | **out-of-ring** — edge CSP + security headers; Caddyfile/edge header verification via curl, not API acceptance ring |
| 8 | **out-of-ring** — every image uses repo-root build context; build/compose verification |
| 9 | **out-of-ring** — structured JSON logs, no secrets; log/observability verification (redaction partially exercised in-ring by `voice_webhook.feature` AC-10 via the LogSink seam) |
| 10 | **out-of-ring** — CI pipeline (lint→typecheck→build→migrate-check→Cucumber) and bad-migration gate; CI verification |
| 11 | **out-of-ring** — one image across environments, no `NODE_ENV`-branched business logic; CI/static verification |
| 12 | **out-of-ring** — `.env.example` committed with every validated key; repo/CI verification |

## voice — 8 in-ring, 2 out-of-ring

| AC | Classification |
|---|---|
| 1 | `voice_session.feature::The mint binds expires_at to the tighter of the round and interview ceiling` |
| 2 | `voice_session.feature::A mint is refused unless the owner targets a voice-capable interview with voice enabled` + `::A voice-capable owner mint succeeds when voice is enabled` |
| 3 | `voice_webhook.feature::A webhook failing signature or freshness is rejected and mutates nothing` |
| 4 | `voice_webhook.feature::A webhook whose nonce matches no unexpired row is rejected as an invalid session` + `::A webhook arriving after the ceiling ends the interview time_exhausted` |
| 5 | `voice_webhook.feature::A valid submit_answer persists a voice answer and advances the clock` |
| 6 | `voice_fallback.feature::A fatal voice error downgrades the interview to text and preserves progress` + `::A healthy voice session stays in voice mode` |
| 7 | `voice_reconciliation.feature::The post-call webhook records elevenlabs seconds and reconciles spent_usd in one transaction` |
| 8 | **out-of-ring** — self-camera tile + `getUserMedia` local binding; browser/hardware, not curl-observable |
| 9 | **out-of-ring** — built voice room opens exactly one cross-origin `wssOrigin` connection; browser/edge-CSP observable only |
| 10 | `voice_webhook.feature::Voice webhook log lines carry the interviewId but never a session secret or transcript` (asserted via the `LogSink` seam) |

## frontend — all 14 out-of-ring (non-acceptance-ring by spec header)

The `frontend` spec's Acceptance-criteria header states Cucumber drives the HTTP API, not a
browser: all 14 criteria are verified at the **component/integration ring** (React Testing
Library over a mocked API + `EventSource`) or as **Playwright smokes**. Server-reducible
criteria already live in `backend`/`ai` and are not duplicated. No Gherkin scenarios.

## ui — all 12 out-of-ring (non-acceptance-ring by spec header)

The `ui` spec's Acceptance-criteria header states these are verified as **build/seed checks**
(token lint, computed AA-contrast assertion, avatar-set validation) and **component/visual
smokes**, not acceptance-ring Gherkin. No Gherkin scenarios.
