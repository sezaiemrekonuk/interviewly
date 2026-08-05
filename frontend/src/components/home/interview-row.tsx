'use client';

import { useFormatter, useNow, useTranslations } from 'next-intl';
import Link from 'next/link';
import { useState } from 'react';

import type { MyInterview } from '../../lib/query';
import { useDeleteInterview } from '../../lib/query';
import { useErrorMessage } from '../../lib/use-error-message';

import styles from './home.module.css';

/** `InterviewState` (schema.prisma) split by what the row can offer, not by name. */
const RESUMABLE = new Set(['created', 'profiling', 'hr_round', 'tech_round', 'paused']);
const REPORTED = new Set(['evaluating', 'completed']);

/**
 * The dot is `aria-hidden` and the label always spells the state, so the family is never
 * carried by colour alone. `--success`/`--accent` sit under the AA floor as *text*, which
 * is why they tint an 8px dot and never the words next to it.
 */
function toneFor(state: string): string {
  if (state === 'completed') return styles.chipDone;
  if (RESUMABLE.has(state) || state === 'evaluating') return styles.chipActive;
  return styles.chipQuiet;
}

export function InterviewRow({ interview }: { interview: MyInterview }) {
  const t = useTranslations('home');
  const format = useFormatter();
  // Seeded from the request's global `now` so the first paint matches the server, then ticks:
  // history is a long-lived surface, and a frozen "2 minutes ago" ages into a lie.
  const now = useNow({ updateInterval: 60_000 });
  const errorMessage = useErrorMessage();
  const remove = useDeleteInterview();
  const [confirming, setConfirming] = useState(false);

  const title = interview.occupation ?? t('occupationUnknown');
  const started = interview.startedAt ?? interview.createdAt;

  return (
    <li className={styles.row} data-testid="interview-row">
      <div className={styles.rowMain}>
        <p className={styles.occupation}>{title}</p>
        <p className={styles.meta}>
          <span className={`${styles.chip} ${toneFor(interview.state)}`}>
            <span className={styles.dot} aria-hidden="true" />
            {t(`state.${interview.state}`)}
          </span>
          <time dateTime={started}>{format.relativeTime(new Date(started), now)}</time>
        </p>
        {remove.error ? (
          <p role="alert" className={styles.rowError}>
            {errorMessage(remove.error.code)}
          </p>
        ) : null}
      </div>

      {confirming ? (
        <div className={styles.confirm}>
          <span className={styles.confirmQuestion}>{t('deleteConfirm')}</span>
          <button
            type="button"
            className={styles.confirmAction}
            disabled={remove.isPending}
            onClick={() => remove.mutate(interview.id)}
          >
            {t('deleteConfirmAction')}
          </button>
          <button type="button" className={styles.textAction} onClick={() => setConfirming(false)}>
            {t('cancel')}
          </button>
        </div>
      ) : (
        <div className={styles.rowActions}>
          {RESUMABLE.has(interview.state) ? (
            <Link href={`/interviews/${interview.id}/room`} className={styles.rowLink}>
              {t('continue')}
            </Link>
          ) : null}
          {REPORTED.has(interview.state) ? (
            <Link href={`/interviews/${interview.id}`} className={styles.rowLink}>
              {t('viewReport')}
            </Link>
          ) : null}
          <button
            type="button"
            className={styles.textAction}
            aria-label={t('deleteLabel', { occupation: title })}
            onClick={() => setConfirming(true)}
          >
            {t('delete')}
          </button>
        </div>
      )}
    </li>
  );
}
