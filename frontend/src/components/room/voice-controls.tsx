'use client';

import { useTranslations } from 'next-intl';

import { Button } from '../ui';
import type { UseVoiceSessionResult } from '../../lib/use-voice-session';
import styles from './room.module.css';

export interface VoiceControlsProps {
  session: UseVoiceSessionResult;
}

/**
 * The sticky bottom bar, mirroring `.composer`. Status is a text chip on purpose (DESIGN §5):
 * a coloured dot alone puts the one piece of state the candidate needs behind colour vision.
 */
export function VoiceControls({ session }: VoiceControlsProps) {
  const t = useTranslations('room');
  const lost = session.status === 'lost';

  return (
    <div className={styles.voiceBar} data-testid="voice-controls">
      {lost ? (
        <div className={styles.sessionLost} data-testid="session-lost" role="alert">
          <p className={styles.sessionLostText}>{t('voice.lost')}</p>
          <Button type="button" onClick={() => session.reconnect()}>
            {t('voice.reconnect')}
          </Button>
        </div>
      ) : null}

      <div className={styles.voiceRow}>
        <button
          type="button"
          className={styles.voiceButton}
          onClick={() => session.toggleMute()}
          data-muted={session.muted}
          aria-pressed={session.muted}
        >
          {session.muted ? t('voice.unmute') : t('voice.mute')}
        </button>

        <div className={styles.micMeter}>
          {/* Decorative: the muted label on the button is the accessible truth. */}
          <div className={styles.micTrack} aria-hidden="true">
            <div
              className={styles.micFill}
              style={{ width: `${Math.round(Math.min(1, session.micLevel) * 100)}%` }}
            />
          </div>
        </div>

        <span className={styles.voiceStatus} data-testid="voice-status">
          {t(`voice.status.${session.status}`)}
        </span>
      </div>
    </div>
  );
}
