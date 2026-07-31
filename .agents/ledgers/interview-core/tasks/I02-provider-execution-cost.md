# I02 — Provider execution: fallback chain, per-attempt `llm_calls`, cost, stub mode, key validation
REPO: (this repo) · Depends: I01 · Status: done
Read first: STATE.md, REFERENCE.md, then this.
**Model: claude-opus-4.8** — this is the cost-audit invariant (K9) and the AI-trust reliability path (§8.3). A hidden fallback cost, a missing `llm_calls` row, or a same-tier retry loop that doubles spend is a defect a cheap model introduces silently.

## Goal
Owner's ask:

> "Behind the `AiClient` interface: the openai→gemini fallback chain that *is* the retry,
> one `llm_calls` row per attempt with attempt_no and fell_back_from, cost frozen at call
> time from the prices file, the `AI_ENABLED` stub kill switch, and boot-time provider-key
> validation. Acceptance scenarios in `ai_provider.feature` must be green."
> — interview-core decomposition (ADR-I04, ADR-I05, §9.1)

This task implements the real providers behind the `AiClient` interface I01 defined. It
adds the openai and gemini clients, the ordered fallback chain, per-attempt `llm_calls`
recording, cost computation, the `AI_ENABLED=false` → `StubAiClient` resolution, and the
startup provider-key check. Generation, scoring and candidates all route through it; I04
first exercises it via the HR round.

## Security boundaries
- **No provider key in any log line or error body.** `PROVIDER_KEY_MISSING` names the
  provider, never the key. Keys come from `config` (F03 env), never hard-coded.
- **The two-tier chain *is* the retry** (ADR-I04). On a trigger the call falls to tier-2;
  there is no same-tier retry loop in the MVP. A loop doubles latency and cost against a
  provider failing for a reason the retry will hit again.
- **Cost is frozen at return time.** `cost_usd` is computed from `model-prices.yaml` when
  the call returns and stored; a later price edit never rewrites history. A missing price
  row records `cost_usd = null` and logs `PRICE_MISSING` — it does not throw.

## Non-negotiables
- **One `llm_calls` row per attempt.** A fallthrough writes two rows: attempt 1
  (`fell_back_from = null`) and attempt 2 (`attempt_no = 2`, `fell_back_from` = tier-1
  model), and logs `LLM_FALLBACK_TRIGGERED`. A succeeding tier-1 writes exactly one row.
- **A schema-invalid response is a fallback trigger**, same as an HTTP error, timeout, or
  rate-limit. Chain exhausted by schema failure → throw `AI_OUTPUT_INVALID`; chain exhausted
  by transport failure → throw `AI_PROVIDER_UNAVAILABLE`.
- **Stub mode still audits.** `AI_ENABLED=false` resolves `AiClient` to `StubAiClient`,
  records one `llm_calls` row with `cost_usd = 0`, logs `AI_DISABLED_STUB_MODE`, and skips
  provider-key validation entirely.
- **Boot-time key check.** With `AI_ENABLED=true`, startup fails with `PROVIDER_KEY_MISSING`
  before serving any request if a provider named by a loaded prompt file has no key.
- **Timeouts + backoff.** Per-attempt: 15 s generation/score/candidates, 90 s report.
  Exponential backoff base 500 ms only before a rate-limit-triggered fallthrough.

## Context (anchors)
- `packages/ai/src/providers.ts` — **create.** The openai + gemini clients (SDKs kept
  internal to this file), the ordered chain, per-attempt timeout, backoff, and the
  `recordAttempt` helper that inserts one `llm_calls` row. Reads the prompt's
  `(provider, model)` from the compiled `PromptBuilder` output.
- `packages/ai/src/cost.ts` — **create.** `costFor(provider, model, units) → number | null`
  from `model-prices.yaml`; null (not throw) when the row is absent, and the caller logs
  `PRICE_MISSING`.
