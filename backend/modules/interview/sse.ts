/**
 * The interview event fan-out (§8.3, I07).
 *
 * Redis pub/sub rather than an in-process emitter: `api` scales horizontally, and a room held
 * open by one replica has to see a transition another replica applied. The stream carries
 * state events only — no transcript, no question text, no secret.
 */
import type { RoundType } from '@interviewly/ai';
import type { InterviewState } from '@prisma/client';
import type { RequestHandler, Response } from 'express';

import { redis } from '../auth/rate-limit';
import { logger } from '../../src/lib/logger';
import { REPORT_QUEUE, reportQueue } from '../../src/lib/queue';

export const EVENT_CHANNEL_PREFIX = 'interview:events:';

/**
 * SSE keep-alive. A comment frame — clients drop `:` lines without dispatching an event, so
 * this is invisible to `use-interview-events.ts` and cannot be mistaken for a state change.
 *
 * 25s so at least one lands inside any 30s idle window: the edge relies on Caddy's defaults
 * today (`Caddyfile` sets no read timeout), and every NAT between it and the browser has its
 * own. Exported so the test asserts the same number the handler writes.
 */
export const HEARTBEAT_MS = 25_000;
export const HEARTBEAT_FRAME = ': ping\n\n';

export const STATE_CHANGED = 'INTERVIEW_STATE_CHANGED';
/**
 * The second event, and the reason there is a `type` on the wire at all.
 *
 * A state change is not the moment a room becomes answerable: `POST /profile` claims
 * `profiling → hr_round` *before* it calls the model (the claim is what makes concurrent
 * requests safe), so the state event reaches a client whose refetch still finds
 * `currentQuestion: null`. Questions appearing is not a state change — `applyTransition` is the
 * sole publisher of those — so it needs an event of its own rather than a faked transition.
 */
export const QUESTIONS_READY = 'INTERVIEW_QUESTIONS_READY';

export interface InterviewStateChanged {
  from: InterviewState;
  to: InterviewState;
  interviewId: string;
}

export interface InterviewQuestionsReady {
  type: typeof QUESTIONS_READY;
  interviewId: string;
  roundType: RoundType;
}

export function eventChannel(interviewId: string): string {
  return `${EVENT_CHANNEL_PREFIX}${interviewId}`;
}

/**
 * The channel carries both events, so the name is read back off the payload.
 *
 * Untyped payloads are state changes: that is every message published before this field
 * existed, including the ones a mid-deploy replica is still writing while a new one reads.
 * A payload that does not parse cannot be classified either, and naming it the event every
 * client already handles keeps a malformed message a refetch rather than a dropped nudge.
 */
export function eventNameFor(payload: string): string {
  try {
    const parsed = JSON.parse(payload) as { type?: unknown };
    return parsed?.type === QUESTIONS_READY ? QUESTIONS_READY : STATE_CHANGED;
  } catch {
    return STATE_CHANGED;
  }
}

/** Called by `applyTransition` only — publishing anywhere else fakes a state change. */
export async function publishStateChanged(event: InterviewStateChanged): Promise<void> {
  await redis.publish(eventChannel(event.interviewId), JSON.stringify(event));
}

/**
 * Called by `generateRound` once the batch is committed — never before, or the client refetches
 * into the same empty room the state event already showed it.
 *
 * Swallows its own failure, for the reason `applyTransition` wraps its publish: the questions
 * are already written, and a Redis outage must not turn a generated round into a failed request.
 * The room falls back to reconstructing from `GET /state` on the candidate's next move.
 */
export async function publishQuestionsReady(event: InterviewQuestionsReady): Promise<void> {
  try {
    await redis.publish(eventChannel(event.interviewId), JSON.stringify(event));
  } catch (err) {
    logger.error(
      { err, interviewId: event.interviewId, roundType: event.roundType },
      'INTERVIEW_EVENT_PUBLISH_FAILED',
    );
  }
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
 * Every open stream, so a shutdown can end them (#70).
 *
 * `server.close()` stops accepting connections and then waits for the responses still in
 * flight — and an SSE response is in flight until the client goes away, which on a deploy it
 * has no reason to do. Without this the drain never completes on its own and every stop runs
 * out the hard timeout instead.
 */
const openStreams = new Set<Response>();

/** Ends every open stream. EventSource reconnects, so a client lands on the next replica. */
export function closeEventStreams(): void {
  for (const res of openStreams) res.end();
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
  const subscriber = redis.duplicate();

  // A quiet stream is the normal case — an interview sits between questions for minutes — and
  // silence is indistinguishable from a dead connection to every proxy and NAT on the path.
  // A comment frame is the SSE keep-alive: clients ignore `:` lines, so this costs the room
  // nothing and gives intermediaries a reason not to reap the socket.
  const heartbeat = setInterval(() => {
    if (res.destroyed || res.writableEnded) return;
    res.write(HEARTBEAT_FRAME);
  }, HEARTBEAT_MS);
  // The response outlives the request by design; an unref'd timer must not be what keeps the
  // process alive during a drain (#70).
  heartbeat.unref();

  let closed = false;
  const cleanup = () => {
    if (closed) return;
    closed = true;
    clearInterval(heartbeat);
    openStreams.delete(res);
    if (!res.destroyed && !res.writableEnded) res.end();
    void subscriber.quit();
  };
  res.once('close', cleanup);
  openStreams.add(res);

  // ponytail: one Redis connection per open stream. ioredis puts a connection into subscriber
  // mode exclusively, so the shared client cannot carry this, and a single shared subscriber
  // would need an in-process channel → response map plus refcounted unsubscribe. Build that
  // the day concurrent rooms outgrow the connection pool.
  subscriber.on('message', (_channel, payload) => {
    // `quit()` below is async, so a message can still land between the disconnect and the
    // connection actually closing — writing it would be ERR_STREAM_WRITE_AFTER_END.
    if (res.destroyed || res.writableEnded) return;
    res.write(`event: ${eventNameFor(payload)}\ndata: ${payload}\n\n`);
  });
  try {
    await subscriber.subscribe(channel);
  } catch (err) {
    if (closed) return;
    cleanup();
    throw err;
  }
};

export default streamInterviewEvents;
