import { clock } from '../../src/lib/clock';
import { config } from '../../src/lib/env';
import { activeMs, type ActiveTimed } from '../interview/elapsed';

/**
 * `maxDurationSeconds` is the candidate's choice (S08, `interviews.max_duration_seconds`). It
 * enters the same `Math.min` as the two configured ceilings, so it can only shorten the
 * interview — a choice above `VOICE_MAX_INTERVIEW_SECONDS` never reaches here (setup.ts refuses
 * it), and one that somehow did would still be capped by this.
 */
function ceilingSeconds(maxDurationSeconds?: number | null): number {
  return Math.min(
    config.VOICE_MAX_ROUND_SECONDS,
    config.VOICE_MAX_INTERVIEW_SECONDS,
    maxDurationSeconds ?? Number.POSITIVE_INFINITY,
  );
}

/** What the ceiling is measured against: an interview's timing columns plus its chosen length. */
export type Ceilinged = ActiveTimed & { max_duration_seconds: number | null };

/**
 * Milliseconds of interview left, floored at zero. Null before the interview started.
 *
 * I16 moved the measure from wall clock to active time (`elapsed_seconds` + the open stretch),
 * so time spent out of the room does not spend the ceiling. What is unchanged is that this is
 * the *only* arithmetic — S09's rule that a rendered countdown and a `VOICE_SESSION_EXPIRED`
 * cannot name different times survives the move because both still come from here.
 */
export function speechRemainingMs(interview: Ceilinged, now: Date = clock.now()): number | null {
  if (!interview.started_at) return null;
  return Math.max(0, ceilingSeconds(interview.max_duration_seconds) * 1000 - activeMs(interview, now));
}

/**
 * The instant the ceiling hits, or null before the interview started.
 *
 * **This is now a moving deadline, and that is the point.** Under wall clock it could only
 * shorten; under active time it slides forward by exactly the time the candidate spends away,
 * because the milliseconds it is made of are only spent in the room. A client that re-reads it
 * after a break gets a later instant than it held before, and the countdown it renders picks up
 * where the candidate left it.
 *
 * An interview being answered right now still lands on `started_at + ceiling` to the
 * millisecond: the open stretch grows exactly as fast as `now` does, so the two cancel.
 */
export function speechExpiresAt(interview: Ceilinged, now: Date = clock.now()): Date | null {
  const remaining = speechRemainingMs(interview, now);
  return remaining === null ? null : new Date(now.getTime() + remaining);
}

export function isPastSpeechCeiling(interview: Ceilinged, now: Date = clock.now()): boolean {
  return speechRemainingMs(interview, now) === 0;
}