- `packages/ai/src/live-client.ts` — **create.** `LiveAiClient implements AiClient`: for
  each method, `PromptBuilder.buildMessages` → run the chain → validate with the method's
  schema → return. Timeout table per method above.
- `packages/ai/src/resolve-client.ts` — **create.** `resolveAiClient(config, deps)`:
  `config.AI_ENABLED === false` → `StubAiClient` (still records `cost_usd = 0`);
  else `LiveAiClient`. Exposes `validateProviderKeys(config)` for the boot check.
- `packages/ai/src/index.ts` — extend I01's re-exports with `resolveAiClient`,
  `validateProviderKeys`.
- `backend/modules/ai/index.ts` — **create.** The api-side adapter: calls `resolveAiClient`
  once at boot with the injected `logger` + a `recordLlmCall` writer bound to `prisma`, and
  exposes the singleton to the interview module via request context.
- `backend/src/index.ts` — A01's entry point. Add the `validateProviderKeys(config)` call in
  the boot sequence (alongside the F03 env fail-fast) so a missing key aborts before
  `app.listen`, throwing with `PROVIDER_KEY_MISSING`.
- `backend/src/lib/db.ts` — F02 `prisma`. The `llm_calls` insert (`recordLlmCall`) lives on
  the backend side and is injected into the package so `@interviewly/ai` stays db-agnostic;
  it writes `provider, model, prompt_uuid, prompt_version, attempt_no, fell_back_from,
  units, unit_kind, input_tokens, output_tokens, cost_usd, latency_ms, trace_id,
  interview_id`.
- `backend/src/lib/error-codes.ts` — F01. Confirm/add `AI_PROVIDER_UNAVAILABLE`,
  `PROVIDER_KEY_MISSING`, `AI_OUTPUT_INVALID`.

  **The trap:** the budget check (I08) reads `spent_usd` *inside* the transaction that writes
  the `llm_calls` row. Keep `recordLlmCall` a plain insert that accepts an existing Prisma
  transaction handle, so I08 can wrap it. Do not open its own transaction here.

## Steps
- [x] **1. Write `cost.ts`** — price lookup, null on missing row, no throw.
- [x] **2. Write `providers.ts`** — openai + gemini clients; ordered chain; per-attempt
  timeout (15 s / 90 s); 500 ms backoff before a rate-limit fallthrough; `recordAttempt`
  inserts one `llm_calls` row and, on fallthrough, logs `LLM_FALLBACK_TRIGGERED`.
- [x] **3. Write `live-client.ts`** — build → chain → validate per method. Chain-exhausted
  transport failure → `AI_PROVIDER_UNAVAILABLE`; chain-exhausted schema failure →
  `AI_OUTPUT_INVALID`.
- [x] **4. Write `resolve-client.ts`** — `AI_ENABLED` switch + `validateProviderKeys`. Stub
  path records `cost_usd = 0` and logs `AI_DISABLED_STUB_MODE`.
- [x] **5. Write `backend/modules/ai/index.ts`** — boot-time `resolveAiClient` with the
  `recordLlmCall` writer (accepts a tx handle) + logger; expose the singleton.
- [x] **6. Wire the boot check** in `backend/src/index.ts`: `validateProviderKeys(config)`
  before `app.listen`, aborting with `PROVIDER_KEY_MISSING`.
- [x] **7. Wire acceptance step-defs** for `ai_provider.feature`: a fake tier-1 that can
  return an HTTP error / time out / be rate-limited / return invalid schema, a
  `model-prices.yaml` with and without the called model's row, and an `AI_ENABLED` toggle.
- [x] **8. Run the `## Verification` command.**

## Definition of done
- Fallthrough writes exactly two `llm_calls` rows (attempt_no 1 then 2, `fell_back_from`
  set) and logs `LLM_FALLBACK_TRIGGERED`; a tier-1 success writes exactly one.
