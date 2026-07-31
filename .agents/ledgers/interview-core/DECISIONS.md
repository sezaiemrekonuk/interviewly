# Interview-core — Decisions (append-only ADR log)

Never edit past entries. Supersede with a new dated entry referencing the one it changes.
Prefix `ADR-I` to avoid collision with foundations (`ADR-F`), auth (`ADR-A`) and other
ledgers. Referenced back into `PLAN.md`.

---

## ADR-I01 — 2026-07-30 — `@interviewly/ai` workspace package with one `AiClient` seam

**Context:** The AI code is used by three callers — `api` (generation, language detection),
`worker` (report generation), and later the `report` ledger. Options: (A) a shared
`@interviewly/ai` workspace package exposing a single `AiClient` interface, faked by
`StubAiClient`; (B) an `ai-gateway` HTTP microservice; (C) duplicate AI code inside each
module.

**Decision:** A shared `@interviewly/ai` package (K1). It exports exactly one seam,
`AiClient`, whose methods each take `{ interviewId, traceId }`, bind a timeout/retry, record
`llm_calls`, and return a Zod-validated value. `StubAiClient` returns canned schema-valid
content and is the §5.5 fake used by every acceptance scenario that is not asserting the
provider chain.

**Why not an `ai-gateway` service:** IDEA.md K1.1 rejected the separate container — it adds
a network hop, a second deploy unit and a serialization boundary for a demo with three real
users, without buying isolation the workspace package does not already give.

**Why not duplicated code:** Two copies of prompt compilation drift; a prompt-injection fix
applied to one and not the other is exactly the regression §7.1 forbids.

**Consequences:** F03 wires the `packages/ai/` entry so `backend` and `worker` see a sibling
package; this ledger fills it. Every caller depends only on the `AiClient` interface, never
on a provider SDK directly.

---

## ADR-I02 — 2026-07-30 — Versioned `*.prompt.yaml` registry with a stable `uuid`

**Context:** Prompts change over the project's life; a bad report must be traceable to the
exact prompt that produced it and rollback must be possible. Options: (A) one YAML file per
`(name, version)` lineage with a permanent `uuid` and an incrementing `version`; (B) prompts
inlined as TypeScript template literals; (C) prompts in the database.

**Decision:** `prompts/*.prompt.yaml`, one file per `(name, version)`, carrying `uuid`
(permanent identity, never reused), `name`, `version`, `provider`, `model`, `params`, and
`messages` (K9). Every `AiClient` call resolves and records `(prompt_uuid, prompt_version)`
on its `llm_calls` row.

**Why not inlined literals:** A code deploy to change a prompt loses the `(uuid, version)`
audit trail and makes A/B comparison a git-archaeology exercise.

**Why not database prompts:** Adds a migration and a fetch to every call for a set of four
files that change rarely; the file is versioned by git already.

**Consequences:** The four MVP+K4 `name`s are reserved:
`interview.question.generate`, `interview.report.generate`, `interview.answer.score`,
`interview.question.candidates`. Adding a prompt version is a new file, not an edit.

---

## ADR-I03 — 2026-07-30 — `PromptBuilder` is the prompt-injection trust boundary

**Context:** The job listing, transcript and candidate profile are attacker-controlled text
reaching an LLM that, in voice mode, holds tool-call authority (§7.1). The defence must be
assertable without a live model.

**Decision:** Every call routes through `PromptBuilder` in a fixed order (ai spec B1):
(1) role separation — user content never enters the system message, only a labelled block
in a user message; (2) neutralisation — inside every user block `<`→`&lt;`, `>`→`&gt;`;
(3) truncation — each block hard-cut to 12 000 chars, logging `LISTING_TRUNCATED`;
(4) no-profile marker — a null profile compiles to the literal `no profile provided`;
(5) variable binding from a per-prompt allow-list, an unbound `{{var}}` is
`AI_PROMPT_BUILD_FAILED`; (6) injection detection against `injection-patterns.yaml` — a
match logs `SECURITY_PROMPT_INJECTION_SUSPECTED` and **does not block**; (7) Zod validation
of the response. `security.feature` asserts against the builder **directly** (the §5.5 seam
with no fake), because a stub returns valid questions regardless of listing content.

**Why not block on an injection match:** §7.1.5 — false positives would kill legitimate
interviews; the schema (step 7) is the real barrier, the log is for the admin panel.

