---
task: S04
author: Ahmet
sessions: [2026-08-07, 2026-08-07]
model: claude-opus-4.8
model_recommended: claude-opus-5
iterations: 1
tools: [verification-before-completion, repo-memory]
---

## Session 1 — 2026-08-07

Opus tier, as MODELS.md requires (money: a row written outside `withBudget` is a silent budget
leak every green test still passes). `claude-opus-4.8` vs the recommended `claude-opus-5` — same
tier, so the §5 tier match holds; only the point version differs.

### What I asked for / what came back
- Asked: S04 — meter every ElevenLabs call at its call site. TTS bills `character`, STT bills
  `second`, both inside `withBudget`; a failed call bills nothing; a cache hit bills nothing.
- Returned: `backend/modules/speech/metering.ts` (`meterTts`/`meterStt` → shared
  `recordLlmCall`), both call sites in `tts.ts`/`stt.ts` wrapped in `withBudget`, two new price
  rows, speech AC-5 (3 scenarios) + `metering.test.ts` (8 tests).

### Methodology trace
- spec §Cost / AC-5 → `.agents/features/speech_turn.feature` (3 @AC-5 scenarios) → red
  (`0 !== 1`: no `llm_calls` row, `spent_usd` still 0) → green (17/17 @speech)
- step 6 unit AC → `metering.test.ts` `speech/metering`: throwing provider → 0 rows;
  over-budget → provider never called, `BUDGET_EXCEEDED`, `budget_exhausted` → green (8/8)
- DB check: `llm_calls WHERE provider='elevenlabs'` groups to `tts`/`character` + `stt`/`second`
  (the `conversational` rows are pre-existing `@voice-reconciliation` residue in the shared dev DB)

### Friction
- **Task said "replace `conversational`"; the ledger says S05 deletes the convai surface to
  keep the ring green.** `voice-reconcile.steps.ts:79` still looks up `elevenlabs/conversational`,
  so removing it now reddens `@voice-reconciliation`. Kept it (marked `# S05 removes this`) and
  ADDED `tts`+`stt`. This honours the cross-cutting STATE.md rule over the task's local wording;
  the two price rows S04 actually needs are present, and the deletion lands with its consumer.
- Wrapping the provider call added a `withBudget` import to `tts.ts`/`stt.ts`, which broke their
  existing unit mocks (`withBudget: vi.fn()` returned `undefined` → destructure crash). Fixed
  both with a passthrough mock + a `./metering` mock — behaviour assertions unchanged.
- Acceptance needs Docker; native Postgres on `:5432` shadows the container (repo memory). Used
  the 15432/16380 override + explicit `DATABASE_URL`/`REDIS_URL`.
- Typecheck red only on the pre-existing `frontend` `@types/fontkit` gap (confirmed on a clean
  `git stash`); not a speech regression.

### What I rejected and rewrote by hand
- Rejected copying `reconcile.ts`'s idempotency/existence check. It defended against webhook
  redelivery; a synchronous call that returned bytes happened exactly once (ADR-S04), so an
  existence check would be dead code that only masks a double-bill bug if one ever appeared.
- Rejected metering the whole handler (the "natural refactor"): that bills TTS cache hits, which
  made no call. Kept the cache read before `withBudget` and added the cache-hit-bills-nothing
  AC-5 scenario to lock it.
- Rejected a new schema field for the per-character rate. `input_per_1m_usd` already means "USD
  per 1M units", which for `unit_kind: character` is USD per 1M characters — no `config.ts`
  change, no zod widening.
- Rejected leaving `BudgetExceeded` to bubble to a 500. Mirrored `answers.ts`: surface
  `BUDGET_EXCEEDED` (402) and end the interview `budget_exhausted` (ADR-I32 losing-safe).

## Session 2 — 2026-08-07 (review fixes)

Review of session 1 found two money bugs the whole green suite missed, both of the exact class
this task warns about — nothing asserts them, so nothing went red.

- **S04 rows silenced the convai reconciliation.** `reconcile.ts`'s redelivery no-op matched on
  `provider: 'elevenlabs'` alone. Since S04 the same interview carries `elevenlabs/tts` and
  `elevenlabs/stt` rows, so the first speech call made every later `post_call` webhook read
  "already reconciled" and bill the conversational session nothing. Both routers are mounted
  (`app.ts:59-60`) and the webhook producer is live until S05, so this was reachable in
  production today. Fix: match `model: MODEL` too. New @AC-7 scenario *A speech usage row does
  not mask the conversational session* — verified red on the old one-key `where` (`expected 1
  conversational row, got 0`), green with it.
- **Concurrent first TTS requests billed twice.** The cache read sat before `withBudget`, so two
  requests for the same uncached question both missed, serialised on the advisory lock, and both
  bought the same audio. Fix: re-read the cache INSIDE `withBudget` and move `storage.put` in
  there too, so the loser's re-read is guaranteed to see what the winner stored. A failed
  `storage.put` no longer 500s either — the bytes are already paid for, and a candidate retry
  buys them again; it now logs `SPEECH_TTS_CACHE_WRITE_FAILED` and serves them.
- Dropped `metering.ts`'s private `round6` for `roundCostUsd`, now exported from
  `packages/ai/src/cost.ts` — one rounding rule for every `Decimal(12,6)` cost, not two copies.
- Import order in `tts.ts` (`budget` before `machine`); `stt.ts` already had it right.

**Verification:** unit 486/486 (`npm test`, the 2 new metering tests included), speech unit 30/30,
default acceptance profile 104/104 incl. @speech 17/17 and @voice-reconciliation 2/2, lint clean,
`tsc --noEmit` clean but for the pre-existing frontend `@types/fontkit` gap. The `auth` profile
was NOT run: its `BeforeAll` refuses a database not named `*_test`/`ci` because it TRUNCATEs
`users` — CI runs it.

### Friction (session 2)
- Acceptance from the host also needs a throwaway Redis: `interviewly-worker-1` is attached to
  the compose Redis and dequeues `voice.reconcile` jobs before the test's own worker sees them
  (`the reconciliation job did not run`, `0 !== 1`, on scenarios that pass in CI). A
  `docker run --rm -d -p 16999:6379 redis:7-alpine` and `REDIS_URL=redis://localhost:16999`
  isolates the queue; the 15432 Postgres override from session 1 still applies.
