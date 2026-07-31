/**
 * The api-side binding for `@interviewly/ai`. The package is shared by `api` and `worker`
 * (K1) and depends on neither, so the two things it cannot reach — Prisma and the env — are
 * injected here, once, at boot.
 *
 * Nothing in the interview module constructs an `AiClient` of its own; it calls `aiClient()`
 * and gets whichever implementation `AI_ENABLED` resolved to.
 */
import type { Prisma } from '@prisma/client';
import {
  resolveAiClient,
  validateProviderKeys,
  type AiClient,
  type KeyValidation,
  type LlmCallRecord,
  type ProviderKeys,
} from '@interviewly/ai';

import { recordLlmCall as chargeLlmCall } from '../../src/lib/db';
import { config } from '../../src/lib/env';
import { logger } from '../../src/lib/logger';

/**
 * Keyed by the provider name a prompt file (or the chain) uses, not by the env variable —
 * `google` is what `gemini-2.5-flash` is published under and what the price file says.
 */
export const providerKeys: ProviderKeys = {
  openai: config.OPENAI_API_KEY,
  google: config.GEMINI_API_KEY,
};

/**
 * Turns the package's finished row into the F02 insert, inside the transaction that also
 * charges `spent_usd`. `tx` stays open to the caller so I08 can wrap the budget read around
 * it rather than reading a total that a concurrent call has already invalidated.
 */
export async function writeLlmCall(
  record: LlmCallRecord,
  tx?: Prisma.TransactionClient,
): Promise<void> {
  await chargeLlmCall(
    {
      interview_id: record.interviewId,
      provider: record.provider,
      model: record.model,
      prompt_uuid: record.promptUuid,
      prompt_version: record.promptVersion,
      attempt_no: record.attemptNo,
      fell_back_from: record.fellBackFrom,
      units: record.units,
      unit_kind: record.unitKind as Prisma.LlmCallUncheckedCreateInput['unit_kind'],
      input_tokens: record.inputTokens,
      output_tokens: record.outputTokens,
      // `llm_calls.cost_usd` is NOT NULL in the F02 schema while the spec asks for null on a
      // missing price row (ai AC-8). Until F02 widens the column, an unknown price is stored
      // as 0 and charges nothing — the `PRICE_MISSING` log emitted at the same moment is
      // what keeps it from being silent. Tracked in the interview-core STATE.md blockers.
      cost_usd: record.costUsd ?? 0,
      latency_ms: record.latencyMs,
      trace_id: record.traceId,
    },
    tx,
  );
}

let client: AiClient | undefined;

/** Resolved once. `AI_ENABLED=false` gives the stub; either way every attempt is audited. */
export function aiClient(): AiClient {
  client ??= resolveAiClient(config, {
    recordLlmCall: writeLlmCall,
    keys: providerKeys,
    logger,
  });
  return client;
}

/** B7 boot gate. Throws `PROVIDER_KEY_MISSING` before `app.listen` ever runs. */
export function validateAiProviderKeys(): KeyValidation {
  return validateProviderKeys(config, providerKeys, { logger });
}