**Consequences:** The system message is byte-identical to the template on every call — a
property a scenario asserts. The builder has no network dependency, so it is unit-fast.

---

## ADR-I04 — 2026-07-30 — Two-tier provider chain is the retry; per-attempt `llm_calls`; cost frozen at call time

**Context:** External LLM calls fail (HTTP error, timeout, rate limit, schema-invalid
output). Options for reliability: (A) two-tier chain `openai/gpt-4.1-mini` →
`google/gemini-2.5-flash` where the fall-through **is** the retry; (B) same-tier retry loop
then fall through; (C) single provider, no fallback.

**Decision:** The ordered provider list is the retry (ai spec B6). On any trigger the call
falls to tier-2 rather than retrying tier-1 (no same-tier loop in the MVP). Each attempt
writes its **own** `llm_calls` row with `attempt_no` and `fell_back_from`, logging
`LLM_FALLBACK_TRIGGERED`. `cost_usd` is computed from `config/model-prices.yaml` **when the
call returns** and stored; a missing price row still calls, records `cost_usd = null` and
logs `PRICE_MISSING`. Per-attempt timeout 15 s (generation/score/candidates), 90 s (report);
exponential backoff base 500 ms only before a rate-limit fall-through. All providers failing
throws `AI_PROVIDER_UNAVAILABLE`; a chain-exhausted schema failure throws `AI_OUTPUT_INVALID`.

**Why not a same-tier retry loop:** It doubles latency and cost against a provider that is
usually failing for a reason the retry will hit again; the second provider is the faster path
to a good answer.

**Why not freeze cost later:** A later `model-prices.yaml` edit would rewrite history;
computing at return time makes the audit immutable.

**Consequences:** Backend maps `AI_PROVIDER_UNAVAILABLE` to interview `paused` (no data
loss, §8.3). The cost of falling back is always visible in the audit — two rows, not one.

---

## ADR-I05 — 2026-07-30 — `AI_ENABLED` kill switch + boot-time provider-key validation

**Context:** A teammate without provider keys must still boot the app; production must never
start with a referenced key missing. Options: (A) `AI_ENABLED=false` → `StubAiClient`, key
validation skipped; `true` → fail boot on any missing referenced key; (B) lazy per-call key
check; (C) always require keys.

**Decision:** (A). With `AI_ENABLED=false`, `AiClient` resolves to `StubAiClient`, returns
canned schema-valid content, still records one `llm_calls` row with `cost_usd = 0` (audit
stays whole), logs `AI_DISABLED_STUB_MODE`, and performs **no** provider-key validation.
With `AI_ENABLED=true` (default), startup fails with `PROVIDER_KEY_MISSING` before serving
any request if a provider named by a loaded prompt file has no key (§9.1, part of the §9.3
fail-fast env check).

**Why not lazy per-call:** A missing key surfaces mid-interview as a 2 a.m. failure instead
of at boot, which §9.1 explicitly rejects.

**Consequences:** Stub mode is a first-class path, not an error at the trust boundary — the
interview proceeds. Boot-time validation is the §9.3 contract, tested by `ai_provider.feature`
@AC-10.

---

## ADR-I06 — 2026-07-30 — Optimistic guarded advance; `current_index` global 1..N

**Context:** Two requests could race to answer the same question, or a stale client could
answer an old one. Options: (A) optimistic guarded `updateMany … WHERE id = $id AND
current_index = $expected`, `count === 0` → reject; (B) `SELECT … FOR UPDATE` row lock;
(C) no guard, last-write-wins.

**Decision:** (A) — the db helper's optimistic update (K2). `count === 0` means the answer
targeted a non-current question → `QUESTION_NOT_CURRENT` (409), no state change. The
`questionId` in the body must resolve to the row at `current_index`; a mismatch is the same
rejection. `current_index` is **global, 1..N** across both rounds; `questions.order_index`
is per-round, and `current_index = (round is tech ? hr_question_count : 0) + order_index`.

**Why not a row lock:** K2 rejects it — a lock held across an LLM call is a liveness hazard;
the optimistic guard is correct at this scale without holding a transaction open.

**Consequences:** The per-round `order_index` never shifts, which is exactly why the MVP and
K4 (which rewrites the *next unasked* row in place) share one schema — no rows are inserted
or deleted mid-round.

---

## ADR-I07 — 2026-07-30 — Whole-round batch generation; tech batch generated during the HR round