- `cost_usd` is non-null when the price row exists, null + `PRICE_MISSING` when it does not.
- `AI_ENABLED=false` returns canned content, records one `cost_usd = 0` row, logs
  `AI_DISABLED_STUB_MODE`, and performs no key validation; `AI_ENABLED=true` with a missing
  referenced key fails boot with `PROVIDER_KEY_MISSING`.
- No provider SDK is imported outside `packages/ai/`.

## Verification
```bash
npm run -w @interviewly/ai build && npm run test:acceptance -- --tags "@ai-provider"
```

## Notes

### What exists now

Five new files in `packages/ai/src/`, two on the backend side, all exported from
`src/index.ts`:

| File | Exports |
|---|---|
| `src/cost.ts` | `costFor(prices, provider, model, usage)`, `DEFAULT_UNIT_KIND` (`'token'`), `CallCost`, `TokenUsage` |
| `src/providers.ts` | `openaiTransport`, `geminiTransport`, `DEFAULT_TRANSPORTS`, `buildChain`, `runChain`, `ProviderCallError`, `FALLBACK_STEP`, `BACKOFF_BASE_MS`, `LlmCallRecord`, `RecordLlmCall`, `ChainDeps`, `ChainStep`, `ProviderKeys`, `ProviderTransport`, `FailureKind` |
| `src/live-client.ts` | `LiveAiClient`, `parseOutput(schema)` |
| `src/resolve-client.ts` | `resolveAiClient(config, deps, opts?)`, `validateProviderKeys(config, keys, opts?)`, `AiRuntimeConfig`, `KeyValidation` |
| `src/prompt-vars.ts` | `PROMPT_NAMES`, `questionVars`/`reportVars`/`scoreVars`/`candidateVars`, `AiMethod` |
| `backend/modules/ai/index.ts` | `aiClient()` (memoised singleton), `writeLlmCall(record, tx?)`, `validateAiProviderKeys()`, `providerKeys` |
| `backend/src/index.ts` | boot gate — `validateAiProviderKeys()` before `app.listen`, `process.exit(1)` on `PROVIDER_KEY_MISSING` |

`packages/ai` still has **zero runtime dependencies beyond `yaml` and `zod`** — both
providers are plain `fetch` (ADR-I18). No SDK was added, so `npm audit` is unchanged.

Also touched: `backend/src/lib/db.ts` (`recordLlmCall` takes an optional
`Prisma.TransactionClient`), `packages/ai/config/model-prices.yaml` (`unit_kind` values are
now the db `UnitKind` enum verbatim), `packages/ai/src/stub.ts` (uses the shared
`prompt-vars` table), `cucumber.js` (`ai_provider.feature` appended to `paths`),
`.env.example` (`AI_ENABLED=false`).

### The chain, concretely

`buildChain` → `[{openai, gpt-4.1-mini} (from the prompt file, K9), {google,
gemini-2.5-flash} (fixed, B6)]`, minus any step whose provider has no key. `runChain` walks
it: `LLM_CALL_STARTED` → transport (bounded by a `Promise.race`, not by the abort alone) →
Zod validate → **record the row whatever happened** → return, or fall through.

- Failed attempts write rows too. A schema-invalid tier-1 response carries real token counts,
  so its row carries real cost — that is the whole point of per-attempt accounting.
- `LLM_FALLBACK_TRIGGERED` is logged only when a next step exists. Chain exhaustion logs
  `AI_ALL_PROVIDERS_FAILED` and throws `AI_OUTPUT_INVALID` (last failure was schema) or
  `AI_PROVIDER_UNAVAILABLE` (anything else).
- Backoff (`500 ms × 2^i`) runs before a **rate-limit** fall-through only. `ChainDeps.sleep`
  is injectable so the acceptance suite does not spend real seconds on it.
- No provider error body ever reaches a message or a log field — only the provider name and
  the HTTP status (K6).

### Deviations from this task file (all deliberate)

