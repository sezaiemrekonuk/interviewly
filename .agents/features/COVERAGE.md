# Stage 2 coverage record

Maps every numbered acceptance criterion in each `.agents/specs/2026-07-29-<area>.md`
to the `feature-file::scenario` that covers it, the scenario it was **folded** into, or
an explicit **out-of-ring** classification with a one-line reason.

The acceptance ring is Cucumber against the HTTP API with a live Postgres/Redis and a
stubbed AI module (IDEA.md §5.3). Anything only observable in a browser, in the compose
topology, in a migration run, in CI, or on real hardware is **out of the acceptance ring**.

**Revised 2026-07-30** for the K8.6 (verification/reset), K8.7/§3.3 (onboarding profile, CV) and
§4.2.1 (mascot) additions. New criteria are appended to each spec's list, never renumbered.

## backend — all 35 in-ring

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
| 21 | `email_verification.feature::Registration sends exactly one verification mail without waiting on SMTP` |
| 22 | `email_verification.feature::A verification token works once and is never replayable` + `::An expired verification token is refused and distinguishable from an unknown one` + `::Google sign-in with a verified email marks our account verified` |
| 23 | `email_verification.feature::Two concurrent confirmations of one token yield exactly one success` |
| 24 | `email_verification.feature::Resending is cooldown-limited and then rate-limited` |
| 25 | `password_reset.feature::A reset request never reveals whether an account exists` |
| 26 | `password_reset.feature::Completing a reset revokes every existing session` + `::A rejected password leaves the reset token usable` + `::A reset token is single-use and expires in an hour` |
| 27 | `password_reset.feature::A Google-only account sets its first password through reset` |
| 28 | `email_verification.feature::Registration sends exactly one verification mail…` (no token in logs) + `password_reset.feature::Reset log lines carry the user but never the token` |
| 29 | `email_verification.feature::The verification gate applies to interview start only, and only when required` + `::With the gate off an unverified account can interview` |
| 30 | `onboarding_profile.feature::Each card saves independently and later cards do not erase earlier ones` + `::Education rows are capped at five` |
| 31 | `onboarding_profile.feature::An abandoned flow resumes from the server profile` + `::Skipping completes onboarding with a partial profile and no error` |
| 32 | `onboarding_profile.feature::A CV upload is retained privately and its text is cached on the profile` + `::An oversized CV is truncated rather than rejected` |
| 33 | `onboarding_profile.feature::The interview profile is a merged snapshot without the date of birth` |
| 34 | `onboarding_profile.feature::Editing the account profile does not rewrite an existing interview snapshot` |
| 35 | `onboarding_profile.feature::The routing inputs come from one server answer` (the "no URL-fetch endpoint exists" half is a static/API-surface check, out of ring) |

Also extended: `upload.feature::The upload kind is required and closed` covers the `kind`
validation added to AC-14, and `rate_limits.feature` gains no new scenario — the verification and
reset limits are asserted inside their own feature files, next to the flows they protect.

## ai — all 13 in-ring (+4 appended)

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
| 2 (extended) | `profiling.feature::A missing CV compiles to the explicit no-cv marker` |
| 3a | `security.feature::A CV is treated exactly like a listing, not as instructions` |
| 3b | `profiling.feature::A date of birth is stripped before any prompt is compiled` |
| 4a | `profiling.feature::The CV reaches report generation as data` + `security.feature::A candidate cv is hard-truncated to 12000 characters` |

## db — 2 in-ring, 4 folded, 6 out-of-ring (+5 appended)

| AC | Classification |
|---|---|
| 1 | **out-of-ring** — `prisma migrate deploy` creates 15 tables + enums; migration verification (infra F02 / migrate-check), not HTTP-driven |
| 2 | **out-of-ring** — enum rejects out-of-set literal at the DB level; DB-constraint verification in migration ring |
| 3 | in-ring: `upload.feature::A byte-identical PDF reuses the stored upload instead of duplicating it` (sha256 dedup); email_lower uniqueness folded into `auth.feature::Email uniqueness is case-insensitive` |
| 4 | **out-of-ring** — `budget_usd`/`spent_usd` defaults and six-decimal precision; schema-default verification in migration ring |
| 5 | **out-of-ring** — §8.1 indexes exist and `questions(round_id, order_index)` UNIQUE; migration verification (ordering indirectly exercised by `question_generation.feature`) |
| 6 | folded into `admin_cost.feature::Deleted interviews disappear for users and remain auditable for admins` — `userInterviews` helper excludes soft-deleted rows |
| 7 | folded into `interview_flow.feature::An answer cannot target a non-current question` — guarded `current_index` update (count 0 → `QUESTION_NOT_CURRENT`, count 1 otherwise) |
| 8 | folded into `speech_turn.feature` @AC-5 and `interview_flow.feature::Budget exhaustion…` — atomic `spent_usd` + `llm_calls` transaction |
| 9 | **out-of-ring** — every interview-scoped table resolves to one `interviews.id` with K6 log columns; schema-structural verification in migration ring |
| 10 | **out-of-ring** — `prisma/seed.ts` produces admin user, occupation_clusters, personas, sample interview; seed verification (also `infra` AC-1) |
| 11 | **out-of-ring** — all FKs `ON DELETE RESTRICT`, no cascade; migration/constraint verification |
| 12 | folded into `admin_cost.feature::Admin interview and stats endpoints require admin role` — lowest-scoring `report_questions` (weakestQuestions) is a plain relational query |
| 13 | folded into `email_verification.feature::A verification token works once and is never replayable` + `::Two concurrent confirmations of one token yield exactly one success` — UNIQUE `token_hash`, guarded consume, row retained |
| 14 | folded into `password_reset.feature::Completing a reset revokes every existing session` — the password rewrite and the session revocation are one transaction |
| 15 | folded into `onboarding_profile.feature::Each card saves independently…` and `::A CV upload is retained privately…` — partial `users.profile` merge and the `cv` upload pointer |
| 16 | **out-of-ring** — `email_tokens(user_id, kind)` / `uploads(user_id, kind)` indexes and the `MascotPose`/`UploadKind` enum constraints; migration verification |
| 17 | **out-of-ring** — seed produces the mascot set, the sample listing and a pre-verified admin; seed verification (also `infra` AC-1) |