**Context:** Questions could be generated one at a time (per answer) or a whole round at
once. Options: (A) one `AiClient.generateRoundQuestions` call per round, inserted as rows
1..count; tech batch triggered **after** HR generation succeeds, during the HR round;
(B) per-question generation on demand; (C) both rounds up front.

**Decision:** (A) (§3.7). Backend computes the split `hr = max(2, round(N * 0.4))`,
`tech = N − hr`, returned in the `POST /interviews` response. HR generates on
`profiling → hr_round`; tech generates during the HR round so the handover is never a
loading screen. Backend owns row insertion and the state walk; `ai` owns prompt compilation
and the provider.

**Why not per-question:** Adds an LLM round-trip and a `paused` risk to every single answer,
turning each into a potential loading screen — the opposite of §3.7's intent.

**Why not both up front:** Wastes a tech batch if the interview is cut short in HR, and the
tech questions would not benefit from any HR-round signal a later iteration might add.

**Consequences:** A returned batch whose length ≠ the requested `count` is a schema failure
(no rows handed back), surfaced as `AI_OUTPUT_INVALID` — asserted by
`question_generation.feature` @AC-1.

---

## ADR-I08 — 2026-07-30 — Budget ceiling read inside the `llm_calls` transaction

**Context:** The $0.50 default budget must be enforced without losing the answer that trips
it. Options: (A) read `spent_usd` **inside** the transaction that would record the
`llm_calls` row; if `spent_usd ≥ budget_usd`, make no call, transition to
`evaluating(budget_exhausted)`, keep the answer, return `BUDGET_EXCEEDED`; (B) a pre-request
gate that reads `spent_usd` outside any transaction; (C) enforce after the fact.

**Decision:** (A) (§7.3, the K13 db contract). The submitted answer is recorded first and is
never lost; the budget check gates the *next AI call the answer would incur*. On exhaustion
the interview moves to `evaluating`, `ended_reason = 'budget_exhausted'`, the report is
generated from what exists, and the triggering request returns `402 BUDGET_EXCEEDED`.

**Why not an outside-transaction gate:** A concurrent call could slip a second charge between
the read and the insert; reading inside the transaction the insert lives in closes the race.

**Consequences:** `AI_ENABLED=false` still records a `cost_usd = 0` row, so a stub-mode
interview never trips the budget — correct, because it costs nothing.

---

## ADR-I09 — 2026-07-30 — No-LLM language heuristic; two-consecutive-turn switch

**Context:** The interview language can drift; detecting the drift must be cheap and
deterministic. Options: (A) a no-LLM heuristic — non-Latin Unicode script ratio > 0.6 ⇒ that
script's language, else stop-word hit ratio ≥ 0.15 against the committed `en`/`tr` lists,
else ambiguous; backend switches on **two consecutive** turns in the other language; (B) an
LLM classification call per answer; (C) a heavyweight language-ID library.

**Decision:** (A) (§3.4, ai Q1). `AiClient.detectLanguage(text, current)` makes **no** LLM
call and returns `{ language, ambiguous }`. Below both margins it returns
`{ language: current, ambiguous: true }` and the turn does not count toward a switch. Backend
applies the two-consecutive rule, logs `LANGUAGE_SWITCHED (from, to)`, and asks `ai` to
regenerate any pre-generated K4 candidates (wrong language).

**Why not an LLM call:** It bills every answer and adds latency for a signal a stop-word
ratio captures at zero cost; `language_detection.feature` asserts **no** `llm_calls` row is
written for classification.

**Consequences:** The MVP language set is `{ en, tr }` — two committed stop-word lists. Text
clearing neither margin keeps `interviews.language`; a single below-margin turn breaks a
would-be switch streak.

---

## ADR-I10 — 2026-07-30 — Upload validation by MIME + magic bytes + size + pages + text; `sha256` dedup

**Context:** An uploaded PDF is untrusted input reaching text extraction. Options: (A)
validate MIME **and** magic bytes, ≤ 10 MB, ≤ 30 pages, extract with `unpdf` (no OCR),
reject < 200 extracted chars, dedup by `sha256` at the db layer; (B) trust the MIME header;
(C) run OCR on scanned PDFs.

**Decision:** (A) (§7.2, K12). Each failure returns its stable code (`UPLOAD_TOO_LARGE` 413,
`UNSUPPORTED_MEDIA_TYPE` 415, `UPLOAD_TOO_MANY_PAGES` 422, `PDF_TEXT_TOO_SHORT` 422). A
byte-identical re-upload reuses the `uploads` row (same `sha256`), not an error.

