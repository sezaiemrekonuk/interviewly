/**
 * The `voice.reconcile` processor (V04, K10). Mirrors `consumer.ts`: the job lifecycle and the
 * traceId live here, the transaction lives in `backend/modules/voice/reconcile.ts` (ADR-V04-2).
 *
 * A throw fails the BullMQ job. That is the wanted behaviour — a lost reconciliation is a
 * silently under-billed interview, so the retry is worth more than the tidy log.
 */
import type { Job } from 'bullmq';
import { reconcileVoiceUsage, type VoiceReconcileJob } from '@interviewly/backend';

import { logger } from '../lib/logger';

export async function processVoiceReconcileJob(job: Job<VoiceReconcileJob>): Promise<void> {
  const { interviewId, seconds, traceId } = job.data;

  const { reconciled } = await reconcileVoiceUsage(interviewId, seconds, { traceId });

  // Redelivery is expected, not exceptional (ElevenLabs may post twice), so the no-op is an
  // info line naming what happened rather than a warning about a job that did its job.
  logger.info(
    { traceId, interviewId, units: seconds, jobId: job.id },
    reconciled ? 'VOICE_RECONCILE_JOB_COMPLETED' : 'VOICE_RECONCILE_JOB_SKIPPED',
  );
}
