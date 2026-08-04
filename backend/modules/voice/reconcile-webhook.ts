/**
 * `POST /webhooks/elevenlabs/post_call` — the post-call usage webhook (V04, ADR-V04).
 *
 * Gates 1–2 only. This webhook legitimately arrives AFTER the session is consumed, so gate 3's
 * unexpired-unconsumed lookup would reject every well-formed delivery; the HMAC over the raw
 * body is what authorises it, and `interviewId` is only an identifier once the signature holds.
 *
 * Mounted ahead of `webhook-router` in app.ts — that router's `/:action` would otherwise
 * swallow `post_call` and answer `VALIDATION_ERROR`.
 *
 * No DB write happens here (K10): the request is verified, enqueued and answered 202. The
 * transaction is `modules/voice/reconcile.ts`, run by `worker`.
 */
import { Router, type RequestHandler } from 'express';

import { ApiError } from '../../src/lib/api-error';
import { logger } from '../../src/lib/logger';
import { VOICE_RECONCILE_QUEUE, voiceReconcileQueue } from '../../src/lib/queue';

import {
  SIGNATURE_HEADER,
  TIMESTAMP_HEADER,
  checkFreshness,
  verifySignature,
} from './webhook-auth';

export interface VoiceReconcileJob {
  interviewId: string;
  seconds: number;
  traceId: string;
}

export const handlePostCallWebhook: RequestHandler = async (req, res) => {
  const traceId = req.traceId!;
  const claimedId = typeof req.body?.interviewId === 'string' ? req.body.interviewId : undefined;

  if (!verifySignature(req.rawBody ?? Buffer.alloc(0), req.headers[SIGNATURE_HEADER])) {
    logger.warn({ traceId, interviewId: claimedId }, 'WEBHOOK_SIGNATURE_INVALID');
    throw new ApiError('WEBHOOK_SIGNATURE_INVALID');
  }
  if (!checkFreshness(req.headers[TIMESTAMP_HEADER])) {
    logger.warn({ traceId, interviewId: claimedId }, 'WEBHOOK_REPLAY_REJECTED');
    throw new ApiError('WEBHOOK_REPLAY_REJECTED');
  }

  const seconds = Number(req.body?.seconds);
  if (!claimedId || !Number.isFinite(seconds) || seconds < 0) {
    throw new ApiError('VALIDATION_ERROR');
  }

  // `jobId` is the first idempotency layer — it drops a redelivery that arrives while the
  // first job is still queued. It is NOT the guarantee: `removeOnComplete` frees the id, so a
  // later redelivery does run, and the in-transaction existence check is what no-ops it (K10).
  await voiceReconcileQueue.add(
    VOICE_RECONCILE_QUEUE,
    { interviewId: claimedId, seconds, traceId } satisfies VoiceReconcileJob,
    { jobId: claimedId, removeOnComplete: true },
  );

  logger.info({ traceId, interviewId: claimedId, units: seconds }, 'VOICE_POST_CALL_RECEIVED');
  res.status(202).json({ status: 'queued' });
};

const router = Router();
router.post('/post_call', handlePostCallWebhook);

export default router;
