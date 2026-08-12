import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { useMicPermission } from './use-mic-permission';

function fakeStream(deviceId = 'mic-a') {
  const track = {
    stop: vi.fn(),
    getSettings: () => ({ deviceId }),
  };
  return {
    stream: {
      getTracks: () => [track],
      getAudioTracks: () => [track],
    } as unknown as MediaStream,
    track,
  };
}

function stubMediaDevices(devices: Partial<MediaDevices> | undefined) {
  Object.defineProperty(navigator, 'mediaDevices', { value: devices, configurable: true });
}

const DEVICES = [
  { deviceId: 'mic-a', kind: 'audioinput', label: 'Built-in' },
  { deviceId: 'mic-b', kind: 'audioinput', label: 'Headset' },
  { deviceId: 'cam', kind: 'videoinput', label: 'Webcam' },
] as MediaDeviceInfo[];

afterEach(() => {
  stubMediaDevices(undefined);
  vi.restoreAllMocks();
});

describe('useMicPermission (W09)', () => {
  it('reports unavailable when the browser exposes no getUserMedia', async () => {
    stubMediaDevices(undefined);
    const { result } = renderHook(() => useMicPermission());

    await act(async () => result.current.request());

    expect(result.current.state).toBe('unavailable');
  });

  it('grants, exposes the input devices and releases the track on unmount', async () => {
    const { stream, track } = fakeStream();
    stubMediaDevices({
      getUserMedia: vi.fn(async () => stream),
      enumerateDevices: vi.fn(async () => DEVICES),
    } as unknown as MediaDevices);

    const { result, unmount } = renderHook(() => useMicPermission());
    await act(async () => result.current.request());

    expect(result.current.state).toBe('granted');
    expect(result.current.deviceId).toBe('mic-a');
    await waitFor(() => expect(result.current.devices).toHaveLength(2));

    // The non-negotiable: no hot mic after the screen goes away.
    unmount();
    expect(track.stop).toHaveBeenCalled();
  });

  it('reports denied when the user refuses', async () => {
    const err = Object.assign(new Error('no'), { name: 'NotAllowedError' });
    stubMediaDevices({ getUserMedia: vi.fn(async () => Promise.reject(err)) } as unknown as MediaDevices);

    const { result } = renderHook(() => useMicPermission());
    await act(async () => result.current.request());

    expect(result.current.state).toBe('denied');
  });

  it('reports unavailable — not denied — when the machine has no microphone', async () => {
    const err = Object.assign(new Error('none'), { name: 'NotFoundError' });
    stubMediaDevices({ getUserMedia: vi.fn(async () => Promise.reject(err)) } as unknown as MediaDevices);

    const { result } = renderHook(() => useMicPermission());
    await act(async () => result.current.request());

    expect(result.current.state).toBe('unavailable');
  });

  it('switching device re-requests exactly and stops the previous track', async () => {
    const first = fakeStream('mic-a');
    const second = fakeStream('mic-b');
    const getUserMedia = vi
      .fn()
      .mockResolvedValueOnce(first.stream)
      .mockResolvedValueOnce(second.stream);
    stubMediaDevices({
      getUserMedia,
      enumerateDevices: vi.fn(async () => DEVICES),
    } as unknown as MediaDevices);

    const { result } = renderHook(() => useMicPermission());
    await act(async () => result.current.request());
    await act(async () => result.current.select('mic-b'));

    expect(getUserMedia).toHaveBeenLastCalledWith({ audio: { deviceId: { exact: 'mic-b' } } });
    expect(first.track.stop).toHaveBeenCalled();
    expect(result.current.deviceId).toBe('mic-b');
  });
});

/**
 * The bug this exists to prevent, found in a live room on 2026-08-11 and worth stating plainly:
 * a suspended `AudioContext` reports pure silence, so `level` never leaves 0, the VAD's
 * `heardRef` never arms, and a spoken turn is never probed — the room listens forever to a
 * candidate who is talking. Browsers create the context suspended when the page has had no user
 * gesture, which is precisely what a RELOAD is. It cost a whole live interview.
 */
describe('useMicPermission — the meter has to be awake to measure anything', () => {
  function stubAudioContext(initial: AudioContextState) {
    const ctx = {
      state: initial,
      resume: vi.fn(async () => {
        ctx.state = 'running';
      }),
      close: vi.fn(async () => {}),
      createAnalyser: () => ({ fftSize: 256, getFloatTimeDomainData: () => {} }),
      createMediaStreamSource: () => ({ connect: () => {} }),
    };
    // A normal function, never an arrow: `new` on an arrow throws "is not a constructor",
    // and `meter()` runs inside `request()`'s try, so the throw reads as a denied microphone.
    vi.stubGlobal(
      'AudioContext',
      vi.fn(function AudioContextStub() {
        return ctx;
      }),
    );
    vi.stubGlobal('requestAnimationFrame', () => 1);
    vi.stubGlobal('cancelAnimationFrame', () => {});
    return ctx;
  }

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  async function granted() {
    const { stream } = fakeStream();
    stubMediaDevices({
      getUserMedia: vi.fn(async () => stream),
      enumerateDevices: vi.fn(async () => DEVICES),
    } as unknown as MediaDevices);
    const hook = renderHook(() => useMicPermission());
    await act(async () => hook.result.current.request());
    await waitFor(() => expect(hook.result.current.state).toBe('granted'));
    return hook;
  }

  it('resumes the context it just created', async () => {
    const ctx = stubAudioContext('suspended');
    await granted();

    expect(ctx.resume).toHaveBeenCalled();
  });

  // Chrome refuses `resume()` outright until the page has been touched, and returns a rejected
  // promise rather than a running context. The next click has to be the second chance.
  it('waits for a gesture when the browser refuses to resume', async () => {
    const ctx = {
      state: 'suspended' as AudioContextState,
      resume: vi.fn(async () => {
        throw new Error('not allowed to start');
      }),
      close: vi.fn(async () => {}),
      createAnalyser: () => ({ fftSize: 256, getFloatTimeDomainData: () => {} }),
      createMediaStreamSource: () => ({ connect: () => {} }),
    };
    // A normal function, never an arrow: `new` on an arrow throws "is not a constructor",
    // and `meter()` runs inside `request()`'s try, so the throw reads as a denied microphone.
    vi.stubGlobal(
      'AudioContext',
      vi.fn(function AudioContextStub() {
        return ctx;
      }),
    );
    vi.stubGlobal('requestAnimationFrame', () => 1);
    vi.stubGlobal('cancelAnimationFrame', () => {});

    await granted();
    expect(ctx.resume).toHaveBeenCalledTimes(1);

    await act(async () => {
      window.dispatchEvent(new Event('pointerdown'));
    });

    expect(ctx.resume).toHaveBeenCalledTimes(2);
  });

  it('leaves a context the browser started running alone', async () => {
    const ctx = stubAudioContext('running');
    await granted();

    await act(async () => {
      window.dispatchEvent(new Event('pointerdown'));
    });

    // Resumed once on principle, never again: no listener is left on the window.
    expect(ctx.resume).toHaveBeenCalledTimes(1);
  });
});
