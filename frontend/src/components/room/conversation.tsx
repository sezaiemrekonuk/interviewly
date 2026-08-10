'use client';

import { useTranslations } from 'next-intl';
import { useEffect, useRef } from 'react';

import styles from './room.module.css';

export interface ConversationMessage {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  /** Which interviewer said it. Null for the lines that belong to no question. */
  roundType?: 'hr' | 'tech' | null;
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
  personas = [],
  live = false,
  open = true,
}: {
  messages: ConversationMessage[];
  /** Who is in the chair now — the label for any line that belongs to no round. */
  speakerName?: string;
  /**
   * The roster, so a line is labelled with the interviewer who actually said it. Using the
   * current speaker for every line reattributes the whole HR round to the technical
   * interviewer the moment the handover happens.
   */
  personas?: { name: string; roundType: 'hr' | 'tech' }[];
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
      {/* Not "Answers so far" — that heading belongs to `Transcript`, which really is a list of
          answers. Half of what is in here is not an answer and not even a question. */}
      <h2 className={styles.transcriptTitle}>{t('conversationTitle')}</h2>
      {count === 0 ? (
        <p className={styles.transcriptEmpty}>{t('transcriptEmpty')}</p>
      ) : (
        <ol className={styles.transcriptList} aria-live={live ? 'polite' : undefined}>
          {messages.map((message) => (
            <li key={message.id} className={styles.turn} data-role={message.role}>
              <div className={styles.turnPart}>
                <p className={styles.turnSpeaker}>{speakerFor(message)}</p>
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

  function speakerFor(message: ConversationMessage): string {
    if (message.role === 'user') return t('speakerYou');
    // A system row is the server speaking, and saying so matters: it is where the interviewer
    // was overridden, and attributing that to the interviewer would misreport the interview.
    if (message.role === 'system') return t('roleSystem');
    const own = message.roundType && personas.find((p) => p.roundType === message.roundType);
    return own ? own.name : (speakerName ?? t('roleHr'));
  }
}