1. **No provider SDKs; `fetch` instead** — ADR-I18. The non-negotiable ("no provider SDK
   outside `packages/ai/`") is satisfied more strongly by importing none at all.
2. **`validateProviderKeys` hard-fails on prompt-declared providers only** — ADR-I19.
   A missing tier-2 key warns and drops the step; `ai_provider.feature` @AC-10 boots green
   with only `OPENAI_API_KEY` set, which it could not do under a chain-wide rule.
3. **The stub's `cost_usd = 0` row is written in `resolve-client.ts`, not
   `backend/modules/ai/index.ts`** — ADR-I21. The writer is injected, so the wrapper stays
   db-agnostic and `worker` gets stub-mode auditing for free.
4. **`recordLlmCall` keeps F02's own transaction and gained an optional `tx` parameter**
   rather than becoming a plain insert. F02 already writes the row and increments `spent_usd`
   atomically and returns `exhausted` — which is exactly what I08 needs; passing `tx` lets
   I08 wrap it without that logic being rebuilt here.
5. **`the HR round is generated` is one shared step and there is one World (`AiWorld`,
   renamed from `SecurityWorld`)** — ADR-I21. Cucumber has one global step registry; a second
   definition makes *both* feature files ambiguous.
6. **`the response status is 200` is modelled as "the call returned instead of throwing"** —
   I02 owns no HTTP route. The real status belongs to `profiling.feature` (I04).

### Open blocker handed to F02 (Fatih)

`llm_calls.cost_usd` is `Decimal @db.Decimal(12,6)` **NOT NULL**, but ai AC-8 requires `null`
for a model with no price row. The package contract is `number | null` and the acceptance
suite asserts it; `writeLlmCall` stores `costUsd ?? 0` until the column is widened to
`Decimal?`. `PRICE_MISSING` is logged at the same moment so nothing is silent, and every
model the repo ships today has a price row, so the path is unreachable in practice right now.
See ADR-I20 and STATE.md → Open blockers.

### For I04

- Call `aiClient()` from `backend/modules/ai`; never construct a client. It is memoised at
  first use and already carries the logger, the keys and the Prisma writer.
- `generateRoundQuestions` returns a schema-valid `QuestionBatch`; **`questions.length ===
  count` is still your check** (I01 hand-off, unchanged) — a mismatch is `AI_OUTPUT_INVALID`.
- The three errors you must map: `AI_PROVIDER_UNAVAILABLE` (503), `AI_OUTPUT_INVALID` (500),
  `AI_PROMPT_BUILD_FAILED` (500). All are `AiError` with `.code`; `httpStatusFor` in
  `src/lib/api-error.ts` already knows all three.
- Prompt variables for every method live in `packages/ai/src/prompt-vars.ts`. If a prompt file
  gains a `{{var}}`, add it there once and both clients get it.

### For I08

`recordLlmCall(data, tx)` in `backend/src/lib/db.ts` joins a transaction you open. It already
returns `{ spent_usd, budget_usd, exhausted }` post-charge, so the ceiling read never sits on
the other side of a commit from the write. `writeLlmCall` in `backend/modules/ai/index.ts`
forwards the same `tx` — thread it through `ChainDeps.recordLlmCall` when you wrap the call.

### Verification output

```
$ npm run -w @interviewly/ai build && npm run test:acceptance -- --tags "@ai-provider"
> tsc -p tsconfig.json
> cucumber-js --tags @ai-provider
......................................................................
11 scenarios (11 passed)
70 steps (70 passed)
```

Seen red first: 11 scenarios / 59 undefined steps before the step defs existed. Then
mutation-checked — forcing `fellBackFrom = null` in `runChain` turned 4 scenarios red, and
reverting turned them green again, so the fallback assertions do bite.

Gates: `npm run lint` clean, `npm run typecheck` clean, `npm test` 70 passed (9 files),
full `npm run test:acceptance` 20 scenarios passed (security 9 + ai-provider 11).
