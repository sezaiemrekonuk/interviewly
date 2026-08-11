import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const m = vi.hoisted(() => ({ apiPost: vi.fn() }));
vi.mock('./api', () => ({ apiPost: m.apiPost }));

import { queryKeys, type InterviewStateResponse } from './query';
import { ROOM_HEARTBEAT_MS, useRoomElapsed, useRoomHeartbeat } from './use-room-clock';

beforeEach(() => {
  vi.useFakeTimers();
  vi.clearAllMocks();
  m.apiPost.mockResolvedValue({ ok: true, data: { elapsedSeconds: 200, expiresAt: null } });
});

afterEach(() => {
  vi.useRealTimers();
});

/**
 * I16. `useRoomElapsed` is the server's figure plus the age of the response that carried it, so
 * the assertions below move the fake clock and let the shared `useNowMs` interval repaint — the
 * same shape as the room.
 */
describe('useRoomElapsed', () => {
  it('renders the server figure before the clock has ticked', () => {
    const arrivedAt = Date.now();
    const { result } = renderHook(() => useRoomElapsed(180, arrivedAt));

    expect(result.current).toBe(180);
  });

  it('ticks forward from the instant the response arrived', () => {
    const arrivedAt = Date.now();
    const { result } = renderHook(() => useRoomElapsed(180, arrivedAt));

    act(() => void vi.advanceTimersByTime(3_000));

    expect(result.current).toBe(183);
  });

  /**
   * The case that decides the design. A tab left open while the candidate is away keeps beating,
   * and every beat carries the *same* elapsed figure because the server banks nothing across a
   * gap. Each one is a fresh response, so the readout stays put — it must show the three minutes
   * the candidate actually sat, not the hour the tab was open.
   */
  it('holds still when repeated responses carry an unchanged figure', () => {
    const { result, rerender } = renderHook(
      ({ seconds, at }) => useRoomElapsed(seconds, at),
      { initialProps: { seconds: 180, at: Date.now() } },
    );

    for (let beat = 0; beat < 240; beat += 1) {
      act(() => void vi.advanceTimersByTime(15_000));
      rerender({ seconds: 180, at: Date.now() });
    }

    expect(result.current).toBe(180);
  });

  it('picks up again from a figure the server did advance', () => {
    const { result, rerender } = renderHook(
      ({ seconds, at }) => useRoomElapsed(seconds, at),
      { initialProps: { seconds: 180, at: Date.now() } },
    );

    act(() => void vi.advanceTimersByTime(15_000));
    rerender({ seconds: 195, at: Date.now() });
    act(() => void vi.advanceTimersByTime(2_000));

    expect(result.current).toBe(197);
  });

  it('shows the bare server figure before the shared clock has a subscriber', () => {
    const { result } = renderHook(() => useRoomElapsed(180, 0));

    expect(result.current).toBe(180);
  });
});

function wrapper(client: QueryClient) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  };
}

const seedRoom = (client: QueryClient, id: string) =>
  client.setQueryData(queryKeys.interviewState(id), {
    elapsedSeconds: 100,
    expiresAt: '2026-08-11T10:00:00.000Z',
  } as InterviewStateResponse);

describe('useRoomHeartbeat', () => {
  it('beats on arrival and folds the reply into the room cache', async () => {
    const client = new QueryClient();
    seedRoom(client, 'itv-1');

    await act(async () => {
      renderHook(() => useRoomHeartbeat('itv-1', true), { wrapper: wrapper(client) });
    });

    // On arrival, not at the first interval: waiting would forfeit 15 s of every room entry.
    expect(m.apiPost).toHaveBeenCalledWith('/interviews/itv-1/heartbeat', {});
    expect(client.getQueryData(queryKeys.interviewState('itv-1'))).toMatchObject({
      elapsedSeconds: 200,
      expiresAt: null,
    });
  });

  it('keeps beating on the interval after the first', async () => {
    const client = new QueryClient();
    seedRoom(client, 'itv-1');
    await act(async () => {
      renderHook(() => useRoomHeartbeat('itv-1', true), { wrapper: wrapper(client) });
    });

    // One interval at a time, settling in between: two intervals inside a single
    // `advanceTimersByTime` fire back to back with no chance for the first reply to land, which
    // is the overlap the in-flight guard exists to suppress — see the test below.
    for (let beat = 0; beat < 2; beat += 1) {
      await act(async () => {
        vi.advanceTimersByTime(ROOM_HEARTBEAT_MS);
      });
    }

    expect(m.apiPost).toHaveBeenCalledTimes(3);
  });

  /**
   * A beat that has not come back yet must not have a second one stacked on top of it. Without
   * the guard a stalled request lets beats queue up, and each one banks the stretch since the
   * anchor the *previous* one has not moved yet — the same wall-clock second, credited once per
   * beat in flight. The server's own optimistic guard on `last_seen_at` catches most of that,
   * but the honest place to not send the second request is here.
   */
  it('does not stack a second beat on one still in flight', async () => {
    let release = () => {};
    m.apiPost.mockReturnValue(
      new Promise((resolve) => {
        release = () => resolve({ ok: true, data: { elapsedSeconds: 200, expiresAt: null } });
      }),
    );
    const client = new QueryClient();
    seedRoom(client, 'itv-1');
    await act(async () => {
      renderHook(() => useRoomHeartbeat('itv-1', true), { wrapper: wrapper(client) });
    });

    // Four intervals pass with the arrival beat still unanswered.
    await act(async () => {
      vi.advanceTimersByTime(ROOM_HEARTBEAT_MS * 4);
    });
    expect(m.apiPost).toHaveBeenCalledOnce();

    // Once it answers, the next interval beats normally.
    await act(async () => {
      release();
    });
    await act(async () => {
      vi.advanceTimersByTime(ROOM_HEARTBEAT_MS);
    });
    expect(m.apiPost).toHaveBeenCalledTimes(2);
  });

  it('does not beat when disabled, so a finished room banks nothing', () => {
    const client = new QueryClient();
    renderHook(() => useRoomHeartbeat('itv-1', false), { wrapper: wrapper(client) });

    act(() => void vi.advanceTimersByTime(ROOM_HEARTBEAT_MS * 4));

    expect(m.apiPost).not.toHaveBeenCalled();
  });

  it('leaves the cache alone when a beat fails', async () => {
    m.apiPost.mockResolvedValue({ ok: false, code: 'UNKNOWN' });
    const client = new QueryClient();
    seedRoom(client, 'itv-1');
    renderHook(() => useRoomHeartbeat('itv-1', true), { wrapper: wrapper(client) });

    await act(async () => {
      vi.advanceTimersByTime(ROOM_HEARTBEAT_MS);
    });

    expect(client.getQueryData(queryKeys.interviewState('itv-1'))).toMatchObject({
      elapsedSeconds: 100,
    });
  });

  it('stops beating once the room unmounts', async () => {
    const client = new QueryClient();
    seedRoom(client, 'itv-1');
    let unmount = () => {};
    await act(async () => {
      ({ unmount } = renderHook(() => useRoomHeartbeat('itv-1', true), {
        wrapper: wrapper(client),
      }));
    });

    unmount();
    await act(async () => {
      vi.advanceTimersByTime(ROOM_HEARTBEAT_MS * 3);
    });

    // The arrival beat and nothing after it.
    expect(m.apiPost).toHaveBeenCalledOnce();
  });
});
