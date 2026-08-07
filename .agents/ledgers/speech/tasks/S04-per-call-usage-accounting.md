# S04 — Per-call usage accounting at both provider call sites
REPO: (this repo) · Depends: S02, S03, I08 · Status: todo
Read first: STATE.md, REFERENCE.md, then this.
**Model: claude-opus-5** — money. The insert and the increment must share one transaction, the
units must be the right kind for the right call, and a failed provider call must bill nothing.
A row written outside `withBudget` is a silent budget leak that every green test still passes.

## Goal
Owner's ask:

> "Her mülakatın maliyeti görünsün, bütçe aşılmasın."
> — IDEA.md §7.3, K13; speech spec *Cost*, ADR-S04

Every ElevenLabs call is metered where it happens: TTS bills characters, STT bills seconds, both
inside the transaction that guards `spent_usd`. Replaces V04's post-call reconciliation, which
existed only to survive webhook redelivery that no longer occurs.

## Security boundaries
- **A provider error bills nothing.** The `llm_calls` insert happens after the call returns
  bytes, inside the same transaction. An exception rolls both back.
- **No usage row without an interview.** `interview_id` is NOT NULL in F02; the metering row is
  charged to the interview that made the call, never to a shared bucket.

## Non-negotiables
- **One transaction.** `recordLlmCall` and the `spent_usd` increment share it, exactly as
  `modules/ai/index.ts` and the retired `modules/voice/reconcile.ts:60-90` do. Two statements in
  two transactions is a budget that can be exceeded by a crash.
- **`withBudget` wraps the provider call, not just the write.** I08's contract is that an
  interview already over budget never makes the call. Metering after the fact is not enforcement.
- **The right unit for the right call.** TTS `unit_kind='character'`, `model='tts'`; STT
  `unit_kind='second'`, `model='stt'`. Both `provider='elevenlabs'`. `UnitKind` already has both
  values (F02) — no enum migration, and if you find yourself wanting one, re-read ADR-S04.
- **A cache hit bills nothing** (S02). It made no call.
- **No idempotency key, no existence check.** V04 needed those because a webhook could be
  redelivered. A synchronous call that returned bytes happened exactly once.

## Context (anchors)
- `backend/modules/interview/budget.ts:37` — `withBudget(interviewId, fn)`: advisory lock,
  exhaustion check, then `fn`. The wrapper both call sites use.
- `backend/src/lib/db.ts` — `recordLlmCall(...)`, the insert helper.
- `backend/modules/voice/reconcile.ts:36-90` — the price lookup and the NOT-NULL column handling
  (`prompt_uuid: ''`, `prompt_version: 0`, `attempt_no: 1`) for a row that is metered usage
  rather than an LLM attempt. **Copy the reasoning, not the file** — S05 deletes it.
- `packages/ai/config/model-prices.yaml:23-26` — the `elevenlabs/conversational` row to replace
  with `elevenlabs/tts` (per-character) and `elevenlabs/stt` (per-second). A missing price row
  is a `PRICE_MISSING` log, not an error (ai AC-8) — keep that behaviour.
- `backend/modules/speech/tts.ts`, `stt.ts` — the two call sites from S02/S03.

## Steps
- [x] **1. Feature scenario red** — speech AC-5: one TTS call writes one `character` row and one
  STT call one `second` row, each with `spent_usd` incremented in the same transaction. See it
  red.
- [x] **2. Price rows** — split `elevenlabs/conversational` into `elevenlabs/tts` and
  `elevenlabs/stt` in `model-prices.yaml`, with the per-character and per-second rates.
- [x] **3. Wrap the TTS call** in `withBudget`; on success insert the `character` row and
  increment inside the same transaction.
- [x] **4. Wrap the STT call** the same way with the `second` row.
- [x] **5. Cache hit bills nothing** — assert it, because the natural refactor is to put the
  metering around the whole handler.
- [x] **6. Unit test** — a throwing provider leaves zero `llm_calls` rows and `spent_usd`
  unchanged; an interview already at its budget makes no provider call at all.

## Definition of done
- speech AC-5 green.
- A failed provider call leaves no `llm_calls` row and no `spent_usd` change.
- An over-budget interview never reaches ElevenLabs.
- `admin/stats` cost aggregation (N02) shows ElevenLabs usage split by `tts` and `stt` without
  any change to that module.

