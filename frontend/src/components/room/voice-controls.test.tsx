/**
 * S09 — the countdown derives from the server's `expiresAt` and never counts on its own. A
 * component that kept its own total would drift past a refetch, a slept tab, or a clock the
 * candidate moved, and tell them they have time the server will refuse.
 */
import { act, render, screen } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { messages } from '../../test/render';
import { VoiceControls } from './voice-controls';
import type { UseVoiceSessionResult } from '../../lib/use-voice-session';

const NOW = new Date('2026-08-10T10:00:00.000Z');

const session = (overrides: Partial<UseVoiceSessionResult> = {}): UseVoiceSessionResult => ({
  status: 'connected',
  beat: null,
  micLevel: 0,
  muted: false,
  micState: 'granted',
  toggleMute: vi.fn(),
  reconnect: vi.fn(),
  recording: false,
  stop: vi.fn(),
  error: null,
  retry: vi.fn(),
  ...overrides,
});

/** The provider rides along so `rerender` can hand the component a new deadline in place. */
const tree = (expiresAt: string | null) => (
  <NextIntlClientProvider locale="en" messages={messages}>
    <VoiceControls
      session={session()}
      expiresAt={expiresAt}
      captionsOn
      onToggleCaptions={vi.fn()}
      transcriptOpen={false}
      onToggleTranscript={vi.fn()}
    />
  </NextIntlClientProvider>
);

const renderControls = (expiresAt: string | null) => render(tree(expiresAt));

/** ISO for `NOW + seconds`, i.e. the deadline the server would send. */
const inSeconds = (seconds: number) => new Date(NOW.getTime() + seconds * 1000).toISOString();

const tick = async (seconds: number) => {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(seconds * 1000);
  });
};

describe('VoiceControls time remaining (S09)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('counts down from the deadline the server sent', async () => {
    renderControls(inSeconds(300));

    expect(screen.getByTestId('time-remaining')).toHaveTextContent('5:00');
    await tick(65);
    expect(screen.getByTestId('time-remaining')).toHaveTextContent('3:55');
  });

  it('follows the server when its deadline disagrees with the elapsed count', async () => {
    const { rerender } = renderControls(inSeconds(300));
    await tick(60);
    expect(screen.getByTestId('time-remaining')).toHaveTextContent('4:00');

    // The refetch the room already does: the server's window shrank (a shorter chosen duration
    // on another device, a clock that was ahead). A local total would still read 4:00.
    rerender(tree(new Date(Date.now() + 30_000).toISOString()));

    expect(screen.getByTestId('time-remaining')).toHaveTextContent('0:30');
  });

  it('stops at zero rather than counting into negative time', async () => {
    renderControls(inSeconds(2));
    await tick(30);

    expect(screen.getByTestId('time-remaining')).toHaveTextContent('0:00');
  });

  it('says it is nearly out of time in words, not colour alone', async () => {
    renderControls(inSeconds(75));

    expect(screen.getByTestId('time-remaining')).toHaveTextContent(messages.room.timeLeftLabel);
    expect(screen.getByTestId('time-remaining')).toHaveAttribute('data-warn', 'false');

    await tick(20);

    expect(screen.getByTestId('time-remaining')).toHaveTextContent(messages.room.timeLeftWarning);
    expect(screen.getByTestId('time-remaining')).toHaveAttribute('data-warn', 'true');
  });

  it('announces the warning once, and does not put the ticking number in a live region', async () => {
    renderControls(inSeconds(75));

    const announcement = screen.getByTestId('time-warning');
    expect(announcement).toHaveAttribute('role', 'status');
    expect(announcement).toBeEmptyDOMElement();
    // A live region that re-reads every second is unusable — the ticking figure is outside it.
    expect(screen.getByTestId('time-remaining')).not.toHaveAttribute('aria-live');

    await tick(20);
    expect(announcement).toHaveTextContent(messages.room.timeLeftAnnounce);

    // Still the one sentence ten ticks later: the region's content never changes again, so a
    // screen reader announces it once.
    await tick(10);
    expect(announcement).toHaveTextContent(messages.room.timeLeftAnnounce);
  });

  it('renders no countdown when the interview has no deadline', () => {
    renderControls(null);

    expect(screen.queryByTestId('time-remaining')).not.toBeInTheDocument();
  });
});

describe('VoiceControls failure copy (S10)', () => {
  const renderWith = (over: Partial<UseVoiceSessionResult>) =>
    render(
      <NextIntlClientProvider locale="en" messages={messages}>
        <VoiceControls
          session={session(over)}
          expiresAt={null}
          captionsOn
          onToggleCaptions={vi.fn()}
          transcriptOpen={false}
          onToggleTranscript={vi.fn()}
        />
      </NextIntlClientProvider>,
    );

  const CONNECTION_DROPPED = 'The voice connection dropped';

  it('renders each failure its own copy, none of it "connection dropped"', () => {
    const codes = [
      'SPEECH_AUDIO_INVALID',
      'SPEECH_TRANSCRIPTION_FAILED',
      'VOICE_UNAVAILABLE',
      'VOICE_SESSION_EXPIRED',
    ] as const;

    for (const code of codes) {
      const { unmount } = renderWith({ error: code });
      const notice = screen.getByTestId('voice-error');
      expect(notice).toHaveTextContent(messages.room.voice.failure[code]);
      expect(notice).not.toHaveTextContent(CONNECTION_DROPPED);
      unmount();
    }
  });

  it('offers a retry only where re-recording can clear the failure', () => {
    const retry = vi.fn();
    renderWith({ error: 'SPEECH_AUDIO_INVALID', retry });

    screen.getByTestId('voice-retry').click();
    expect(retry).toHaveBeenCalledOnce();
  });

  it('renders no retry button — nor a reconnect — for a 403 that retrying cannot clear', () => {
    renderWith({ error: 'FORBIDDEN' });

    expect(screen.getByTestId('voice-error')).toBeInTheDocument();
    expect(screen.queryByTestId('voice-retry')).not.toBeInTheDocument();
    expect(screen.queryByTestId('session-lost')).not.toBeInTheDocument();
  });

  it('renders no retry button for a passed ceiling that ends the interview', () => {
    renderWith({ error: 'VOICE_SESSION_EXPIRED' });

    expect(screen.queryByTestId('voice-retry')).not.toBeInTheDocument();
  });

  it('names the microphone, not a connection, when the mic is lost, and offers reconnect', () => {
    const reconnect = vi.fn();
    renderWith({ status: 'lost', micState: 'denied', reconnect });

    const banner = screen.getByTestId('session-lost');
    expect(banner).toHaveTextContent(messages.room.voice.micLost);
    expect(banner).not.toHaveTextContent(CONNECTION_DROPPED);
    screen.getByRole('button', { name: messages.room.voice.reconnect }).click();
    expect(reconnect).toHaveBeenCalledOnce();
  });
});
