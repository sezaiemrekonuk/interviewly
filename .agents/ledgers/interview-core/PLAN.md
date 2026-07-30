# Interview-core — PLAN (Architecture)

Written once. Amend only via a new `DECISIONS.md` ADR-I entry referenced here.
Codebase orientation: `REFERENCE.md` (read that before touching any task).

## Goal

This ledger builds the MVP spine: the backend interview engine and the shared
`@interviewly/ai` client that `worker` and the `report` ledger consume. When it ships, a
signed-in candidate can set up an interview from a job listing or an uploaded PDF, skip or
answer profiling, run the HR and technical rounds question-by-question against a
server-owned state machine, and reach `evaluating` with a schema-valid report produced —
all while the provider fallback chain, per-call cost audit, prompt-injection defence,
budget ceiling, rate limits, language detection, upload validation and reliability probes
enforce the spec. `docker compose up` → set up → answer through → interview reaches
`evaluating` with an `llm_calls` audit trail is the observable end-to-end result.

## The invariant this initiative must not weaken

> The API is the sole owner of interview progression and cost. No question advances, no
> state changes and no external AI call is billed except through the server-side state
> machine and the in-transaction budget check; attacker-controlled listing text never
> becomes an instruction. (K2, K9, §7.1, §7.3)

Interview progression is a correctness-and-cost invariant: a regression that lets an answer
target a non-current question, bills a call twice without an `llm_calls` row, or merges a
job listing into a system prompt is a scope-stop, not a feature gap. This ledger touches
`backend/modules/interview/`, `backend/modules/ai/`, the `@interviewly/ai` workspace
package, a storage wrapper in `backend/src/lib/`, and it extends `backend/src/lib/env.ts`.
It deliberately does not touch the auth trust boundary (auth ledger), the report worker job
or PDF rendering (report ledger), the admin read endpoints and cost dashboards (admin
ledger), or the voice room and webhooks (voice ledger).

## Topology

```
Browser
  │  POST /uploads          POST /interviews            POST /interviews/:id/profile
  │  POST /interviews/:id/answers   POST /interviews/:id/resume
  │  GET  /interviews/:id/state     GET /events/interviews/:id
  │  GET  /healthz  GET /readyz
  ▼
edge/ (Caddy — single published port, F03)
  ▼
backend/src/app.ts                       ← Express app (created by auth A01); interview-core mounts its router
  │
  ├── modules/interview/
  │     router.ts          ← binds setup, profile, answers, resume, state, SSE, uploads
  │     setup.ts           ← POST /interviews: created→profiling, split, occupation heuristic (I03)
  │     state.ts           ← GET /interviews/:id/state: room-state shape (I03)
  │     ownership.ts       ← resolve :id for the session user → INTERVIEW_NOT_FOUND (I03)
  │     csrf.ts            ← Origin/Referer check vs PUBLIC_ORIGIN (I05)
  │     profile.ts         ← POST profile|skip → hr_round, trigger round generation (I04)
  │     generation.ts      ← HR + tech batch generation via AiClient, row insertion (I04)
  │     answers.ts         ← POST answers: guarded advance, duration, transcript (I06)
  │     machine.ts         ← the K2 transition table + guard (I06/I07)
  │     resume.ts          ← POST resume: paused→round (I07)
  │     budget.ts          ← pre-call ceiling read inside the llm_calls txn (I08)
  │     report-run.ts      ← evaluating→completed|failed, store payload (I09)
  │     language.ts        ← two-consecutive-turn switch counting (I10)
  │     uploads.ts         ← POST /uploads: validate, extract, dedup (I11)
  │     download.ts        ← report signed-URL handout (I12)
  │     rate-limit.ts      ← daily interview cap + interview-start limiter (I13)
  │
  ├── modules/ai/          ← thin api-side adapter that binds AiClient into request context
  ├── src/lib/
  │     storage.ts         ← NEW (I12): put/get/signed-URL wrapper, 300 s TTL
  │     env.ts             ← F03 Zod env; extended with S3_BUCKET etc. (I15)
  │     probes.ts          ← NEW (I14): /healthz, /readyz Postgres+Redis checks
  │
  └── packages/ai/         ← @interviewly/ai (F03 wires the entry; this ledger fills it)
        AiClient.ts        ← the one seam: generateRoundQuestions, generateReport, scoreAnswer,
        prompt-builder.ts  ←   generateCandidates, detectLanguage (I01)
        registry.ts        ← versioned *.prompt.yaml loader (I01)
        providers.ts       ← openai→gemini fallback chain, per-attempt llm_calls, cost (I02)
        stub.ts            ← StubAiClient: canned schema-valid content (I01)
        schemas.ts         ← Zod: QuestionBatch, ReportPayload, Scores (I01)
        detect-language.ts ← en/tr heuristic, no LLM (I01, applied by I10)

Postgres (F02): interviews, interview_rounds, questions, answers, reports, report_questions,
                uploads, chat_messages, llm_calls, occupation_clusters, personas
Redis  (F03):   rate-limit counters, SSE fan-out
Object store:   private report bucket, 5-minute signed URLs (I12)
```

