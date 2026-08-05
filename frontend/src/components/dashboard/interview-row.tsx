'use client';

import Link from 'next/link';
import { useFormatter, useTranslations } from 'next-intl';

import styles from '../../app/dashboard/dashboard.module.css';
import type { InterviewListItem } from '../../lib/query';
import { useDeleteInterview } from '../../lib/query';

/**
 * `ended_reason` is null while the interview is still live, so the outcome falls back to
 * the state. `evaluating` gets its own word — the report is not readable yet, and W07
 * renders the wait beat at the same URL, so the link stays valid either way.
 */
function outcomeKey(item: InterviewListItem): string {
  if (item.endedReason) return item.endedReason;
  return item.state === 'evaluating' ? 'evaluating' : 'inProgress';
}

export function InterviewRow({ item }: { item: InterviewListItem }) {
  const t = useTranslations('dashboard');
  const format = useFormatter();
  const del = useDeleteInterview();

  // A key that arrives over the wire is a plain string; the message tree is typed.
  const outcome = t(`outcome.${outcomeKey(item)}` as Parameters<typeof t>[0]);

  return (
    <li className={styles.row} data-testid="interview-row">
      <Link className={styles.rowLink} href={`/interviews/${item.id}`}>
        <span className={styles.occupation}>{item.occupation ?? t('noOccupation')}</span>
        <span className={styles.meta}>
          {outcome} ·{' '}
          {t('startedOn', {
            date: format.dateTime(new Date(item.startedAt ?? item.createdAt), {
              dateStyle: 'medium',
            }),
          })}
        </span>
      </Link>
      <button
        className={styles.delete}
        type="button"
        disabled={del.isPending}
        onClick={() => del.mutate(item.id)}
        aria-label={t('deleteLabel')}
      >
        {t('delete')}
      </button>
    </li>
  );
}
