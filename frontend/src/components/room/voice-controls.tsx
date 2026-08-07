'use client';

import { useTranslations } from 'next-intl';

import { MiniBars } from './persona-tiles';
import { Button } from '../ui';
import type { UseVoiceSessionResult } from '../../lib/use-voice-session';
import styles from './room.module.css';

const cx = (...names: Array<string | false | undefined>) => names.filter(Boolean).join(' ');

export interface VoiceControlsProps {
  session: UseVoiceSessionResult;
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
  captionsOn,
  onToggleCaptions,
  transcriptOpen,
  onToggleTranscript,
}: VoiceControlsProps) {
  const t = useTranslations('room');
  const lost = session.status === 'lost';

  return (
    <>
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
