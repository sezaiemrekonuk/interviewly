# I02 — Provider execution: fallback chain, per-attempt `llm_calls`, cost, stub mode, key validation
REPO: (this repo) · Depends: I01 · Status: todo
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
- [ ] **1. Write `cost.ts`** — price lookup, null on missing row, no throw.
- [ ] **2. Write `providers.ts`** — openai + gemini clients; ordered chain; per-attempt
  timeout (15 s / 90 s); 500 ms backoff before a rate-limit fallthrough; `recordAttempt`
  inserts one `llm_calls` row and, on fallthrough, logs `LLM_FALLBACK_TRIGGERED`.
- [ ] **3. Write `live-client.ts`** — build → chain → validate per method. Chain-exhausted
  transport failure → `AI_PROVIDER_UNAVAILABLE`; chain-exhausted schema failure →
  `AI_OUTPUT_INVALID`.
- [ ] **4. Write `resolve-client.ts`** — `AI_ENABLED` switch + `validateProviderKeys`. Stub
  path records `cost_usd = 0` and logs `AI_DISABLED_STUB_MODE`.
- [ ] **5. Write `backend/modules/ai/index.ts`** — boot-time `resolveAiClient` with the
  `recordLlmCall` writer (accepts a tx handle) + logger; expose the singleton.
- [ ] **6. Wire the boot check** in `backend/src/index.ts`: `validateProviderKeys(config)`
  before `app.listen`, aborting with `PROVIDER_KEY_MISSING`.
- [ ] **7. Wire acceptance step-defs** for `ai_provider.feature`: a fake tier-1 that can
  return an HTTP error / time out / be rate-limited / return invalid schema, a
  `model-prices.yaml` with and without the called model's row, and an `AI_ENABLED` toggle.
- [ ] **8. Run the `## Verification` command.**

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
_(fill in when the task is done)_
