'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';

import { RailBlock, RailFoot, RailMark, RailValue } from '../shell/split-shell';
import type { InterviewStateResponse } from '../../lib/query';
import { useRoomElapsed } from '../../lib/use-room-clock';
import type { VoiceConnectionStatus } from '../../lib/use-voice-session';

import styles from './room.module.css';

const cx = (...names: Array<string | false | undefined>) => names.filter(Boolean).join(' ');

const clock = (seconds: number) =>
  `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;

/**
 * The context column: state only. Who is in the room is on the stage — repeating the roster
 * here is the crowding this redesign exists to remove.
 */
export function RoomRail({
  room,
  roomUpdatedAt,
  voiceStatus,
  onLeave,
  leaving = false,
  leaveError = null,
}: {
  room: InterviewStateResponse;
  /**
   * When `room` arrived (react-query's `dataUpdatedAt`). I16's elapsed figure is a snapshot, so
   * the readout needs the instant it was taken as well as the number.
   */
  roomUpdatedAt: number;
  /** Voice mode only; text has no connection to report. */
  voiceStatus: VoiceConnectionStatus | null;
  /** Confirmed, not merely requested — the rail owns the confirm step, the page owns the call. */
  onLeave: () => void;
  leaving?: boolean;
  leaveError?: string | null;
}) {
  const t = useTranslations('room');
  const tSetup = useTranslations('setup');
  // I16 — time in the room, not time since the interview began. A candidate who steps out at
  // 03:00 and comes back an hour later sees 03:00, because the server stopped counting when the
  // heartbeat did.
  const elapsed = useRoomElapsed(room.elapsedSeconds, roomUpdatedAt);
  const [confirming, setConfirming] = useState(false);

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

      <RailBlock label={t('elapsedLabel')} note={t('elapsedNote')}>
        <span className={`tabular ${styles.timer}`} data-testid="room-elapsed">
          {clock(elapsed)}
        </span>
      </RailBlock>

      {/* The way out, on the rail, in both modes. It used to live inside `VoiceControls`,
          which renders only when `mode === 'voice'` — so a text interview was a room with no
          door, and the only exit was the browser's back button.

          Behind a confirm since issue 104, because the button stopped being navigation: it
          ends the interview, and an interview cannot be un-ended. The confirm says which of
          the two endings this is — a run with answers goes to its report, one without does
          not — so the candidate chooses between outcomes rather than agreeing to a warning. */}
      {confirming ? (
        <div className={styles.leaveConfirm} data-testid="room-leave-confirm">
          <p className={styles.leaveConfirmQuestion}>
            {/* The same fact the server branches on — `transcript` is the answered turns, so
                the two cannot promise different endings for the same interview. */}
            {room.transcript.length > 0 ? t('leaveConfirmScored') : t('leaveConfirmEmpty')}
          </p>
          <button
            type="button"
            className={styles.leaveConfirmAction}
            disabled={leaving}
            onClick={onLeave}
          >
            {t('leaveConfirmAction')}
          </button>
          <button
            type="button"
            className={styles.leaveCancel}
            disabled={leaving}
            onClick={() => setConfirming(false)}
          >
            {t('leaveCancel')}
          </button>
          {leaveError ? (
            <p role="alert" className={styles.leaveError}>
              {leaveError}
            </p>
          ) : null}
        </div>
      ) : (
        <button type="button" className={styles.leave} onClick={() => setConfirming(true)}>
          {t('leave')}
        </button>
      )}

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
