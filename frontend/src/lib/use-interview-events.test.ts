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
