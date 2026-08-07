import { vi } from 'vitest';

/**
 * A `getUserMedia` that hands back stoppable tracks, so "the mic is released on unmount" is
 * an assertion on `stop` rather than on the absence of an error.
 */
export function installMediaDevicesMock(): { tracks: { stop: ReturnType<typeof vi.fn>; enabled: boolean }[] } {
  const tracks: { stop: ReturnType<typeof vi.fn>; enabled: boolean }[] = [];

  const getUserMedia = vi.fn(async () => {
    const track = { stop: vi.fn(), enabled: true, getSettings: () => ({ deviceId: 'mic-1' }) };
    tracks.push(track);
    return { getTracks: () => [track], getAudioTracks: () => [track] } as unknown as MediaStream;
  });

  vi.stubGlobal('navigator', {
    ...globalThis.navigator,
    mediaDevices: {
      getUserMedia,
      enumerateDevices: vi.fn(async () => [{ kind: 'audioinput', deviceId: 'mic-1', label: 'Built-in' }]),
    },
  });

  return { tracks };
}