## Verification
```bash
npm test -- --project node speech/metering
npm run test:acceptance -- --tags "@speech"
psql "$DATABASE_URL" -c "SELECT provider, model, unit_kind, count(*), sum(cost_usd) FROM llm_calls WHERE provider='elevenlabs' GROUP BY 1,2,3;"
```
Expected: tests green; the query shows exactly two ElevenLabs rows shapes — `tts`/`character`
and `stt`/`second` — and no `conversational`/`second` row.

## Notes
Landed 2026-08-07.

- **New file** `backend/modules/speech/metering.ts`: `meterTts`/`meterStt`. Each calls the
  shared `recordLlmCall` (insert + `spent_usd` increment in one tx). NOT-NULL columns carry
  `prompt_uuid:''`, `prompt_version:0`, `attempt_no:1` (reconcile.ts reasoning, not its file).
  Prices loaded once at module load. Missing price → `PRICE_MISSING` warn + `cost_usd:0`.
- **Wrapping** (tts.ts / stt.ts): `withBudget(interview.id, async () => { const r = await
  provider.call(); await meter(...); return r; })`. Mirrors the AI path — the advisory lock is
  held across the provider call AND the metering commit, so an over-budget interview never
  reaches ElevenLabs and a concurrent call reads the charged total. `meter` never runs if the
  provider throws → a failed call bills nothing. TTS cache hit is BEFORE `withBudget` → free.
- **BudgetExceeded** now surfaces `BUDGET_EXCEEDED` (402) from both routes and ends the
  interview `budget_exhausted` (ADR-I32 losing-transition-safe), mirroring `answers.ts`.
- **`model-prices.yaml`:** ADDED `elevenlabs/tts` (per-1M-char via `input_per_1m_usd:180.00`)
  and `elevenlabs/stt` (`per_minute_usd:0.006667`). **KEPT `elevenlabs/conversational`** rather
  than removing it: `voice-reconcile.steps.ts:79` still looks it up, and STATE.md is explicit
  that **S05** (not S04) deletes the convai/reconcile surface to keep the acceptance ring green.
  Marked it `# S05 removes this`. Rates are placeholders subject to the file's pre-demo re-check.
- **Tests:** `metering.test.ts` (verification filter `speech/metering`) — pure meter shape/cost
  + route tests for throwing-provider-bills-nothing and over-budget-no-call, both routes.
  `tts.test.ts`/`stt.test.ts` gained a `withBudget` passthrough + `./metering` mock (the wrap
  added a dependency; behaviour assertions unchanged).
- **Verification:** metering 8/8, all speech unit 28/28, `@speech` acceptance 17/17, full unit
  484/484, lint clean. psql shows `tts`/`character` + `stt`/`second`; the `conversational` rows
  in the shared dev DB are pre-existing `@voice-reconciliation` residue, not from this run.
- **Review pass (same day).** Two money bugs no test covered, both fixed here:
  1. `reconcile.ts`'s redelivery no-op matched `provider: 'elevenlabs'` only, so the first
     speech row on an interview made every later `post_call` webhook bill the convai session
     nothing. Now matches `model: 'conversational'` too; new @AC-7 scenario in
     `voice_reconciliation.feature`, verified red without the fix. S05 deletes this whole
     surface, but both routers are mounted today.
  2. Two concurrent first TTS requests for one question both missed the pre-lock cache read and
     both paid. The cache is now re-read INSIDE `withBudget`, with `storage.put` moved under the
     lock so the loser's re-read sees the winner's write. A failing `storage.put` serves the
     already-paid bytes and logs `SPEECH_TTS_CACHE_WRITE_FAILED` instead of 500ing into a
     re-billed retry.
  Also: `round6` replaced by `roundCostUsd`, exported from `packages/ai/src/cost.ts`.
  Re-verified: unit 486/486, acceptance 104/104 (@speech 17/17, @voice-reconciliation 2/2).
- **Next (S05):** delete `elevenlabs/conversational`, `reconcile.ts`, the webhook/convai
  surface, and prove `isPastCeiling`/`time_exhausted` still fires after its gate is gone.
