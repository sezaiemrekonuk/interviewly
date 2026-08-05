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
