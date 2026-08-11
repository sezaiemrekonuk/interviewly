/**
 * T02. Where a candidate's unfinished thought waits between one pause and the next.
 *
 * Not durable and not the conversation (ADR-T02): a fragment lives here only until the next
 * upload joins it or the TTL drops it. Every function is total — Redis unreachable means
 * "nothing held", never a failed turn.
 */
import { logger } from '../../src/lib/logger';
import { redis } from '../auth/rate-limit';

/** T03 imports both caps rather than restating them; a client-sent counter is not a cap. */
export const MAX_PROBES_PER_TURN = 8;
export const MAX_PENDING_CHARS = 6_000;
export const PENDING_TURN_TTL_SECONDS = 300;

export interface PendingTurn {
  text: string;
  /** The question the fragment was spoken against. A take across a boundary must not join. */
  questionId: string;
  probes: number;
}

/** Server-derived: `interviewId` comes from the route param after the ownership guard. */
const keyFor = (interviewId: string): string => `interview:${interviewId}:pending-turn`;

function parse(raw: string, interviewId: string): PendingTurn | null {
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    value = null;
  }
  if (
    typeof value !== 'object' ||
    value === null ||
    typeof (value as PendingTurn).text !== 'string' ||
    typeof (value as PendingTurn).questionId !== 'string' ||
    !Number.isFinite((value as PendingTurn).probes)
  ) {
    logger.warn({ interviewId, chars: raw.length }, 'PENDING_TURN_MALFORMED');
    return null;
  }
  const { text, questionId, probes } = value as PendingTurn;
  return { text, questionId, probes };
}

/**
 * One round trip. A `GET` then a separate `DEL` lets two racing uploads both read the same
 * partial and submit the candidate's sentence twice. `MULTI` over `GETDEL` because the latter
 * needs Redis ≥ 6.2.
 */
export async function takePendingTurn(interviewId: string): Promise<PendingTurn | null> {
  const key = keyFor(interviewId);
  let raw: unknown;
  try {
    // exec() → array of [err, value] tuples; `get` is the first command, null if aborted.
    const results = await redis.multi().get(key).del(key).exec();
    const [err, value] = results?.[0] ?? [];
    if (err) throw err;
    raw = value;
  } catch (error) {
    logger.warn({ interviewId, err: error }, 'PENDING_TURN_UNAVAILABLE');
    return null;
  }
  if (typeof raw !== 'string') return null;

  const held = parse(raw, interviewId);
  if (held) {
    logger.debug(
      { interviewId, chars: held.text.length, probes: held.probes },
      'PENDING_TURN_TAKEN',
    );
  }
  return held;
}

/**
 * T03's `/state` read. A state read never consumes: the room refetches on every render and on
 * every reconnect, and a `GET` that took the partial would delete the candidate's own sentence
 * the first time they refreshed the page.
 */
export async function peekPendingTurn(interviewId: string): Promise<PendingTurn | null> {
  let raw: string | null;
  try {
    raw = await redis.get(keyFor(interviewId));
  } catch (error) {
    logger.warn({ interviewId, err: error }, 'PENDING_TURN_UNAVAILABLE');
    return null;
  }
  return raw === null ? null : parse(raw, interviewId);
}

/** TTL on every write, not only the first — a re-held fragment must not outlive the turn. */
export async function holdPendingTurn(interviewId: string, value: PendingTurn): Promise<void> {
  try {
    await redis.set(
      keyFor(interviewId),
      JSON.stringify(value),
      'EX',
      PENDING_TURN_TTL_SECONDS,
    );
  } catch (error) {
    logger.warn({ interviewId, err: error }, 'PENDING_TURN_UNAVAILABLE');
    return;
  }
  logger.debug(
    { interviewId, chars: value.text.length, probes: value.probes },
    'PENDING_TURN_HELD',
  );
}

/** For the callers that must discard rather than consume. */
export async function dropPendingTurn(interviewId: string): Promise<void> {
  try {
    await redis.del(keyFor(interviewId));
  } catch (error) {
    logger.warn({ interviewId, err: error }, 'PENDING_TURN_UNAVAILABLE');
  }
}
