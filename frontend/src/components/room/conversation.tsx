'use client';

import { useTranslations } from 'next-intl';
import { useEffect, useRef } from 'react';

import styles from './room.module.css';

export interface ConversationMessage {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
}

/**
 * C02 — what was actually said, in order.
 *
 * `Transcript` next door renders question/answer pairs and stays exactly as it is: that is what
 * a *finished* interview looks like, and the report page reads it. This renders the live thing,
 * which a pair cannot hold — the welcome, a follow-up that belongs to no answer, the handover
 * line, and the system row where the server moved the interviewer on. Two components rather
 * than one with a mode, because the report has no use for any of that.
 *
 * The room is now a chat in text mode and a caption panel in voice mode; the difference is the
 * `speaker` label and where it is mounted, so both use this.
 *
 * `live` puts the list in a polite live region. In voice that is not a nicety — the assistant's
 * words are audio, and this is the only place a screen-reader user meets them at all.
 */
export function Conversation({
  messages,
  speakerName,
  live = false,
  open = true,
}: {
  messages: ConversationMessage[];
  /** Who is in the chair, for the assistant's label. Falls back to the generic role word. */
  speakerName?: string;
  live?: boolean;
  open?: boolean;
}) {
  const t = useTranslations('room');
  const endRef = useRef<HTMLDivElement | null>(null);
  const count = messages.length;

  // Follow the conversation, and only ever downward on a *new* message. Scrolling on every
  // render would fight a candidate who has scrolled up to re-read the question they are
  // answering — which, in a room whose whole point is a long conversation, is most of the time.
  useEffect(() => {
    if (count === 0) return;
    endRef.current?.scrollIntoView({ block: 'end', behavior: 'smooth' });
  }, [count]);

  return (
    <section
      id="room-transcript"
      className={styles.transcriptPanel}
      data-testid="conversation"
      data-open={open ? 'true' : 'false'}
    >
      <h2 className={styles.transcriptTitle}>{t('transcriptTitle')}</h2>
      {count === 0 ? (
        <p className={styles.transcriptEmpty}>{t('transcriptEmpty')}</p>
      ) : (
        <ol className={styles.transcriptList} aria-live={live ? 'polite' : undefined}>
          {messages.map((message) => (
            <li key={message.id} className={styles.turn} data-role={message.role}>
              <div className={styles.turnPart}>
                <p className={styles.turnSpeaker}>{speakerFor(message.role)}</p>
                <p className={message.role === 'user' ? styles.turnAnswer : styles.turnQuestion}>
                  {message.content}
                </p>
              </div>
            </li>
          ))}
          <div ref={endRef} aria-hidden="true" />
        </ol>
      )}
    </section>
  );

  function speakerFor(role: ConversationMessage['role']): string {
    if (role === 'user') return t('speakerYou');
    // A system row is the server speaking, and saying so matters: it is where the interviewer
    // was overridden, and attributing that to the interviewer would misreport the interview.
    if (role === 'system') return t('roleSystem');
    return speakerName ?? t('roleHr');
  }
}
