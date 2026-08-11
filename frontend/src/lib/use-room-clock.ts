'use client';

import { useEffect } from 'react';

import { useQueryClient } from '@tanstack/react-query';

import { apiPost } from './api';
import { queryKeys, type InterviewStateResponse } from './query';
import { useNowMs } from './use-clock';

/**
 * I16 — how often the open room tells the server it is still open. The server's grace window
 * (`HEARTBEAT_GRACE_SECONDS`, 30 s) is twice this, so one dropped beat costs nothing and only a
 * real departure closes the stretch.
 */
export const ROOM_HEARTBEAT_MS = 15_000;

/**
 * Keeps the server's active-time clock running while the room is open, and folds each reply back
 * into the room's cache entry.
 *
 * Writing into the `interviewState` key rather than returning the numbers is deliberate: the rail
 * already reads `elapsedSeconds` there and the countdown already reads `expiresAt` there, and a
 * second channel for the same two values is a second thing to disagree with `GET /state`. It also
 * fixes the case a local tick cannot: a tab left open while the candidate walks away has an
 * `expiresAt` that keeps counting down on screen, and the first beat after they return replaces
 * it with the deadline that actually applies.
 *
 * **Backgrounded tabs keep beating.** `setInterval` is throttled when hidden — a beat can land
 * minutes late — but the server treats a gap past its grace window as absence, so the throttled
 * case degrades to "that time did not count" rather than to a wrong total. Being in the room with
 * another tab in front is still being in the room (the interview does not pause because the
 * candidate looked away), and what stops the clock is the room closing, not losing focus.
 */
export function useRoomHeartbeat(interviewId: string | null, enabled: boolean): void {
  const client = useQueryClient();

  useEffect(() => {
    if (!interviewId || !enabled) return;

    let cancelled = false;

    const beat = async () => {
      const result = await apiPost(`/interviews/${interviewId}/heartbeat`, {});
      // Silent on failure, and no retry: the next beat is 15 s away and the server's own grace
      // window already covers a single miss. Surfacing it would put an error in the room over a
      // ping the candidate cannot act on.
      if (cancelled || !result.ok) return;
      const { elapsedSeconds, expiresAt } = result.data as {
        elapsedSeconds: number;
        expiresAt: string | null;
      };
      client.setQueryData<InterviewStateResponse>(
        queryKeys.interviewState(interviewId),
        (previous) => (previous ? { ...previous, elapsedSeconds, expiresAt } : previous),
      );
    };

    // Once on arrival, then on the timer. Waiting for the first interval would forfeit 15 s of
    // every room entry: the stretch the candidate is starting has no anchor until a beat sets
    // one, and a reload mid-interview would drop the seconds either side of it on the floor.
    void beat();

    const timer = setInterval(() => void beat(), ROOM_HEARTBEAT_MS);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [interviewId, enabled, client]);
}

/**
 * The rail's readout: the server's active-time snapshot, ticking forward from the instant it
 * arrived.
 *
 * The clock this replaced was `now - startedAt`, which needed no anchor because its anchor was
 * the interview's own start. Active time has no such fixed point — the server's figure is only
 * true as of the response that carried it — so the readout is that figure plus the age of the
 * response, and never an accumulator. Same rule `useNowMs` exists to enforce: a slept tab and a
 * machine whose clock jumped correct themselves on the next tick rather than drifting for the
 * rest of the interview.
 *
 * **`updatedAtMs` must be the arrival, not the value's last change.** react-query's
 * `dataUpdatedAt` is exactly that and is why it is threaded down here instead of the readout
 * anchoring itself when it notices a different number. The two come apart in the case the whole
 * feature is about: a tab left open while the candidate is away gets a beat every 15 s carrying
 * the *same* elapsed figure, because the server is banking nothing. A readout that re-anchored
 * only on change would sit on its original anchor and count the entire absence.
 */
export function useRoomElapsed(elapsedSeconds: number, updatedAtMs: number): number {
  const nowMs = useNowMs();
  // 0 until the clock has a subscriber (`useNowMs`) or before the first response landed; either
  // way the age is unknowable and the server's figure is the honest thing to show.
  if (nowMs === 0 || !updatedAtMs) return elapsedSeconds;
  return elapsedSeconds + Math.max(0, Math.floor((nowMs - updatedAtMs) / 1000));
}
