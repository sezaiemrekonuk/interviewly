'use client';

import { useTranslations } from 'next-intl';

import { Button } from '../ui';
import type { CameraDevice } from '../camera-view';
import type { UseVoiceSessionResult } from '../../lib/use-voice-session';
import { useErrorMessage } from '../../lib/use-error-message';
import { useNowMs } from '../../lib/use-clock';
import styles from './room.module.css';

const cx = (...names: Array<string | false | undefined>) => names.filter(Boolean).join(' ');

/** Failures a re-record or a retry can actually clear. Everything else the room resolves on
 *  its own — a downgrade, a ceiling refetch, or an interview that cannot continue in voice. */
const RETRYABLE_CODES = new Set(['SPEECH_AUDIO_INVALID', 'SPEECH_TRANSCRIPTION_FAILED', 'UNKNOWN']);

/** Late enough to be news, early enough to finish a sentence and be asked one more question. */
const WARN_AT_SECONDS = 60;

const mmss = (seconds: number) =>
  `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;

/**
 * Seconds left: the server's deadline minus the shared clock, subtracted afresh every tick and
 * never decremented. A local total is a second clock, and two clocks are how a candidate is told
 * they have four minutes and cut off in one — a slept tab, a refetch that moved the deadline and
 * a machine whose clock jumped all land back on the server's number here.
 */
function useRemaining(expiresAt: string | null): number | null {
  const nowMs = useNowMs();
  const deadline = expiresAt ? Date.parse(expiresAt) : Number.NaN;
  if (!nowMs || Number.isNaN(deadline)) return null;
  return Math.max(0, Math.round((deadline - nowMs) / 1000));
}

/**
 * The countdown. It is a readout, never the enforcement — hiding it, backgrounding the tab or
 * blocking this render changes nothing about when the server ends the interview (ADR-S06).
 *
 * The warning is a word as well as a tone (`ui` §4.4), and it is announced from a live region
 * holding one fixed sentence: putting the ticking figure in there would re-read every second.
 * Its text never changes once shown, so there is no latch — but since I16 made `expiresAt` a
 * moving deadline (it slides forward by whatever the candidate spends out of the room), the
 * warning can now un-show as well as show. That is correct and not a flicker: the deadline moved
 * because the interview genuinely has more time left than it did.
 */
function TimeRemaining({ expiresAt }: { expiresAt: string | null }) {
  const t = useTranslations('room');
  const remaining = useRemaining(expiresAt);
  const warn = remaining !== null && remaining <= WARN_AT_SECONDS;

  return (
    <>
      <span className={styles.srOnly} role="status" data-testid="time-warning">
        {warn ? t('timeLeftAnnounce') : ''}
      </span>
      {remaining === null ? null : (
        <span className={styles.remaining} data-warn={warn} data-testid="time-remaining">
          <span className={styles.ckSub}>{warn ? t('timeLeftWarning') : t('timeLeftLabel')}</span>
          <span className="tabular">{mmss(remaining)}</span>
        </span>
      )}
    </>
  );
}

/**
 * The device menu welded to a switch. The `<select>` is a real one — keyboard, screen reader,
 * the platform's own menu — laid transparently over a caret, because a native select renders
 * its selected option's text and the microphone's name is longer than the control it belongs
 * to. The switch says what it does; this says which device it does it with.
 */
function Picker({
  label,
  value,
  options,
  onChange,
  disabled = false,
  testId,
}: {
  label: string;
  value: string;
  options: { value: string; label: string }[];
  onChange: (value: string) => void;
  disabled?: boolean;
  testId: string;
}) {
  if (options.length === 0) return null;

  return (
    <span className={styles.caret} data-disabled={disabled || undefined}>
      <svg viewBox="0 0 12 12" width="12" height="12" aria-hidden="true" focusable="false">
        <path d="M2 4.5 6 8.5 10 4.5" fill="none" stroke="currentColor" strokeWidth="1.5" />
      </svg>
      <select
        className={styles.caretSelect}
        aria-label={label}
        value={value}
        disabled={disabled}
        onChange={(event) => onChange(event.target.value)}
        data-testid={testId}
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </span>
  );
}

export interface VoiceControlsProps {
  session: UseVoiceSessionResult;
  /** The server's ceiling (`GET /state`). Null means the server named no deadline. */
  expiresAt: string | null;
  captionsOn: boolean;
  onToggleCaptions: () => void;
  /** The candidate's own camera — optional, off by default, and never leaves the tab (§3.2). */
  cameraOn: boolean;
  onToggleCamera: () => void;
  cameras: CameraDevice[];
  cameraId: string | null;
  onSelectCamera: (deviceId: string) => void;
  transcriptOpen: boolean;
  onToggleTranscript: () => void;
}

/**
 * The control bar: a floating sheet in the stage's foot row — a grid row of its own, not an
 * absolutely positioned overlay, so a wrap at a narrow width pushes the captions up instead
 * of landing on them.
 *
 * Mute is stated in words, never a red icon alone (DESIGN §5): the one piece of state the
 * candidate needs mid-sentence must not sit behind colour vision. Leave is the only
 * `--danger` in the room.
 */
export function VoiceControls({
  session,
  expiresAt,
  captionsOn,
  onToggleCaptions,
  cameraOn,
  onToggleCamera,
  cameras,
  cameraId,
  onSelectCamera,
  transcriptOpen,
  onToggleTranscript,
}: VoiceControlsProps) {
  const t = useTranslations('room');
  const errorMessage = useErrorMessage();
  const lost = session.status === 'lost';

  const code = session.error;
  // Room-honest copy per code — the generic `errors` namespace is wrong in the room (a 403
  // there reads "no permission", the ceiling reads "start it again"). Unmapped codes fall back
  // to it rather than leaking a bare code.
  const failKey = code
    ? (`voice.failure.${code}` as Parameters<typeof t.has>[0])
    : null;
  const failMessage = code ? (failKey && t.has(failKey) ? t(failKey) : errorMessage(code)) : null;
  // Retry only where re-recording can clear it. Every other failure the room resolves itself: a
  // downgrade or a ceiling refetch navigates away, a 403 cannot continue in voice at all —
  // offering a button that re-issues the same refusal is worse than offering none.
  const retryable = code !== null && RETRYABLE_CODES.has(code);

  return (
    <>
      {/* S06 threads the code here; S10 branches copy and action on it. */}
      {code ? (
        <div className={cx(styles.notice, styles.noticeDanger)} data-testid="voice-error">
          <p className={styles.error} role="alert">
            {failMessage}
          </p>
          {retryable ? (
            <Button type="button" onClick={() => session.retry()} data-testid="voice-retry">
              {t('retry')}
            </Button>
          ) : null}
        </div>
      ) : null}

      {lost ? (
        <div
          className={cx(styles.notice, styles.noticeDanger)}
          data-testid="session-lost"
          role="alert"
        >
          <p className={styles.noticeText}>{t('voice.micLost')}</p>
          <Button type="button" onClick={() => session.reconnect()}>
            {t('voice.reconnect')}
          </Button>
        </div>
      ) : null}

      <div className={styles.bar} data-testid="voice-controls">
        <TimeRemaining expiresAt={expiresAt} />

        {/* T04 — the recorder stopped on a pause, the turn did not. Said plainly, because the
            bars alone cannot distinguish "still listening" from "listening again", and a
            candidate who thinks the pause cost them their sentence starts it over. No live
            region: it is a state of the room, and the interviewer's words own the announcing. */}
        {session.recording && session.holding ? (
          <p className={styles.pauseLine} data-testid="voice-holding">
            {t('voice.stillListening')}
          </p>
        ) : null}

        {/* The VAD is a convenience; this is the enforcement the candidate has (ADR-S06).
            The SLOT is always in the row, and always exactly this wide. Rendering the button
            only while recording used to insert and remove an item in the middle of a wrapping
            bar, so Mute, Camera, Captions and Transcript all moved twice per turn — and the one
            control a candidate reaches for under time pressure was never in the same place.
            The ghost is a real `Button` rather than a `min-width`: `voice.stop` is translated,
            and a number that fits "Stop" is the wrong number for "Durdur". Same component, same
            padding and weight, so the two can never drift apart. */}
        <div className={styles.stopSlot}>
          <Button
            type="button"
            className={styles.stopGhost}
            aria-hidden="true"
            tabIndex={-1}
            data-testid="voice-stop-slot"
          >
            {t('voice.stop')}
          </Button>
          {session.recording ? (
            <Button type="button" onClick={() => session.stop()} data-testid="voice-stop">
              {t('voice.stop')}
            </Button>
          ) : null}
        </div>

        {/* Mute and Camera are one control each: the switch, and the caret that says which
            device it switches. Together, and before the captions — the two things a candidate
            reaches for mid-sentence sit at the same end of the bar every time.

            The picker is disabled mid-answer: `selectDevice` releases the track the
            `MediaRecorder` is reading, and the swap would truncate the answer being given. */}
        <div className={styles.group}>
          <button
            type="button"
            className={styles.ck}
            onClick={() => session.toggleMute()}
            data-off={session.muted}
            aria-pressed={session.muted}
          >
            {t('voice.mute')}
          </button>
          <Picker
            label={t('micDevice')}
            value={session.deviceId ?? session.devices[0]?.deviceId ?? ''}
            disabled={session.recording}
            onChange={session.selectDevice}
            options={session.devices.map((device, index) => ({
              value: device.deviceId,
              label: device.label || t('micDeviceFallback', { n: index + 1 }),
            }))}
            testId="mic-device"
          />
        </div>

        <div className={styles.group}>
          <button
            type="button"
            className={styles.ck}
            onClick={onToggleCamera}
            data-off={!cameraOn}
            aria-pressed={cameraOn}
            data-testid="camera-toggle"
          >
            {t('camera')}
          </button>
          <Picker
            label={t('cameraDevice')}
            value={cameraId ?? cameras[0]?.deviceId ?? ''}
            onChange={onSelectCamera}
            options={cameras.map((device, index) => ({
              value: device.deviceId,
              label: device.label || t('cameraDeviceFallback', { n: index + 1 }),
            }))}
            testId="camera-device"
          />
        </div>

        <button
          type="button"
          className={styles.ck}
          onClick={onToggleCaptions}
          aria-pressed={captionsOn}
        >
          {t('captions')}
          <span className={styles.ckSub}>{captionsOn ? t('stateOn') : t('stateOff')}</span>
        </button>

        <button
          type="button"
          className={styles.ck}
          onClick={onToggleTranscript}
          aria-pressed={transcriptOpen}
          aria-controls="room-transcript"
        >
          {t('transcriptToggle')}
        </button>
      </div>
    </>
  );
}