## Decision table (full ADRs in DECISIONS.md)

| # | Decision | Chosen | Reason |
|---|----------|--------|--------|
| ADR-I01 | Where does AI code live | `@interviewly/ai` workspace package, one `AiClient` seam, `StubAiClient` fake | K1 shares it with `worker`/`report`; §5.5 needs a single fakeable seam |
| ADR-I02 | Prompt storage | Versioned `*.prompt.yaml`, stable `uuid`, incrementing `version` | K9 — every `llm_calls` row is attributable and rollbackable by `(uuid, version)` |
| ADR-I03 | Prompt-injection defence | `PromptBuilder` = role separation + `<>`→entity + 12 000-char truncation + injection log-not-block | §7.1 — the listing is data, never an instruction; a schema stops "end the interview" |
| ADR-I04 | Provider reliability | Two-tier chain (`openai`→`gemini`) **is** the retry; one `llm_calls` row per attempt; cost frozen at call time | §8.3/§9.1 — no same-tier loop, fallback cost never hidden, price edits never corrupt history |
| ADR-I05 | Kill switch + key check | `AI_ENABLED=false`→`StubAiClient` (records `cost_usd=0`); `true`→boot fails if a referenced key is missing | §9.1 — teammate with no key still boots; no 2 a.m. surprise |
| ADR-I06 | Question advance | Optimistic guarded `updateMany … WHERE current_index = $expected`, no row lock; `current_index` global 1..N | K2 — `count === 0` is `QUESTION_NOT_CURRENT`; per-round `order_index` stays stable for K4 |
| ADR-I07 | Generation timing | Whole round in one `AiClient` call; tech batch generated **during** the HR round | §3.7 — round handover is never a loading screen |
| ADR-I08 | Budget ceiling | `spent_usd` read **inside** the `llm_calls` transaction; exhaustion→`evaluating(budget_exhausted)`, answer preserved | §7.3/K13 — the submitted answer is never lost; `BUDGET_EXCEEDED` on the trigger |
| ADR-I09 | Language detection | No-LLM heuristic (script ratio > 0.6, else stop-word ratio ≥ 0.15) over `en`/`tr`; switch on two consecutive turns | §3.4 — cheap, deterministic, testable without an LLM |
| ADR-I10 | Upload validation | MIME + magic bytes + ≤ 10 MB + ≤ 30 pages + ≥ 200 extracted chars; `unpdf`, no OCR; `sha256` dedup | §7.2/K12 — untrusted file, validated before a byte is stored |
| ADR-I11 | Not-owned resource | `:id` not owned by the session user → `INTERVIEW_NOT_FOUND` (404), never 403 | §7.2 — existence is not leaked |
| ADR-I12 | Report schema gate | Malformed `ReportPayload` → interview `failed` + `AI_OUTPUT_SCHEMA_INVALID`, no partial write | §5.5 layer 2 / K15 — a bad report never reaches the caller |
| ADR-I13 | Report download | Signed-URL handout endpoint (300 s TTL, owner-scoped) + storage wrapper live here; PDF rendering deferred | `object_storage.feature` is owned here; K14 bucket wiring stays infra's |
| ADR-I14 | CSRF | `SameSite=Lax` + `Origin`/`Referer` == `PUBLIC_ORIGIN` on every state-changing interview route | §7.2 — blunts cross-site state change without a token round-trip |

