'use client';

import { useTranslations } from 'next-intl';
import { useEffect, useState } from 'react';

import { RailBlock, RailFoot, RailMark, RailValue } from '../shell/split-shell';
import type { InterviewStateResponse } from '../../lib/query';
import type { VoiceConnectionStatus } from '../../lib/use-voice-session';

import styles from './room.module.css';

const cx = (...names: Array<string | false | undefined>) => names.filter(Boolean).join(' ');

const clock = (seconds: number) =>
  `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;

/**
 * ponytail: counts from arrival in the room. `GET /interviews/:id/state` carries no session
 * start, so a reload restarts this clock — which is exactly what the Spec mark on the label
 * admits. Read a server `startedAt` here the moment the endpoint carries one.
 */
function useElapsed(): number {
  const [seconds, setSeconds] = useState(0);
  useEffect(() => {
    const timer = setInterval(() => setSeconds((value) => value + 1), 1000);
    return () => clearInterval(timer);
  }, []);
  return seconds;
}

/**
 * The context column: state only. Who is in the room is on the stage — repeating the roster
 * here is the crowding this redesign exists to remove.
 */
export function RoomRail({
  room,
  voiceStatus,
  onLeave,
}: {
  room: InterviewStateResponse;
  /** Voice mode only; text has no connection to report. */
  voiceStatus: VoiceConnectionStatus | null;
  onLeave: () => void;
}) {
  const t = useTranslations('room');
  const tSetup = useTranslations('setup');
  const elapsed = useElapsed();

  const total = Math.max(room.targetQuestionCount, 0);
  const index = Math.min(room.currentIndex, total);
  // `current_index` is 1 from the first question onwards, so 0 is an interview that has not
  // started — and "Question 0 of 8" is a count no healthy interview ever reaches (#89).
  const started = index >= 1;

  return (
    <>
      <RailMark href="/" />

      <RailBlock
        label={t('roundLabel')}
        note={started ? t('progress', { index, total: room.targetQuestionCount }) : t('notStarted')}
      >
        <RailValue>{room.state === 'tech_round' ? t('roundTech') : t('roundHr')}</RailValue>
        {/* Decorative: the line under it is the accessible truth (ui §4.4). Answered segments
            carry their own round's tone, so the shape of the interview reads at a glance. */}
        <div className={styles.ticks} aria-hidden="true">
          {Array.from({ length: total }, (_, position) => {
            const answered = room.transcript[position];
            return (
              <i
                key={position}
                className={cx(
                  styles.tick,
                  position === index - 1
                    ? styles.tickNow
                    : answered && (answered.roundType === 'hr' ? styles.tickHr : styles.tickTech),
                )}
              />
            );
          })}
        </div>
      </RailBlock>

      {/* No `Spec` badge: that marker means "specified, not yet built" to an operator reading
          the admin console, and it means nothing at all to a candidate mid-interview. The clock
          counts from arrival in the room, which the label now says rather than a badge. */}
      <RailBlock label={t('elapsedLabel')} note={t('elapsedNote')}>
        <span className={`tabular ${styles.timer}`}>{clock(elapsed)}</span>
      </RailBlock>

      {/* The way out, on the rail, in both modes. It used to live inside `VoiceControls`,
          which renders only when `mode === 'voice'` — so a text interview was a room with no
          door, and the only exit was the browser's back button. */}
      <button type="button" className={styles.leave} onClick={onLeave}>
        {t('leave')}
      </button>

      <RailFoot>
        <span
          className={styles.railLive}
          data-status={voiceStatus ?? 'live'}
          data-testid={voiceStatus ? 'voice-status' : undefined}
        >
          <span className={styles.dot} aria-hidden="true" />
          {voiceStatus ? t(`voice.status.${voiceStatus}`) : t('railLive')}
        </span>
        <span className="tabular">
          {room.mode === 'voice' ? tSetup('modeVoice') : tSetup('modeText')}
        </span>
      </RailFoot>
    </>
  );
}
