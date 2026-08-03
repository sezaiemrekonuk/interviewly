/**
 * The `INTERVIEW_STATE_CHANGED` fan-out (§8.3, I07).
 *
 * Redis pub/sub rather than an in-process emitter: `api` scales horizontally, and a room held
 * open by one replica has to see a transition another replica applied. The stream carries
 * state events only — no transcript, no question text, no secret.
 */
import type { InterviewState } from '@prisma/client';
import type { RequestHandler } from 'express';

import { redis } from '../auth/rate-limit';
import { logger } from '../../src/lib/logger';
import { REPORT_QUEUE, reportQueue } from '../../src/lib/queue';

export const EVENT_CHANNEL_PREFIX = 'interview:events:';

export interface InterviewStateChanged {
  from: InterviewState;
  to: InterviewState;
  interviewId: string;
}

export function eventChannel(interviewId: string): string {
  return `${EVENT_CHANNEL_PREFIX}${interviewId}`;
}

/** Called by `applyTransition` only — publishing anywhere else fakes a state change. */
export async function publishStateChanged(event: InterviewStateChanged): Promise<void> {
  await redis.publish(eventChannel(event.interviewId), JSON.stringify(event));
}

/**
 * The emission point for `→ evaluating` (R01). `jobId = interviewId` is the idempotency key:
 * BullMQ refuses a second `add` for a job id it already knows, so re-entering `evaluating`
 * for the same interview enqueues no second job (AC-20) without a bespoke dedupe table.
 */
export async function enqueueReport(interviewId: string, ctx: { traceId: string }): Promise<void> {
  await reportQueue.add(REPORT_QUEUE, { interviewId }, { jobId: interviewId });
  logger.info({ traceId: ctx.traceId, interviewId }, 'REPORT_JOB_ENQUEUED');
}

/**
 * `GET /interviews/:id/events` — behind `requireAuth` and `router.param('id', resolveInterview)`,
 * so a non-owner is 404 `INTERVIEW_NOT_FOUND` and never reaches this handler.
 */
export const streamInterviewEvents: RequestHandler = async (req, res) => {
  const channel = eventChannel(req.interview!.id);

  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
    // Caddy buffers a proxied response by default, which holds every event back until the
    // stream closes — the one deployment detail that makes SSE look broken rather than slow.
    'X-Accel-Buffering': 'no',
  });
  res.flushHeaders();

  // ponytail: one Redis connection per open stream. ioredis puts a connection into subscriber
  // mode exclusively, so the shared client cannot carry this, and a single shared subscriber
  // would need an in-process channel → response map plus refcounted unsubscribe. Build that
  // the day concurrent rooms outgrow the connection pool.
  const subscriber = redis.duplicate();
  subscriber.on('message', (_channel, payload) => {
    // `quit()` below is async, so a message can still land between the disconnect and the
    // connection actually closing — writing it would be ERR_STREAM_WRITE_AFTER_END.
    if (res.writableEnded) return;
    res.write(`event: INTERVIEW_STATE_CHANGED\ndata: ${payload}\n\n`);
  });
  await subscriber.subscribe(channel);

  res.on('close', () => {
    res.end();
    void subscriber.quit();
  });
};

export default streamInterviewEvents;
