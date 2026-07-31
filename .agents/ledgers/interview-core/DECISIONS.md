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
