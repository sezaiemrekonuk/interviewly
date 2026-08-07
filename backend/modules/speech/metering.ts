/**
 * Per-call usage accounting for the two ElevenLabs speech calls (S04, §7.3, K13, speech spec
 * Cost). Each provider call that returns bytes writes one `llm_calls` row and increments
 * `spent_usd` in ONE transaction, through `recordLlmCall` — the same atomicity the AI path
 * and the retired `voice/reconcile.ts` use. Called from inside `withBudget` at the call site,
 * so a call the budget already refused never reaches here and a provider error bills nothing.
 *
 * No idempotency key, no existence check: a synchronous call that returned bytes happened
 * exactly once (ADR-S04). That is the whole difference from `reconcile.ts`, which defended
 * against webhook redelivery that no longer occurs.
 */
import { loadModelPrices, roundCostUsd } from '@interviewly/ai';

import { recordLlmCall } from '../../src/lib/db';
import { logger } from '../../src/lib/logger';

const PROVIDER = 'elevenlabs';

// Frozen at load: re-reading per call would put a synchronous disk read inside the budget
// transaction. A price edit takes effect on restart, exactly like every other price row.
const prices = loadModelPrices();

/**
 * USD for `characters` of TTS. `undefined` price is not an error (ai AC-8): null → 0, logged.
 * `roundCostUsd` is the shared `Decimal(12,6)` rounding — same one `costFor` prices tokens
 * with, so the logged, returned and stored numbers stay equal here too.
 */
function ttsCostUsd(characters: number): number | null {
  const price = prices.lookup(PROVIDER, 'tts');
  if (price === undefined) return null;
  return roundCostUsd((characters / 1_000_000) * price.input_per_1m_usd);
}

/** USD for `seconds` of STT. `per_minute_usd / 60` is the per-second rate. */
function sttCostUsd(seconds: number): number | null {
  const price = prices.lookup(PROVIDER, 'stt');
  if (price?.per_minute_usd === undefined) return null;
  return roundCostUsd((seconds * price.per_minute_usd) / 60);
}

async function meter(
  interviewId: string,
  model: 'tts' | 'stt',
  unitKind: 'character' | 'second',
  units: number,
  costUsd: number | null,
  traceId: string,
): Promise<void> {
  if (costUsd === null) {
    logger.warn({ traceId, interviewId, provider: PROVIDER, model }, 'PRICE_MISSING');
  }
  await recordLlmCall({
    interview_id: interviewId,
    provider: PROVIDER,
    model,
    // No prompt was compiled and no attempt chain ran: this row is metered usage, not an LLM
    // attempt. These columns are NOT NULL in F02, so they carry the empty/first value.
    prompt_uuid: '',
    prompt_version: 0,
    attempt_no: 1,
    units,
    unit_kind: unitKind,
    // F02 keeps `cost_usd` NOT NULL while the spec asks for null on a missing price; stored as
    // 0 charging nothing, with the `PRICE_MISSING` warning above keeping that from being silent.
    cost_usd: costUsd ?? 0,
    latency_ms: 0,
    trace_id: traceId,
  });
}

export function meterTts(interviewId: string, characters: number, traceId: string): Promise<void> {
  return meter(interviewId, 'tts', 'character', characters, ttsCostUsd(characters), traceId);
}

export function meterStt(interviewId: string, seconds: number, traceId: string): Promise<void> {
  return meter(interviewId, 'stt', 'second', seconds, sttCostUsd(seconds), traceId);
}
