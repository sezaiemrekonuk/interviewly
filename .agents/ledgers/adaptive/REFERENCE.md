# Adaptive — REFERENCE (read this once, then you don't need to spelunk)

Single orientation doc for any agent executing a task in this ledger. It reflects the project
layout **as it exists after foundations F01/F02/F03 and interview-core I01, I02, I04, I06 are
done**. If a path listed here does not exist, its providing task has not landed — check
STATE.md's cross-ledger table before proceeding. Verified against the foundations,
interview-core task files and the `ai`/`backend` specs as of 2026-07-30. If reality diverges,
trust the code and patch this file.

## Services, ports, roles

| Service | Package | Port (internal) | DB role | Trust |
|---|---|---|---|---|
| `api` | `backend/` | 3001 | reads/writes all tables | trusted internal; Caddy terminates TLS |
| `db` | Postgres (compose) | 5432 | persistence | not published on host (K14) |
| `cache` | Redis (compose) | 6379 | rate-limit counters, SSE fan-out, BullMQ | not published on host |
| `edge` | Caddy | 443 (host) | none | single published port (F03) |

Adaptive is entirely inside the `api` interview module. It adds no service, no package, no
port, no migration. `@interviewly/ai` is the workspace package (I01/I02) it imports for the
`AiClient` seam.

## Commands

```bash
# Start dependencies (from repo root)
docker compose up -d db cache
cd backend && npm install && npx prisma migrate deploy && npm run seed

# Build the shared AI package (I01/I02 must be green)
npm run -w @interviewly/ai build

# D01 self-check (pure selector — no DB, no network)
npx tsx backend/modules/interview/adaptive-select.selftest.ts

# D02 self-check (candidate assembly over StubAiClient — no DB)
npx tsx backend/modules/interview/candidate-prep.selftest.ts

# D03 acceptance gate (both @AC-12 scenarios; runs from repo root)
npm run test:acceptance -- --tags "@adaptive-questions"
```

**Tag note.** The adaptive feature file carries exactly one area tag, `@adaptive-questions`,
over two `@AC-12` scenarios (the score-driven Scenario Outline and the malformed-score guard).
Both need the full submit → score → select → promote path, so `--tags "@adaptive-questions"`
is the whole gate; D03 greens it. D01 and D02 verify against their own runnable self-checks
because neither can green the feature alone.

## HTTP contract touched (owned by I06; adaptive adds a hook, not a route)

| Method + Path | Auth | Success | Adaptive's part |
|---|---|---|---|
| `POST /interviews/:id/answers` | `requireAuth` | 200 `{ state, nextIndex }` | after I06 records the answer + advances, the D03 hook scores it, selects, and rewrites the next unasked question row's `text`/`difficulty`/`topic`/`chosen_reason`; a malformed score leaves the default row |

The submit returns **200 in both the graded and the fallback case** — a scoring failure is not
a client error. No new route, no new error code.

## `@interviewly/ai` — the seam this ledger consumes (never re-implements)

Defined by I01, executed by I02. Adaptive calls two of the five methods:

| Method | Input (beyond `{ interviewId, traceId }`) | Returns | Used by |
|---|---|---|---|
| `scoreAnswer({ question, answer, ctx })` | the answered question + transcript | `Scores` (Zod-validated) | D03 |
| `generateCandidates({ slot, ctx })` | the N+1 slot (prior question + prior score + topics used) | `Candidate[]` (easier / same / harder) | D02 |

`StubAiClient` (I01) returns canned schema-valid values for both, records a `cost_usd = 0`
`llm_calls` row, and is the fake every scenario runs against. **Adaptive never imports a
provider SDK and never validates provider output itself** — the `Scores`/`Candidate` schema
gate lives in the package; adaptive re-validates only at the point it interprets `overall`
(the D01 guard), which is the invariant's belt-and-braces.

`Scores` (import from `@interviewly/ai`) — the field adaptive reads is the integer
`overall ∈ 0..100`. A score whose `overall` is out of range (e.g. `101`) fails the schema and is
the malformed case. `Candidate` — `{ text, difficulty: 'easy'|'medium'|'hard', topic }`.

## The selection rule (D01 — IDEA.md K4, ai spec B5)

Difficulty is ordered `easy < medium < hard`.

| `overall` | Next difficulty | Topic move | `chosen_reason` |
|---|---|---|---|
| 0–2 | one level **easier** | **same** | `score_low` |
| 3 | **same** | **same** (different angle) | `score_mid` |
| 4–5 | one level **harder** | **new** | `score_high` |

End-clamps: `hard`+5 → `hard`, topic **new**; `easy`+0 → `easy`, topic **same**. A score
failing the `Scores` schema → `{ graded: false, chosenReason: 'fallback' }`; the caller keeps
the default next row and logs `LLM_FALLBACK_TRIGGERED`.

## Key code anchors

All paths relative to repo root. Each exists once its providing task lands.