**Why not trust the MIME header:** A `renamed-text-file.pdf` passes a header check and fails
a magic-byte check — the scenario `upload.feature` @AC-14 asserts the magic-byte rejection.

**Why not OCR:** K12 rules it out for the MVP; a scanned PDF yielding < 200 chars asks the
candidate to paste instead (US-04).

**Consequences:** The 5-minute signed URL and the bucket itself are `infra`'s domain (K14);
this ledger validates, extracts, and hands bytes to the storage wrapper.

---

## ADR-I11 — 2026-07-30 — A not-owned `:id` is `INTERVIEW_NOT_FOUND` (404), never 403

**Context:** A user requesting an interview they do not own could be told 403 (it exists but
is not yours) or 404 (as if absent). Options: (A) 404 `INTERVIEW_NOT_FOUND`; (B) 403
`FORBIDDEN`.

**Decision:** (A) (§7.2). Ownership is checked on every `:id` route via a resolver that
filters by `user_id` and `deleted_at: null`; a miss is `INTERVIEW_NOT_FOUND`.

**Why not 403:** A 403 leaks the existence of another user's interview — a user-enumeration
and privacy vector. `object_storage.feature` @AC-6 asserts a second candidate requesting
another's report gets 404, not 403.

**Consequences:** Admin reads (admin ledger) are the only callers that bypass the soft-delete
filter; this ledger never exposes a deleted or non-owned row.

---

## ADR-I12 — 2026-07-30 — Report schema gate: malformed → `failed`, no partial write

**Context:** `generateReport` can return output that violates the K15 `ReportPayload` schema.
Options: (A) validate against the Zod schema before any write; on failure set the interview
`failed`, log `AI_OUTPUT_SCHEMA_INVALID`, store no payload; (B) store the raw payload and let
the client cope; (C) coerce/repair the payload.

**Decision:** (A) (§5.5 layer 2, K15). A malformed report never reaches the caller and never
lands in `reports.payload`. A valid payload transitions `evaluating → completed` and is
stored; `overall_score` and every `rounds[].score`/`questions[].score` are integers in
0..5, `strengths`/`improvements` have 2..5 items, `star_adherence ∈ [0,1]`.

**Why not store-and-cope:** A partial or malformed report on screen is worse than an honest
`failed` state the report ledger can retry or dead-letter (K10).

**Consequences:** This ledger owns the `generateReport` method + the schema gate + the
`evaluating→completed|failed` transition. The `report` ledger runs the real BullMQ job, the
PDF render, and end-to-end serving on top of this path.

---

## ADR-I13 — 2026-07-30 — Report download endpoint + storage wrapper live in interview-core

**Context:** `object_storage.feature` (a green run this ledger owns) needs a report-download
endpoint that returns a short-lived signed URL scoped to the owner. The bucket, buckets
policy and Caddy `/assets/*` route are `infra`'s domain (K14), but no `infra` ledger is
written yet. Options: (A) build a thin `storage.ts` wrapper (put/get/signed-URL, 300 s TTL)
and a `download.ts` endpoint here, leaving bucket provisioning to `infra`; (B) block this
ledger on an unwritten `infra` ledger; (C) fold the whole storage layer here.

**Decision:** (A). `backend/src/lib/storage.ts` wraps the object store with a `signedUrl(key,
ttlSeconds)` returning a URL that expires ≤ 300 s ahead of the clock; `download.ts` checks
ownership (→ `INTERVIEW_NOT_FOUND` for a non-owner) and hands out the signed URL. The
acceptance ring uses a `FakeStorage` + `Clock` seam.

**Why not block on infra:** `infra` is authored around the MVP band; blocking a green run
this ledger owns on an unwritten ledger stalls the critical path for no design reason.

**Consequences:** When `infra` lands the real bucket + CSP, it configures the wrapper via env
(`S3_BUCKET`, endpoint, credentials — added to the schema in I15); the endpoint contract does
not change. PDF **rendering** stays with the `report` ledger; this ledger signs whatever key
the `reports.pdf_key` column holds.

---

## ADR-I14 — 2026-07-30 — CSRF: `SameSite=Lax` plus an `Origin`/`Referer` check on state-changing routes

