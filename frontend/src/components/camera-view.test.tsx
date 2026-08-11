/**
 * The self-camera's whole contract (voice spec §3.2): nothing is requested until the candidate
 * asks for it, turning it off releases the device rather than hiding the picture, and a refusal
 * is a sentence in the frame instead of an error.
 */
import { render, screen, waitFor } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { messages } from '../test/render';
import { CameraView } from './camera-view';

function stubCamera(outcome: 'grant' | 'deny' | 'missing') {
  const track = { stop: vi.fn(), kind: 'video' };
  const getUserMedia =
    outcome === 'grant'
      ? vi.fn(async () => ({ getTracks: () => [track] }) as unknown as MediaStream)
      : vi.fn(async () => {
          const name = outcome === 'missing' ? 'NotFoundError' : 'NotAllowedError';
          throw Object.assign(new Error('no'), { name });
        });
  Object.defineProperty(navigator, 'mediaDevices', {
    value: { getUserMedia },
    configurable: true,
  });
  return { getUserMedia, track };
}

const view = (enabled: boolean) => (
  <NextIntlClientProvider locale="en" messages={messages}>
    <CameraView enabled={enabled} />
  </NextIntlClientProvider>
);

afterEach(() => {
  vi.restoreAllMocks();
});

describe('CameraView', () => {
  it('asks for nothing while the camera is off', () => {
    const { getUserMedia } = stubCamera('grant');
    render(view(false));

    expect(getUserMedia).not.toHaveBeenCalled();
    expect(screen.getByTestId('camera-view')).toHaveAttribute('data-camera', 'off');
    expect(screen.getByText(messages.common.camera.off)).toBeInTheDocument();
  });

  it('requests video only, never audio, once it is turned on', async () => {
    const { getUserMedia } = stubCamera('grant');
    render(view(true));

    await waitFor(() =>
      expect(screen.getByTestId('camera-view')).toHaveAttribute('data-camera', 'live'),
    );
    expect(getUserMedia).toHaveBeenCalledWith({ video: true, audio: false });
  });

  it('stops the track when it is turned back off — the camera light goes out', async () => {
    const { track } = stubCamera('grant');
    const { rerender } = render(view(true));

    await waitFor(() =>
      expect(screen.getByTestId('camera-view')).toHaveAttribute('data-camera', 'live'),
    );
    rerender(view(false));

    expect(track.stop).toHaveBeenCalled();
    expect(screen.getByTestId('camera-view')).toHaveAttribute('data-camera', 'off');
  });

  it('stops the track on unmount', async () => {
    const { track } = stubCamera('grant');
    const { unmount } = render(view(true));

    await waitFor(() =>
      expect(screen.getByTestId('camera-view')).toHaveAttribute('data-camera', 'live'),
    );
    unmount();

    expect(track.stop).toHaveBeenCalled();
  });

  it('says a refusal, and tells it apart from a machine with no camera', async () => {
    stubCamera('deny');
    const { unmount } = render(view(true));
    await waitFor(() =>
      expect(screen.getByText(messages.common.camera.blocked)).toBeInTheDocument(),
    );
    unmount();

    stubCamera('missing');
    render(view(true));
    await waitFor(() =>
      expect(screen.getByText(messages.common.camera.unavailable)).toBeInTheDocument(),
    );
  });
});
