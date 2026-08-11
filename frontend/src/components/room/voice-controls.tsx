'use client';

import { useTranslations } from 'next-intl';

import { MiniBars } from './persona-tiles';
import { Button } from '../ui';
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

export interface VoiceControlsProps {
  session: UseVoiceSessionResult;
  /** The server's ceiling (`GET /state`). Null means the server named no deadline. */
  expiresAt: string | null;
  captionsOn: boolean;
  onToggleCaptions: () => void;
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

        {/* The VAD is a convenience; this is the enforcement the candidate has (ADR-S06). */}
        {session.recording ? (
          <Button type="button" onClick={() => session.stop()} data-testid="voice-stop">
            {t('voice.stop')}
          </Button>
        ) : null}

        <button
          type="button"
          className={styles.ck}
          onClick={() => session.toggleMute()}
          data-muted={session.muted}
          aria-pressed={session.muted}
        >
          {session.muted ? t('voice.unmute') : t('voice.mute')}
          <MiniBars />
        </button>

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

        {/* One microphone is not a choice, so the control only exists where there is one to
            make — the same gate pre-join's picker uses. Labelled by `aria-label` rather than a
            visible `Field`: the bar is a row of self-describing controls and a stacked label
            would be the only one in it.

            Disabled mid-answer because `selectDevice` releases the track the `MediaRecorder`
            is capturing from; the swap would truncate the answer being given. Between turns —
            and while the mic is lost, which is the case this control exists for — it is live. */}
        {session.devices.length > 1 ? (
          <select
            className={styles.pick}
            aria-label={t('micDevice')}
value={session.deviceId ?? session.devices[0]?.deviceId ?? ''}
            disabled={session.recording}
            onChange={(event) => session.selectDevice(event.target.value)}
            data-testid="mic-device"
          >
            {session.devices.map((device, index) => (
              <option key={device.deviceId} value={device.deviceId}>
                {device.label || t('micDeviceFallback', { n: index + 1 })}
              </option>
            ))}
          </select>
        ) : null}
      </div>
    </>
  );
}
