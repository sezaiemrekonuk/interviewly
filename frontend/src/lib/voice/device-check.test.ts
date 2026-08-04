import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { checkDevices } from './device-check';

function makeMicStream(): MediaStream {
  const track = { kind: 'audio', stop: vi.fn(), readyState: 'live' } as unknown as MediaStreamTrack;
  return { getTracks: () => [track], getAudioTracks: () => [track] } as unknown as MediaStream;
}

beforeEach(() => {
  // jsdom has no mediaDevices — install a minimal stub.
  Object.defineProperty(navigator, 'mediaDevices', {
    value: { getUserMedia: vi.fn() },
    configurable: true,
    writable: true,
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('checkDevices', () => {
  it('reports granted when getUserMedia resolves', async () => {
    vi.spyOn(navigator.mediaDevices, 'getUserMedia').mockResolvedValue(makeMicStream());

    const result = await checkDevices();
    expect(result.micPermission).toBe('granted');
    result.release();
  });

  it('reports denied when getUserMedia rejects with NotAllowedError', async () => {
    vi.spyOn(navigator.mediaDevices, 'getUserMedia').mockRejectedValue(
      Object.assign(new DOMException('Permission denied', 'NotAllowedError'), {}),
    );

    const result = await checkDevices();
    expect(result.micPermission).toBe('denied');
  });

  it('reports denied for any getUserMedia rejection (device not found etc.)', async () => {
    vi.spyOn(navigator.mediaDevices, 'getUserMedia').mockRejectedValue(
      Object.assign(new DOMException('Not found', 'NotFoundError'), {}),
    );

    const result = await checkDevices();
    expect(result.micPermission).toBe('denied');
  });

  it('release() stops all tracks', async () => {
    const track = { kind: 'audio', stop: vi.fn(), readyState: 'live' } as unknown as MediaStreamTrack;
    const stream = { getTracks: () => [track], getAudioTracks: () => [track] } as unknown as MediaStream;
    vi.spyOn(navigator.mediaDevices, 'getUserMedia').mockResolvedValue(stream);

    const result = await checkDevices();
    result.release();

    expect(track.stop).toHaveBeenCalled();
  });

  it('denied result signals no mint should occur (zero mint calls when guarded by permission)', async () => {
    vi.spyOn(navigator.mediaDevices, 'getUserMedia').mockRejectedValue(
      Object.assign(new DOMException('Permission denied', 'NotAllowedError'), {}),
    );

    const mintFn = vi.fn();
    const result = await checkDevices();

    // Caller pattern: only mint if permission is granted.
    if (result.micPermission === 'granted') await mintFn();

    expect(mintFn).not.toHaveBeenCalled();
    expect(result.micPermission).toBe('denied');
  });
});