**Context:** State-changing interview routes must resist cross-site requests. Options: (A)
`SameSite=Lax` session cookie (auth A01) plus an `Origin`/`Referer` == `PUBLIC_ORIGIN` check
on every non-`GET` interview route → `CSRF_ORIGIN_MISMATCH` (403); (B) a synchroniser CSRF
token; (C) rely on `SameSite` alone.

**Decision:** (A) (§7.2). A middleware compares `Origin` (falling back to `Referer`) against
`config.PUBLIC_ORIGIN` on every state-changing interview route and rejects a mismatch with
`CSRF_ORIGIN_MISMATCH` before the handler runs. Auth's own routes
(`/auth/register`, `/auth/login`, `/auth/google*`) are exempt (they are the sign-in path).

**Why not a CSRF token:** A token round-trip adds a fetch and state for a same-origin SPA that
`SameSite=Lax` plus an origin check already protects; the spec chose the lighter control.

**Consequences:** `interview_flow.feature` @AC-15 asserts a mismatched `Origin` on
`POST /interviews/:id/profile` returns 403 and leaves the state unchanged; a matching origin
proceeds. The middleware is built alongside the interview router (I03) and first asserted
through `/profile` in I05.

---

## ADR-I15 — 2026-07-31 — The runnable Cucumber set is an allow-list over `.agents/features/`, not a copy under `backend/`

**Context:** I01 was the first ATDD session, so it had to wire the acceptance runner that
`.agents/EXECUTE.md` § 7 flags as a false green (`cucumber-js` with no config, no features,
`0 scenarios`, exit 0). Stage 2 authored 25 `.feature` files in `.agents/features/`, but only
the four builder-level `security.feature` scenarios have an implementation to run against
today. Options: (A) a root `cucumber.js` whose `paths` is an explicit allow-list pointing
straight at `.agents/features/<file>.feature`, grown one file per task; (B) each task copies
the feature files it wires into `backend/features/`, per REFERENCE.md as written; (C) glob
all of `.agents/features/` immediately.

**Decision:** (A). Root `cucumber.js`, `paths: ['.agents/features/security.feature']`,
`require: ['backend/features/step_definitions/**/*.ts']` loaded through `tsx/cjs`,
`strict: true`. Each task appends its own feature file when it wires the steps. Root
`npm run test:acceptance` runs `cucumber-js` directly; `backend`'s `test:acceptance` script
is deleted.

**Why not a copy under `backend/`:** two copies of every feature file is two things to keep
in sync, and the authored spec silently drifting from the runnable test is precisely the
failure the acceptance ring exists to prevent. One file, one source of truth.

**Why not a glob:** every unwired feature would be an undefined-step failure forever, so the
suite could never be green, and a permanently-red suite gets ignored — a slower road to the
same false green. The allow-list makes the acceptance suite grow exactly as fast as the
implementation.

**Consequences:** REFERENCE.md's `backend/features/` line is patched to match. Every later
task in every ledger **must append its feature file to `cucumber.js` `paths`** as part of
wiring its steps; a task that forgets will see its scenarios silently not run. `strict: true`
means an undefined, pending or ambiguous step fails the run, so the omission surfaces the
moment a step definition is added without its feature file.

---

## ADR-I16 — 2026-07-31 — `security.feature` @AC-5's two HTTP steps are restated at the package seam

**Context:** `security.feature` @AC-5 ended with `And the response status is 200` and
`And exactly 3 questions exist for the HR round`. Both are HTTP-ring assertions needing
`POST /interviews` and HR generation — I03/I04, which are not `done`. The **spec's** AC-5
(`.agents/specs/2026-07-29-ai.md`, criterion 5) is package-level: "emits
`SECURITY_PROMPT_INJECTION_SUSPECTED` **and** the call still proceeds (questions returned)".
The Gherkin overshot its own acceptance criterion. I01's own Definition of Done requires
@AC-5 to pass against the builder. Options: (A) rewrite the two steps to their package-seam
equivalents; (B) defer the whole scenario to I04; (C) implement the steps as written by
mapping "response status is 200" onto "the call did not throw".

**Decision:** (A). The two lines are replaced by
`And the generated HR batch contains exactly 3 valid questions`, asserted against
`StubAiClient.generateRoundQuestions` routed through the real `PromptBuilder`. Everything
else in the scenario is untouched.

**Why not (C):** a step named "the response status is 200" that never makes a request is the
same false-green pattern EXECUTE.md § 7 warns about, one line lower down.

