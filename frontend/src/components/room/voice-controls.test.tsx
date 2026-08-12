/**
 * S09 — the countdown derives from the server's `expiresAt` and never counts on its own. A
 * component that kept its own total would drift past a refetch, a slept tab, or a clock the
 * candidate moved, and tell them they have time the server will refuse.
 */
import { act, fireEvent, render, screen } from '@testing-library/react';
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
  holding: false,
  stop: vi.fn(),
  error: null,
  retry: vi.fn(),
  // One input is the default: the picker is gated on there being a choice to make, so the
  // cases below render the bar without it unless they say otherwise.
  devices: [{ deviceId: 'built-in', label: 'Built-in microphone' }],
  deviceId: 'built-in',
  selectDevice: vi.fn(),
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
      cameraOn={false}
      onToggleCamera={vi.fn()}

      cameras={[]}

      cameraId={null}

      onSelectCamera={vi.fn()}
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
          cameraOn={false}
          onToggleCamera={vi.fn()}

          cameras={[]}

          cameraId={null}

          onSelectCamera={vi.fn()}
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

/**
 * The picker exists for one scenario: an input that stops working mid-interview. Before this,
 * the device list was only on pre-join, so a candidate whose headset died had to leave the
 * room — and the room's Leave does not end an interview (#104), so leaving is not a way out
 * either. The plumbing was already here; `use-voice-session` held `devices`/`select` from
 * `useMicPermission` and never surfaced them.
 */
describe('VoiceControls input picker', () => {
  const renderWith = (over: Partial<UseVoiceSessionResult>) =>
    render(
      <NextIntlClientProvider locale="en" messages={messages}>
        <VoiceControls
          session={session(over)}
          expiresAt={null}
          captionsOn
          onToggleCaptions={vi.fn()}
          cameraOn={false}
          onToggleCamera={vi.fn()}

          cameras={[]}

          cameraId={null}

          onSelectCamera={vi.fn()}
          transcriptOpen={false}
          onToggleTranscript={vi.fn()}
        />
      </NextIntlClientProvider>,
    );

  const TWO = [
    { deviceId: 'built-in', label: 'Built-in microphone' },
    { deviceId: 'headset', label: 'Headset' },
  ];

  // One microphone is not a choice, and a control that cannot change anything is noise in a
  // bar the candidate reads mid-sentence.
  // Offered for a single input too: the control names the microphone the room is using, which
  // is the question a candidate asks when they cannot be heard.
  it('is rendered even when the machine offers one input', () => {
    renderWith({});

    expect(screen.getByTestId('mic-device')).toBeInTheDocument();
  });

  it('offers every input, naming the live one', () => {
    renderWith({ devices: TWO, deviceId: 'headset' });

    const pick = screen.getByTestId('mic-device');
    expect(pick).toHaveValue('headset');
    expect(screen.getByRole('option', { name: 'Built-in microphone' })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'Headset' })).toBeInTheDocument();
  });

  it('falls back to the first input when the live device id is unknown', () => {
    renderWith({ devices: TWO, deviceId: null });

    expect(screen.getByTestId('mic-device')).toHaveValue('built-in');
  });

  it('switches input on change', () => {
    const selectDevice = vi.fn();
    renderWith({ devices: TWO, deviceId: 'built-in', selectDevice });

    fireEvent.change(screen.getByTestId('mic-device'), { target: { value: 'headset' } });

    expect(selectDevice).toHaveBeenCalledWith('headset');
  });
  // The case the control exists for: the mic is gone, and this is what fixes it without
  // leaving the room.
  it('stays usable while the mic is lost', () => {
    renderWith({ devices: TWO, deviceId: 'built-in', status: 'lost', micState: 'denied' });

    expect(screen.getByTestId('mic-device')).toBeEnabled();
  });

  // `selectDevice` releases the track the MediaRecorder is reading, so a swap mid-answer
  // truncates the answer being given.
  it('is disabled while an answer is being recorded', () => {
    renderWith({ devices: TWO, deviceId: 'built-in', recording: true });

    expect(screen.getByTestId('mic-device')).toBeDisabled();
  });

  it('falls back to a numbered name for an unlabelled input', () => {
    renderWith({
      devices: [
        { deviceId: 'a', label: '' },
        { deviceId: 'b', label: '' },
      ],
      deviceId: 'a',
    });

    expect(screen.getByRole('option', { name: 'Microphone 1' })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'Microphone 2' })).toBeInTheDocument();
  });
});

