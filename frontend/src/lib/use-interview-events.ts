'use client';

import { useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';

import { API_BASE } from './api';
import { queryKeys } from './query';

/** The backend's only named event (`sse.ts`). */
const STATE_CHANGED = 'INTERVIEW_STATE_CHANGED';

/**
 * K11 — nudge, then refetch. The event body says *that* something changed, never *what*:
 * the caller re-renders from its own query key, so the payload is never read.
 *
 * `['interview',id]` is invalidated as a *prefix*, so one nudge reaches both the room's
 * `['interview',id,'state']` and W07's report read — no per-caller key parameter, and no
 * screen that mounts both can be nudged into a half-refreshed state.
 */
export function useInterviewEvents(interviewId: string | null): void {
  const queryClient = useQueryClient();

  useEffect(() => {
    if (!interviewId) return;

    const source = new EventSource(`${API_BASE}/interviews/${interviewId}/events`);
    const invalidate = () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.interview(interviewId) });
    };

    // A drop and re-open means events were missed while the socket was down; the first
    // `open` is the initial connect, which the mounting query already covered.
    let connected = false;
    source.onopen = () => {
      if (connected) invalidate();
      connected = true;
    };
    source.onmessage = invalidate;
    source.addEventListener(STATE_CHANGED, invalidate);

    return () => {
      source.removeEventListener(STATE_CHANGED, invalidate);
      source.close();
    };
  }, [interviewId, queryClient]);
}
