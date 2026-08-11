/**
 * I16 — active time: how long the candidate has actually been in the room, as opposed to how
 * long ago the interview started.
 *
 * The clock this replaced was `now - started_at`, which is a stopwatch nobody can stop. Leaving
 * the room and coming back an hour later showed 1:03:00 for three minutes of interview, and
 * because `speechExpiresAt` was derived from the same anchor, a voice interview was simply over
 * by the time the candidate returned to it.
 *
 * The model here is a bank plus one open stretch. `elapsed_seconds` holds the time closed room
 * sessions contributed; `last_seen_at` anchors the session that is still open, and the room's
 * heartbeat advances it. Active time is the bank plus however long the open stretch has run.
 *
 * **The gap is what decides whether a stretch is open.** There is no "left the room" event to
 * rely on — a closed tab, a killed browser and a laptop lid send nothing — so the server infers
 * it: a heartbeat that arrives within `HEARTBEAT_GRACE_SECONDS` of the last one continues the
 * stretch, and one that arrives after it starts a new one and the gap is not counted. Absence is
 * the signal, which is the only signal that survives the client vanishing.
 */
import { clock } from '../../src/lib/clock';
import { prisma } from '../../src/lib/db';

/**
 * How long a silence may run before the room is presumed empty. Comfortably more than the
 * client's `ROOM_HEARTBEAT_MS` (15 s) so an ordinary late beat — a slow request, a GC pause, a
 * few dropped frames of event loop — continues the stretch rather than silently forfeiting the
 * time. The cost of it being too generous is bounded and small: at most this many seconds of
 * absence get counted as presence, once per departure.
 */
export const HEARTBEAT_GRACE_SECONDS = 30;

/** The timing columns the arithmetic reads. An `Interview` satisfies it; a test fixture need not. */
export interface ActiveTimed {
  started_at: Date | null;
  elapsed_seconds: number;
  last_seen_at: Date | null;
}

/**
 * Seconds the currently-open room session has run, or 0 if there is no open session.
 *
 * A gap past the grace window returns 0 rather than the gap: the candidate was away, and that
 * time belongs to nobody. It stays 0 until the next heartbeat re-anchors `last_seen_at`, so a
 * room reopened after an hour reads exactly the bank until its first beat lands.
 */
function openStretchMs(interview: ActiveTimed, now: Date): number {
  if (!interview.last_seen_at) return 0;
  const gap = now.getTime() - interview.last_seen_at.getTime();
  if (gap <= 0) return 0;
  return gap <= HEARTBEAT_GRACE_SECONDS * 1000 ? gap : 0;
}

/**
 * Total active time in milliseconds. This is the one arithmetic: the room renders it,
 * `speechExpiresAt` counts down to it and `isPastSpeechCeiling` refuses on it, so a rendered
 * countdown and a `VOICE_SESSION_EXPIRED` cannot name different times.
 *
 * Milliseconds rather than seconds so the ceiling can be an exact instant. Seconds would put a
 * divide and a multiply between `last_seen_at` and the deadline derived from it, and float error
 * across that round trip is enough to move `expiresAt` off the second it belongs on.
 *
 * Zero before the interview starts — an interview with no `started_at` has no room to have been
 * in, whatever the heartbeat columns happen to hold.
 */
export function activeMs(interview: ActiveTimed, now: Date = clock.now()): number {
  if (!interview.started_at) return 0;
  return interview.elapsed_seconds * 1000 + openStretchMs(interview, now);
}

/** `activeMs` as whole seconds — what a readout and a per-second ceiling comparison want. */
export function activeSeconds(interview: ActiveTimed, now: Date = clock.now()): number {
  return activeMs(interview, now) / 1000;
}

/**
 * Bank the open stretch and re-anchor. Returns the active total as of `now`, which is
 * `elapsed_seconds` after the write — the stretch just closed, so nothing is open yet.
 *
 * The write is guarded on `last_seen_at` still holding the value this read: two tabs in the same
 * room both beat, and an unguarded `increment` would bank the same wall-clock second once per
 * tab. The loser of the race writes nothing and reports the winner's total, which is right —
 * one candidate in one room spends one second per second however many tabs are watching.
 */
export async function bankActiveTime(interview: ActiveTimed & { id: string }): Promise<number> {
  const now = clock.now();
  const stretchMs = openStretchMs(interview, now);
  const banked = Math.floor(stretchMs / 1000);
  const remainderMs = stretchMs - banked * 1000;
  const anchor = new Date(now.getTime() - remainderMs);

  const { count } = await prisma.interview.updateMany({
    where: { id: interview.id, last_seen_at: interview.last_seen_at },
    data: { elapsed_seconds: { increment: banked }, last_seen_at: anchor },
  });

  if (count === 1) return interview.elapsed_seconds + banked;

  // Another tab got there first. Its write is the truth; re-read rather than returning a total
  // this request only believes because it lost.
  const fresh = await prisma.interview.findUnique({
    where: { id: interview.id },
    select: { started_at: true, elapsed_seconds: true, last_seen_at: true },
  });
  return fresh ? activeSeconds(fresh, now) : interview.elapsed_seconds;
}
