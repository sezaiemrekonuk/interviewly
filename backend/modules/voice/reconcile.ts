/**
 * Post-call usage reconciliation (§7.3, K13, ADR-V04) — the cost invariant of the voice path.
 *
 * Lives in `backend` rather than in `worker/src/jobs/` (ADR-V04-2): the transaction below IS
 * the thing `voice_reconciliation.feature` asserts, and cucumber runs against backend source
 * only — a copy in `worker/` would leave the acceptance ring asserting a mirror of the
 * invariant instead of the invariant. `worker/src/jobs/voice-reconcile.ts` is the BullMQ
 * processor that calls this, exactly as `consumer.ts` calls `runReport`.
 */
import { loadModelPrices } from '@interviewly/ai';

import { prisma, recordLlmCall } from '../../src/lib/db';
import { logger } from '../../src/lib/logger';

/** The one price row voice bills against (`model-prices.yaml`, §9.2). */
const PROVIDER = 'elevenlabs';
const MODEL = 'conversational';

// Loaded once: the file is frozen at call time by design, and re-reading it per job would
// put a synchronous disk read inside the transaction.
const prices = loadModelPrices();

export interface ReconcileOpts {
  traceId: string;
}

export interface ReconcileResult {
  /** false when an `elevenlabs/conversational` row already existed — the redelivery no-op (K10). */
  reconciled: boolean;
}

/**
 * `cost_usd` for `seconds` of conversational voice. `per_minute_usd / 60` is the per-second
 * rate; the price row's absence is not an error (ai AC-8) — see the `?? 0` note below.
 */
function voiceCostUsd(seconds: number): number | null {
  const price = prices.lookup(PROVIDER, MODEL);
  if (price?.per_minute_usd === undefined) return null;
  // Decimal(12,6) in F02; rounding here keeps the logged, returned and stored numbers equal.
  return Math.round((seconds * price.per_minute_usd * 1_000_000) / 60) / 1_000_000;
}

/**
 * Writes the voice usage row and charges it to the interview in ONE transaction, once.
 *
 * The existence check runs INSIDE the transaction on purpose: ElevenLabs may deliver the
 * post-call webhook more than once, and checking outside reopens the double-write race the
 * redelivery causes — two jobs would both read "no row" and both insert.
 *
 * It matches on `model` as well as `provider`: since S04 the same interview also carries
 * `elevenlabs/tts` and `elevenlabs/stt` rows from the speech path, and a provider-only match
 * would read one of those as "already reconciled" and silently bill the conversational
 * session nothing. Only a `conversational` row is this job's own redelivery.
 */
export async function reconcileVoiceUsage(
  interviewId: string,
  seconds: number,
  opts: ReconcileOpts,
): Promise<ReconcileResult> {
  const costUsd = voiceCostUsd(seconds);
  if (costUsd === null) {
    logger.warn({ traceId: opts.traceId, interviewId, provider: PROVIDER }, 'PRICE_MISSING');
  }

  const result = await prisma.$transaction(async (tx) => {
    const existing = await tx.llmCall.findFirst({
      where: { interview_id: interviewId, provider: PROVIDER, model: MODEL },
      select: { id: true },
    });
    if (existing) return null;

    return recordLlmCall(
      {
        interview_id: interviewId,
        provider: PROVIDER,
        model: MODEL,
        // No prompt was compiled and no attempt chain ran: this row is metered usage, not an
        // LLM attempt. The columns are NOT NULL in F02, so they carry the empty/first value
        // rather than a lie about a prompt that never existed.
        prompt_uuid: '',
        prompt_version: 0,
        attempt_no: 1,
        units: seconds,
        unit_kind: 'second',
        // Same F02 constraint I02 hit (`modules/ai/index.ts`): `cost_usd` is NOT NULL while
        // the spec asks for null on a missing price. Stored as 0, charging nothing; the
        // `PRICE_MISSING` warning above is what keeps that from being silent.
        cost_usd: costUsd ?? 0,
        latency_ms: 0,
        trace_id: opts.traceId,
      },
      tx,
    );
  });

  if (!result) return { reconciled: false };

  logger.info(
    {
      traceId: opts.traceId,
      interviewId,
      units: seconds,
      spentUsd: result.spent_usd.toString(),
    },
    'VOICE_USAGE_RECONCILED',
  );
  return { reconciled: true };
}
