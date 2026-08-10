import { clock } from '../../src/lib/clock';
import { config } from '../../src/lib/env';

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

/**
 * The instant the ceiling hits, or null before the interview started.
 *
 * S09: `GET /state` reports this and the room counts down to it, while `isPastSpeechCeiling`
 * below refuses on it. One arithmetic, deliberately — a room told it has four minutes and cut
 * off in one is what two copies of this produces.
 */
export function speechExpiresAt(
  startedAt: Date | null,
  maxDurationSeconds?: number | null,
): Date | null {
  if (!startedAt) return null;
  return new Date(startedAt.getTime() + ceilingSeconds(maxDurationSeconds) * 1000);
}

export function isPastSpeechCeiling(
  startedAt: Date | null,
  maxDurationSeconds?: number | null,
): boolean {
  const expiresAt = speechExpiresAt(startedAt, maxDurationSeconds);
  return expiresAt !== null && clock.now().getTime() >= expiresAt.getTime();
}