| Path | Task | What it does |
|---|---|---|
| `backend/src/lib/db.ts` | F02 | Prisma singleton |
| `backend/src/lib/logger.ts` | F03 | Pino factory: `logger.<level>({obj}, "EVENT_NAME")` |
| `packages/ai/src/AiClient.ts` | I01 | The seam interface (`scoreAnswer`, `generateCandidates`) |
| `packages/ai/src/schemas.ts` | I01 | `Scores`, `Candidate` Zod schemas (imported by D01/D02/D03) |
| `packages/ai/src/stub.ts` | I01 | `StubAiClient` canned content |
| `packages/ai/src/providers.ts` | I02 | openai→gemini chain, per-attempt `llm_calls`, cost, `LLM_FALLBACK_TRIGGERED` |
| `backend/modules/ai/index.ts` | I02 | api-side adapter binding `AiClient` into request context |
| `backend/modules/interview/generation.ts` | I04 | Base round generation (the next row adaptive rewrites) |
| `backend/modules/interview/answers.ts` | I06 | `POST /answers` handler with the marked adaptive-hook slot (D03 attaches) |
| `backend/modules/interview/adaptive-select.ts` | **D01** | Pure `selectNextQuestion(rawScore, current)` + malformed-score guard |
| `backend/modules/interview/adaptive-select.selftest.ts` | **D01** | Assert self-check: 5 table rows + 2 clamps + malformed→fallback |
| `backend/modules/interview/candidate-prep.ts` | **D02** | `prepareNextCandidates(...)`: `generateCandidates` → persist 3 to `questions.candidates` |
| `backend/modules/interview/candidate-prep.selftest.ts` | **D02** | Assert self-check: stub returns easier/same/harder, assembled payload shape |
| `tests/step-definitions/adaptive.ts` | **D03** | Cucumber steps for `adaptive_questions.feature` (if not already present) |

## Schema (columns this ledger reads/writes)

Owned by F02 — **no structural change here** (ADR-F02 / ADR-D / §10). Reads/writes only:

```
answers
  scores      Json   ← written by I06's scoreAnswer call (I02); adaptive reads overall

questions
  order_index Int    ← the next unasked row is current_index + 1 (per round)
  text        String ← rewritten on promotion (D03)
  difficulty  Difficulty  (easy|medium|hard)  ← read (current) + rewritten on promotion
  topic       String ← read (current) + rewritten on promotion
  candidates  Json   ← 3 pre-generated candidates (D02); 1 promoted, 2 retained (D03)
  chosen_reason ChosenReason?  (score_low|score_mid|score_high|language_switch|fallback)
                     ← written on every adaptive turn (D03); 'language_switch' is I10's, not here
```

**The next unasked row.** `current_index` is global `1..N`; the tech round's `order_index` is
per-round (`current_index = hr_question_count + order_index` in the tech round, per I06). The
"next question" adaptive rewrites is the row at `current_index + 1`, found through the same
resolution I06 uses — do not re-derive it; read I06's `answers.ts`/`state.ts` for the helper.

## Conventions

**Error codes** are imported from `backend/src/lib/error-codes.ts`, never inlined. This ledger
introduces **no new error code**: a malformed score is not a client error, it is the fallback
path (200 response, `chosen_reason = 'fallback'`, `LLM_FALLBACK_TRIGGERED` logged).

**Log shape:** `logger.<level>({ traceId, interviewId, questionId }, "EVENT_NAME")` —
structured object first, event name second, never a display string. Events this ledger emits or
relies on: `QUESTION_CANDIDATES_GENERATED` (D02, on pre-generation), `ANSWER_SCORED` (the score
call — emitted by the I02 execution layer), `LLM_FALLBACK_TRIGGERED` (D03, the malformed-score
guard — the branch this ledger drives). **Never log the transcript, the candidate/question
text, the score `reasons`, a provider key, or any PII** (K6, §7.2). Log the `questionId` and the
`chosen_reason`, not the content.

**Validation:** the `Scores` schema (I01) is re-validated at the D01 boundary before `overall`
is read. A failure is the fallback path, never a thrown error to the client and never a graded
pick — this is the ledger invariant.

**AI calls:** always through `AiClient` (the I02 adapter in request context); never import a
provider SDK. Every `scoreAnswer`/`generateCandidates` call records an `llm_calls` row (stub
mode too, `cost_usd = 0`) — that accounting is I02's, not this ledger's to add.

**The difficulty label is never exposed to the user** (K4). `chosen_reason` and `difficulty`
live on the `questions` row for admin/audit; the room-state the client sees carries the
question `text`/`kind`/`topic`/`difficulty` per I06's shape, but the *reason* for the pick is
never surfaced as user-facing copy.

**Migration rule** (ADR-F02 / ADR-D): no structural schema change in this ledger. A new index
or nullable column is a new Prisma migration file rebased on top of the F02 migration before
merge. Never edit an existing migration SQL file. Any structural change is a change to F02's
scope and is discussed, not merged.