**Why not (B):** the injection-is-logged-not-blocking property is I01's to prove, and it is
provable now. Deferring it would leave the trust boundary's headline behaviour unasserted for
two more tasks.

**Consequences:** `.agents/features/security.feature` diverges from its Stage-2 text by two
lines; COVERAGE.md's ai AC-5 mapping still holds, because the scenario still asserts exactly
what spec criterion 5 states. **`StubAiClient` must keep compiling its prompts through the
real `PromptBuilder`** — the scenario only passes because generation crosses the trust
boundary, and an I02 client that skips the builder in stub mode would break it.

---

## ADR-I17 — 2026-07-31 — A prompt `uuid` is unique per lineage, not per file

**Context:** The I01 task file says the registry throws on a duplicate `uuid` across files.
The ai spec's prompt-file format says the opposite in effect: `uuid` is "permanent identity;
never reused" and `version` "increments; uuid is stable across versions". Under a
strict per-file rule, publishing v2 of a prompt is impossible.

**Decision:** the registry enforces two rules — a duplicate `(name, version)` throws, and a
`uuid` claimed by two different `name` lineages throws. Two files sharing a uuid *and* a name
are the legal versions-of-one-lineage case and load fine. `resolve(name)` without a version
returns the highest version.

**Why:** cost and quality analytics hang off `prompt_uuid`; two lineages sharing one would
silently merge their histories, which is the failure worth throwing on. Versions of one
lineage sharing it is the entire point of the identifier.

**Consequences:** Every prompt shipped in I01 is `version: 1`, so the versioned resolve path
has unit coverage but no production exercise yet — noted in STATE.md Backlog. A prompt
revision is a new file with the same `uuid` and `name` and an incremented `version`; the old
file is never edited (I01 §Non-negotiables, EXECUTE.md § 8).

---

## ADR-I18 — 2026-07-31 — Both providers are called with `fetch`, not with their SDKs

**Context:** The I02 task file says "the openai + gemini clients (SDKs kept internal to this
file)". The non-negotiable it is protecting is "no provider SDK is imported outside
`packages/ai/`" — a boundary rule, not a dependency requirement.

**Decision:** `providers.ts` calls both providers with the platform `fetch`. No provider SDK
is added to `package.json`.

