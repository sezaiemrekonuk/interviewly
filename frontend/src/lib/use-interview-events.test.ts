import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook } from '@testing-library/react';
import { createElement, type ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { queryKeys } from './query';
import { useInterviewEvents } from './use-interview-events';
import { installEventSourceMock, MockEventSource } from '../test/event-source-mock';

function wrapper(client: QueryClient) {
  function Wrapper({ children }: { children: ReactNode }) {
    return createElement(QueryClientProvider, { client }, children);
  }
  return Wrapper;
}

describe('useInterviewEvents', () => {
  let client: QueryClient;
  let invalidate: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    installEventSourceMock();
    client = new QueryClient();
    invalidate = vi.spyOn(client, 'invalidateQueries').mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('opens one stream on the real events path', () => {
    renderHook(() => useInterviewEvents('int-1'), { wrapper: wrapper(client) });

    expect(MockEventSource.instances).toHaveLength(1);
    expect(MockEventSource.instances[0].url).toBe('/api/interviews/int-1/events');
  });

  // The prefix, not the state key: one nudge has to reach the room's `['interview',id,'state']`
  // and W07's `['interview',id]` report read, which the report screen mounts together.
  it('invalidates the interview prefix, once per event, without reading the payload', () => {
    renderHook(() => useInterviewEvents('int-1'), { wrapper: wrapper(client) });

    MockEventSource.instances[0].emit('INTERVIEW_STATE_CHANGED', '{"to":"tech_round"}');

    expect(invalidate).toHaveBeenCalledTimes(1);
    expect(invalidate).toHaveBeenCalledWith({ queryKey: queryKeys.interview('int-1') });
  });

  // Issue #54: the state change lands before the questions exist (`POST /profile` claims the
  // transition, then calls the model), so a client listening only for it refetches into an empty
  // room and waits forever. This is the event that arrives once there is something to show.
  it('invalidates on the questions-ready event', () => {
    renderHook(() => useInterviewEvents('int-1'), { wrapper: wrapper(client) });

    MockEventSource.instances[0].emit(
      'INTERVIEW_QUESTIONS_READY',
      '{"type":"INTERVIEW_QUESTIONS_READY","interviewId":"int-1","roundType":"hr"}',
    );

    expect(invalidate).toHaveBeenCalledTimes(1);
    expect(invalidate).toHaveBeenCalledWith({ queryKey: queryKeys.interview('int-1') });
  });

  // The pair, in the order the profile submit produces them: one refetch too early, one that
  // finds the question. Neither may be dropped, and the second is the one that ends the wait.
  it('refetches again after the questions arrive, not only on the transition', () => {
    renderHook(() => useInterviewEvents('int-1'), { wrapper: wrapper(client) });
    const source = MockEventSource.instances[0];

    source.emit('INTERVIEW_STATE_CHANGED', '{"from":"profiling","to":"hr_round"}');
    source.emit('INTERVIEW_QUESTIONS_READY', '{"type":"INTERVIEW_QUESTIONS_READY"}');

    expect(invalidate).toHaveBeenCalledTimes(2);
  });

  it('invalidates once more on a reconnect, not on the first open', () => {
    renderHook(() => useInterviewEvents('int-1'), { wrapper: wrapper(client) });
    const source = MockEventSource.instances[0];

    source.emitOpen();
    expect(invalidate).toHaveBeenCalledTimes(0);

    source.emitOpen();
    expect(invalidate).toHaveBeenCalledTimes(1);
  });

  it('closes the stream on unmount', () => {
    const { unmount } = renderHook(() => useInterviewEvents('int-1'), {
      wrapper: wrapper(client),
    });

    unmount();

    expect(MockEventSource.instances[0].closed).toBe(true);
  });

  it('opens nothing without an interview id', () => {
    renderHook(() => useInterviewEvents(null), { wrapper: wrapper(client) });

    expect(MockEventSource.instances).toHaveLength(0);
  });
});