## Data model additions

**No structural changes.** This ledger consumes the F02 schema in full: `interviews`,
`interview_rounds`, `questions`, `answers`, `reports`, `report_questions`, `uploads`,
`chat_messages`, `llm_calls`, `occupation_clusters`, `personas`. It writes JSONB payloads
into columns F02 already declared (`questions.candidates`, `answers.scores`,
`reports.payload`) and every `llm_calls` column value; F02 owns the storage and the
`spent_usd`/`llm_calls` single-transaction boundary this ledger writes inside.

Any index a task needs (none is currently required beyond F02's §8.1 set) is authored as a
new Prisma migration file rebased on the F02 migration before merge — never an edit to the
existing migration SQL.

## Prompt registry (the core AI mechanic)

Four prompt lineages, one `*.prompt.yaml` file per `(name, version)` with a permanent
`uuid` (K9): `interview.question.generate`, `interview.report.generate` (MVP),
`interview.answer.score`, `interview.question.candidates` (K4, interface exposed here,
selection owned by `adaptive`). Every `AiClient` call resolves `(prompt_uuid,
prompt_version)`, runs the response through the method's Zod schema, and writes one
`llm_calls` row **per attempt** with `attempt_no` and `fell_back_from`. A schema failure is
a fallback trigger, never a value handed back.

## Phasing / task clusters (see STATE.md ledger)

0. Shared AI package (I01–I02) — `AiClient`, `PromptBuilder`, schemas, stub, provider chain, cost.
1. Interview setup + generation (I03–I05) — create, room state, profiling, round generation, CSRF.
2. Progression engine (I06–I08) — answers/guarded advance, transition table + pause/resume, budget.
3. Completion + detection (I09–I10) — report schema gate, language switch.
4. Ingress + operations (I11–I15) — upload, object storage, rate limits, probes, config.

## Out of scope (post-interview-core)

- Report **job execution**, PDF rendering, serving the finished report end-to-end,
  the 24 h `abandoned` sweeper — `report`/`worker` ledgers. This ledger provides the
  `evaluating→completed|failed` transition and `AiClient.generateReport`; `report` runs the
  real BullMQ job and renders the PDF.
- `/admin/*` endpoints, cost dashboards, `admin_cost.feature`, `admin_auth.feature`,
  `DELETE`/list/history green runs — `admin` ledger.
- Voice session tokens, `/webhooks/*`, avatar drivers, `voice_*.feature` — `voice` ledger.
- K4 adaptive **selection** (the B5 difficulty/topic table) and `adaptive_questions.feature`
  — `adaptive` ledger. This ledger exposes `AiClient.scoreAnswer` and
  `AiClient.generateCandidates` (interface + stub in I01, execution in I02) as the hook
  `adaptive` consumes; it does not implement selection.
- Auth register/login/Google/session — `auth` ledger. This ledger reuses `requireAuth` and
  the sign-in/register rate limiters A01 built.

**The entire schema lives in F02. This ledger may add indexes and nullable columns only,
each in its own migration, rebased before merge. Any structural change is a change to F02's
scope and gets discussed, not merged. This is the week-one collision that breaks
`docker compose up` on a fresh clone, which §10 calls the one unacceptable failure.**
