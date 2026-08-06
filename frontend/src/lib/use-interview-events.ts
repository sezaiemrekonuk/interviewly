'use client';

import { useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';

import { API_BASE } from './api';
import { queryKeys } from './query';

/**
 * The backend's named events (`sse.ts`). Both mean the same thing here — ask again — but they
 * are two events because the state change lands *before* the questions exist: `POST /profile`
 * claims `profiling → hr_round` and only then calls the model, so a room that refetched on the
 * transition alone sits on the waiting panel until the candidate reloads.
 */
const EVENTS = ['INTERVIEW_STATE_CHANGED', 'INTERVIEW_QUESTIONS_READY'] as const;

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
    for (const name of EVENTS) source.addEventListener(name, invalidate);

    return () => {
      for (const name of EVENTS) source.removeEventListener(name, invalidate);
      source.close();
    };
  }, [interviewId, queryClient]);
}