## infra — 2 in-ring, 10 out-of-ring (+1 appended)

| AC | Classification |
|---|---|
| 1 | **out-of-ring** — `docker compose up` brings all services healthy + seeded app; compose/e2e verification, not HTTP acceptance ring |
| 2 | **out-of-ring** — only `edge` publishes a host port; `docker compose port` topology verification |
| 3 | **out-of-ring** — `migrate` exits 0 before `api`/`worker`; compose ordering verification |
| 4 | **out-of-ring** — `observability`/`dev` profiles gate elasticsearch/kibana; compose-profile verification (S05 deleted the `tunnel` service) |
| 5 | in-ring: `config.feature::A missing required env var fails startup fast and a valid one serves` + `::Each missing or malformed required key is named at boot` |
| 6 | in-ring: `object_storage.feature::A private report is handed out only as a short-lived signed URL scoped to its owner` + `::A signed URL reads the private object until its TTL expires and then is refused` |
| 7 | **out-of-ring** — edge CSP + security headers; Caddyfile/edge header verification via curl, not API acceptance ring |
| 8 | **out-of-ring** — every image uses repo-root build context; build/compose verification |
| 9 | **out-of-ring** — structured JSON logs, no secrets; log/observability verification |
| 10 | **out-of-ring** — CI pipeline (lint→typecheck→build→migrate-check→Cucumber) and bad-migration gate; CI verification |
| 11 | **out-of-ring** — one image across environments, no `NODE_ENV`-branched business logic; CI/static verification |
| 12 | **out-of-ring** — `.env.example` committed with every validated key; repo/CI verification |
| 6a | **out-of-ring** — a registration lands one mail in the `mail` sink and stopping `mail` retries the job without failing the request; compose/queue verification (the enqueue half is in-ring via `email_verification.feature` AC-21) |

## voice — 1 in-ring, 12 superseded or out-of-ring

**Superseded by speech (ADR-S01/S03/S04/S05).** S05 deleted `voice_session.feature`,
`voice_webhook.feature` and `voice_reconciliation.feature` with the mint, the four webhook
gates and the reconciliation job they asserted. Those AC rows are retired, not regressed: the
architecture they describe no longer exists. `voice_fallback.feature` was renamed
`speech_fallback.feature` — the downgrade invariant survived the architecture change.

| AC | Classification |
|---|---|
| 1 | **retired** — the mint is gone (ADR-S01); the ceiling it bound `expires_at` to is now re-checked on every TTS/STT call, covered by `speech_turn.feature` @AC-6 |
| 2 | **retired** — no mint to refuse |
| 3 | **retired** — no webhook to sign (ADR-S03) |
| 4 | **retired** — no nonce; the ceiling half is `speech_turn.feature` @AC-6 |
| 5 | **retired** — answers arrive over `POST /interviews/:id/answers/audio`, covered by `speech_turn.feature` @AC-3 |
| 6 | `speech_fallback.feature::A fatal speech error downgrades the interview to text and preserves progress` + `::A healthy speech call stays in voice mode` |
| 7 | **retired** — reconciliation replaced by per-call metering (ADR-S04), covered by `speech_turn.feature` @AC-5 |
| 8 | **out-of-ring** — self-camera tile + `getUserMedia` local binding; browser/hardware, not curl-observable |
| 9 | **retired** — there is no `wssOrigin` and no WebSocket; the CSP stays `connect-src 'self'` |
| 10 | **retired** — no webhook log lines; the no-secrets/no-transcript rule is the speech spec's K6 |
| 11 | **out-of-ring** — pre-join precedes the room and a denied mic downgrades to text; the device denial is browser-only. The downgrade itself is covered by `speech_fallback.feature` |
| 12 | **out-of-ring** — one active speaker per round drives ring/waveform; browser-observable only (the underlying one-live-question guarantee is `interview_flow.feature`) |
| 13 | **out-of-ring** — no `REC` indicator and no recording artifact exists; DOM/static verification |

## frontend — all 26 out-of-ring (non-acceptance-ring by spec header)

The `frontend` spec's Acceptance-criteria header states Cucumber drives the HTTP API, not a
browser: all 26 criteria (14 original + 15–26 for first-run routing, onboarding, the auth family,
the setup screen, the room panel, pre-join, mobile and mascot placement) are verified at the
**component/integration ring** (React Testing Library over a mocked API + `EventSource`) or as
**Playwright smokes**. Server-reducible criteria already live in `backend`/`ai` — the profile,
verification, reset and snapshot behaviours are covered by `onboarding_profile.feature`,
`email_verification.feature` and `password_reset.feature` — and are not duplicated here. No
Gherkin scenarios.

## ui — all 17 out-of-ring (non-acceptance-ring by spec header)

The `ui` spec's Acceptance-criteria header states these are verified as **build/seed checks**
(token lint, computed AA-contrast assertion including each gradient stop, avatar-set and
mascot-set validation, the gradient route list, the shadow-tier check) and **component/visual
smokes**, not acceptance-ring Gherkin. No Gherkin scenarios.