/**
 * T04 — the pause line. The recorder is still open and the server is holding what was said so
 * far; the strip says so rather than leaving a candidate mid-thought to guess whether anything
 * is being kept. Static: it is a state of the room, not an announcement, and the interviewer's
 * words are the only thing in this room worth a live region.
 */
describe('VoiceControls pause line (T04)', () => {
  const renderWith = (over: Partial<UseVoiceSessionResult>) =>
    render(
      <NextIntlClientProvider locale="en" messages={messages}>
        <VoiceControls
          session={session(over)}
          expiresAt={null}
          captionsOn
          onToggleCaptions={vi.fn()}
          cameraOn={false}
          onToggleCamera={vi.fn()}
          cameras={[]}
          cameraId={null}
          onSelectCamera={vi.fn()}
          transcriptOpen={false}
          onToggleTranscript={vi.fn()}
        />
      </NextIntlClientProvider>,
    );

  it('says the room is still listening while a fragment is held', () => {
    renderWith({ recording: true, holding: true });

    const line = screen.getByTestId('voice-holding');
    expect(line).toHaveTextContent(messages.room.voice.stillListening);
    expect(line).not.toHaveAttribute('aria-live');
    expect(line).not.toHaveAttribute('role');
  });

  it('says nothing when the turn is not paused mid-thought', () => {
    renderWith({ recording: true, holding: false });
    expect(screen.queryByTestId('voice-holding')).not.toBeInTheDocument();

    renderWith({ recording: false, holding: true });
    expect(screen.queryByTestId('voice-holding')).not.toBeInTheDocument();
  });
});

/**
 * Stop's slot. The control a candidate reaches for under time pressure has to be in the same
 * place every time, and it was not: rendering it only while recording inserted and removed a
 * button in the MIDDLE of a wrapping row, so every turn boundary shifted Mute, Camera, Captions
 * and Transcript sideways — twice per turn — and moved the wrap point with them on a narrow
 * window.
 */
describe('VoiceControls — the bar does not move under the candidate (T04)', () => {
  const renderWith = (over: Partial<UseVoiceSessionResult>) =>
    render(
      <NextIntlClientProvider locale="en" messages={messages}>
        <VoiceControls
          session={session(over)}
          expiresAt={null}
          captionsOn
          onToggleCaptions={vi.fn()}
          cameraOn={false}
          onToggleCamera={vi.fn()}
          cameras={[]}
          cameraId={null}
          onSelectCamera={vi.fn()}
          transcriptOpen={false}
          onToggleTranscript={vi.fn()}
        />
      </NextIntlClientProvider>,
    );

  /** What the row is made of, in order — the thing that must not change between turns. */
  const bar = () =>
    Array.from(screen.getByTestId('voice-controls').children).map(
      (child) => `${child.tagName}.${child.className}`,
    );

  it('keeps the same controls in the same order whether or not a turn is being recorded', () => {
    const idle = renderWith({ recording: false });
    const before = bar();
    idle.unmount();

    renderWith({ recording: true });

    expect(bar()).toEqual(before);
  });

  it("holds the slot at Stop's own width, in every language", () => {
    renderWith({ recording: false });

    // A ghost of the label rather than a fixed width: `voice.stop` is translated, and a number
    // that fits "Stop" is the wrong number for "Durdur".
    const ghost = screen.getByTestId('voice-stop-slot');
    expect(ghost).toHaveTextContent(messages.room.voice.stop);
    // ...and it is furniture, not a control: nothing to read out, nothing to tab to.
    expect(ghost.getAttribute('aria-hidden')).toBe('true');
    expect(screen.queryByTestId('voice-stop')).not.toBeInTheDocument();
  });
});
