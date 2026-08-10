'use client';

import { useTranslations } from 'next-intl';

import { MiniBars } from './persona-tiles';
import { Button } from '../ui';
import type { UseVoiceSessionResult } from '../../lib/use-voice-session';
import { useErrorMessage } from '../../lib/use-error-message';
import { useNowMs } from '../../lib/use-clock';
import styles from './room.module.css';

const cx = (...names: Array<string | false | undefined>) => names.filter(Boolean).join(' ');

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
 * No latch on the announcement — the sentence appears when `warn` does and its text never
 * changes after, because `expiresAt` only ever shortens and the remaining time only falls.
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

  return (
    <>
      {/* S06: a turn that failed says which failure it was and offers the one action that can
          succeed. S10 refines the copy per code; the branch is the hook's. */}
      {session.error ? (
        <div className={cx(styles.notice, styles.noticeDanger)} data-testid="voice-error">
          <p className={styles.error} role="alert">
            {errorMessage(session.error)}
          </p>
          <Button type="button" onClick={() => session.retry()} data-testid="voice-retry">
            {t('retry')}
          </Button>
        </div>
      ) : null}

      {lost ? (
        <div
          className={cx(styles.notice, styles.noticeDanger)}
          data-testid="session-lost"
          role="alert"
        >
          <p className={styles.noticeText}>{t('voice.lost')}</p>
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

      </div>
    </>
  );
}