**Why:** each provider is one JSON POST and one response shape. Two SDKs would add two
dependency trees to a repo whose `audit` job already carries an unfixable high advisory, and
they would buy nothing this file does not do in twenty lines — the timeout is ours (a race,
not the SDK's), the retry is the chain (ADR-I04), and the cost is computed from our own
price file. The boundary rule is satisfied more strongly by importing no SDK at all.

**Consequences:** provider response shapes are typed by hand (`OpenAiBody`, `GeminiBody`) and
read defensively; a breaking provider API change surfaces as a schema failure, which is
already a fallback trigger. Structured output is requested with `response_format:
json_object` / `responseMimeType: application/json` rather than a Zod-to-JSON-Schema
conversion — the Zod schema still gates the response, so a non-conforming body falls through
the chain exactly as an HTTP error does.

---

## ADR-I19 — 2026-07-31 — A missing tier-2 key degrades the chain; it does not fail the boot

**Context:** B7 says every provider *named by a loaded prompt file* must have a key at
startup. Tier-2 (`google/gemini-2.5-flash`) is named by the **chain** (B6), not by any prompt
file. I01's hand-off suggested validating the chain's providers too, but
`ai_provider.feature` @AC-10 boots successfully with only the openai key set.

**Decision:** `validateProviderKeys` throws `PROVIDER_KEY_MISSING` for prompt-declared
providers only. A missing tier-2 key logs `PROVIDER_KEY_MISSING` with `fatal: false` at boot,
and `buildChain` drops the step so it is never attempted.

**Why:** the feature file is the acceptance contract and it is unambiguous. Beyond that, the
two are genuinely different failures: no tier-1 key means no interview can ever run, while no
tier-2 key means the retry is gone — a degraded service, not a dead one. Refusing to boot
over a degraded retry path takes the whole API down to protect a fallback.

**Consequences:** with only tier-1 configured, a tier-1 failure surfaces immediately as
`AI_PROVIDER_UNAVAILABLE` (or `AI_OUTPUT_INVALID`) with one `llm_calls` row instead of two.
The boot warning is the only notice, so it must not be filtered out of the log pipeline.

---

## ADR-I20 — 2026-07-31 — `cost_usd = null` is the package contract; the F02 column is not nullable yet

**Context:** ai spec §9.2 and AC-8 require a call whose model has no price row to record
`cost_usd = null` and log `PRICE_MISSING` — null meaning "price unknown", distinct from 0
meaning "free". F02's `schema.prisma` declares `llm_calls.cost_usd Decimal @db.Decimal(12,6)`,
NOT NULL. Widening it is a structural change, which is F02's scope (migration protocol), not
this ledger's.

**Decision:** the package's `LlmCallRecord.costUsd` is `number | null` and the acceptance
suite asserts that contract. `backend/modules/ai`'s `writeLlmCall` stores `costUsd ?? 0` until
F02 widens the column, and the mismatch is filed as an open blocker.

**Why:** the invariant worth protecting is that the *chain* never invents a price, and that is
what is now tested. Storing 0 for an unknown price is a real loss of fidelity, but it is
bounded — `PRICE_MISSING` is logged at the same moment with the provider, model and prompt
version, so no unpriced call is silent. Blocking all of I02 on a one-column widening owned by
another person was the worse trade.

**Consequences:** until the column is widened, the admin cost dashboard cannot distinguish a
free call from an unpriced one from the table alone; it must read the `PRICE_MISSING` log.
Every model the repo ships today has a price row, so the path is currently unreachable in
practice. Superseded the moment F02 lands `cost_usd Decimal?`.

---

## ADR-I21 — 2026-07-31 — The stub's audit row is written by `resolveAiClient`, and cucumber keeps one World

**Context:** I01 left the `cost_usd = 0` stub row to "I02's `backend/modules/ai/index.ts`",
because `StubAiClient` cannot reach Prisma. Separately, `ai_provider.feature` and
`security.feature` both use the step `the HR round is generated`, and cucumber has a single
global step registry and a single world constructor.

**Decision:** the stub row is written by a `StubRecordingClient` wrapper inside
`resolve-client.ts`, using the same injected `recordLlmCall` the live client uses.
`backend/modules/ai/index.ts` stays a thin binding of Prisma + env + logger. On the test side
there is one World (`AiWorld`) and one definition of `the HR round is generated`, which
delegates to `world.generateHrRound()`.

**Why:** the writer is already injected, so the wrapper is db-agnostic and the switch stays a
single function — putting it in `backend` would mean `worker` re-implementing stub-mode
auditing to get the same rows. For the World: a second `setWorldConstructor` silently replaces
the first and a second definition of a shared step makes *both* feature files ambiguous, so
"one World per feature file" is not available whatever its merits.

**Consequences:** `AiWorld` carries two seams at two depths — `PromptBuilder` directly for
`security.feature`, `ProviderTransport` for `ai_provider.feature` — and the shared generation
step now runs through `resolveAiClient` rather than `StubAiClient`. `security.feature` is
unaffected because generation still compiles through the real builder either way, which is
exactly what ADR-I16 requires.

---

## ADR-I22 — 2026-07-31 — The technical batch is triggered by the HR round, not by `POST /profile`

**Context:** ADR-I07 and the backend spec §3 both say the tech batch is generated "during the
HR round (**triggered after HR generation succeeds**)". Read literally that puts the trigger
inside `POST /interviews/:id/profile`, and both acceptance scenarios that describe the
transition say the opposite: `question_generation.feature` @AC-7 asserts *"the technical round
has no questions yet"* immediately after the request returns 200, and @AC-1 reconfigures the
stub **after** profiling completes and then triggers technical generation as its own step,
expecting zero pre-existing tech rows. Options: (A) generate HR only in the handler and expose
the tech batch as an idempotent trigger the HR round fires; (B) fire-and-forget
`void generateRound(tech)` after the response; (C) treat the conflict as a team decision and
block the task.

**Decision:** (A). `POST /profile` generates the HR batch and nothing else.
`generation.ts` exports `ensureTechBatch(interview, opts)` — a no-op when tech questions
already exist — which I06 calls from the answer handler once the HR round is under way. The
spec's *intent* ("the round handover is never a loading screen") is preserved exactly: the
batch still lands during the HR round, several answers before it is needed.

**Why not (B):** it fails @AC-1 outright — the default stub would have inserted five valid
tech questions before the scenario ever configures its shortfall client — and makes @AC-7 a
race between the assertion and an unawaited promise. A green that depends on scheduler timing
is not a green.

**Why not (C):** the acceptance criteria are the contract ("verification is a command, not a
wish"), and they are unambiguous in the same direction twice. There was nothing for a human to
arbitrate that the feature files had not already settled.

**Consequences:** `POST /profile` pays for exactly one LLM call, which also keeps the §8.1
"< 8 s, covered by the lobby wait" budget honest. **I06 must call `ensureTechBatch` when it
records the first HR answer** — until it does, an interview reaching the tech round finds no
questions. Flagged in I04's `## Notes` under "For I06". The idempotence is what lets I06 call
it on every answer rather than having to detect the first.

---

## ADR-I23 — 2026-07-31 — `profiling.feature`'s two report scenarios assert I04's snapshot, not I09's endpoint

**Context:** I04's Verification is `--tags "@profiling or …"`, which selects all four
`profiling.feature` scenarios. Two of them (@AC-3b, @AC-4a) end at *"the report is generated
for that interview"*, and report generation is I09's endpoint and job — not landed. Options:
(A) drive `AiClient.generateReport` from the step using the production helper that assembles
the profile half of its arguments; (B) define only the @AC-2 steps, leaving two scenarios
undefined and the Verification command red; (C) leave `profiling.feature` out of `cucumber.js`
`paths`, so `@profiling` matches nothing and the command passes having proven nothing.

**Decision:** (A). `generation.ts` exports `profileVariables(interview)` — the snapshot split
into `candidateProfile` and `candidateCv` — and both `roundQuestionArgs` and the report steps
feed it. What the two scenarios actually assert (a CV reaches a report prompt as data in its
own block; a date of birth reaches neither prompt) is I04's contract, because I04 owns the
snapshot. No report module is stubbed into existence.

**Why not (C):** it is the false-green pattern EXECUTE.md § 7 names — a job that cannot fail
reports safety it never checked — and REFERENCE.md warns about the same thing one line up.

**Consequences:** **I09 must assemble `generateReport`'s profile arguments from
`profileVariables`**, not by reading `candidate_profile` itself; if it re-derives the split,
these two scenarios keep passing while production diverges. `I completed an 8-question
interview` sets the end state as a database fixture because the answer walk is I06/I07 — it is
a precondition, not the thing under test, and it becomes a real flow once I06 lands.
ADR-I16 is the precedent: a scenario may be asserted at the ring that owns its criterion.

## ADR-I24 — 2026-07-31 — CSRF is mounted once with `router.use`, above `router.param`

**Context:** I03 wired `requirePublicOrigin` per route. Two defects. (1) A new state-changing
route ships unguarded by omission — the "no route-by-route drift" non-negotiable. (2) Express
runs `router.param` callbacks **before** route middleware, so a cross-site POST reached
`ownership.ts` → `activeInterview()`'s DB read before the 403.

**Decision:** one `router.use(requirePublicOrigin)` above `router.param('id', …)`. The
middleware exempts `GET`/`HEAD`/`OPTIONS` itself (`SAFE_METHODS`), which is what makes
router-wide mounting safe for the SSE stream (I07) and `/report/download` (I12).

**Consequences:** **I06/I07/I12 mount routes plainly — never pass `requirePublicOrigin`
again.** Coverage is by method, not by opt-in. `csrf.test.ts` pins both properties.

## ADR-I25 — 2026-07-31 — `@unwired` skips scenarios in a feature file owned by several tasks

**Context:** `cucumber.js` `paths` is a file-level allow-list (ADR-I15), but
`interview_flow.feature` is owned by four tasks. I05 owns only @AC-15. Leaving the file out
makes I05's Verification match zero scenarios and pass vacuously; putting it in unfiltered
leaves the blocking `acceptance` job undefined on five scenarios until I08, on every
person's PRs — which is how a red job starts being ignored.

**Decision:** second axis on the allow-list. Default profile carries `tags: 'not @unwired'`;
unwired scenarios are tagged `@unwired`; the owning task deletes its own tag in the PR that
wires its steps. `strict: true` still fails an untagged scenario with missing steps, and a
CLI `--tags` replaces the expression, so scoped Verification commands are unaffected.

**Consequences:** supersedes I03's "document the gap, leave it undefined" precedent for
multi-owner files only — a file one task owns end to end still goes in whole. **A forgotten
`@unwired` deletion is a silent skip**, the same trap `paths` already has; both are called
out in REFERENCE.md.
