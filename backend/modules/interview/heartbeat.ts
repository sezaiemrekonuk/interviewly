/**
 * `POST /interviews/:id/heartbeat` — I16. The room says "I am still here"; the server banks the
 * stretch since the last one and re-anchors.
 *
 * This exists because there is no reliable "left the room" event. `beforeunload` does not fire
 * on a killed tab, a crashed browser or a closed laptop, and a leave button only covers the one
 * departure that was deliberate. Presence has to be inferred from a signal that stops on its
 * own, so it is inferred from this one stopping — `bankActiveTime` counts a gap only if it is
 * inside the grace window, and everything past that is time the candidate was away.
 *
 * The response carries the same two numbers `GET /state` reports, so a room that has been open
 * for an hour without refetching still renders a total the server agrees with.
 */
import type { RequestHandler } from 'express';

import { speechExpiresAt } from '../speech/ceiling';

import { bankActiveTime } from './elapsed';

/**
 * The states a heartbeat means anything in. A finished interview is not a room anyone is sitting
 * in, and banking time against one would keep growing a figure the report has already used.
 * Deliberately not an error — a beat that races the last answer is ordinary, and failing it
 * would put an error in the room at the exact moment it is congratulating the candidate.
 */
const LIVE_STATES = new Set(['profiling', 'hr_round', 'tech_round', 'paused']);

export const heartbeatInterview: RequestHandler = async (req, res) => {
  const interview = req.interview!;

  const elapsedSeconds = LIVE_STATES.has(interview.state)
    ? await bankActiveTime(interview)
    : interview.elapsed_seconds;

  // Read from the banked figure, not the row this request started with: the stretch just closed
  // into it, so `last_seen_at` is now and the open stretch is zero.
  const expiresAt =
    interview.mode === 'voice'
      ? speechExpiresAt({ ...interview, elapsed_seconds: elapsedSeconds, last_seen_at: null })
      : null;

  res.status(200).json({
    elapsedSeconds: Math.floor(elapsedSeconds),
    expiresAt: expiresAt?.toISOString() ?? null,
  });
};

export default heartbeatInterview;
