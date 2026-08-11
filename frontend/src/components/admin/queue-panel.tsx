'use client';

import { useFormatter, useTranslations } from 'next-intl';

import { Link } from '../../i18n/navigation';
import type { AdminQueueResponse } from '../../lib/query';

import styles from './panels.module.css';
import own from './queue-panel.module.css';
// The dead letter is a table, and the console already has one table vocabulary.
import table from './table.module.css';

/**
 * Queue depth and the dead letter. `/admin/queue` reports the report queue and only that one
 * — question generation and scoring run inline on the request — so this reads `queues[0]`
 * rather than looping over a list that is structurally length 1.
 */
export function QueuePanel({ data }: { data: AdminQueueResponse }) {
  const t = useTranslations('admin');
  const format = useFormatter();

  const queue = data.queues[0];
  const figures = [
    { key: 'waiting', name: t('queue.waiting'), value: queue?.waiting ?? 0 },
    { key: 'running', name: t('queue.running'), value: queue?.active ?? 0 },
    { key: 'delayed', name: t('queue.delayed'), value: queue?.delayed ?? 0 },
    { key: 'failed', name: t('queue.failed'), value: queue?.failed ?? 0 },
    { key: 'completed', name: t('queue.completed'), value: queue?.completed ?? 0 },
  ];

  return (
    <section
      className={styles.panel}
      data-testid="admin-queue"
      aria-labelledby="admin-queue-heading"
    >
      <div>
        <h2 className={styles.title} id="admin-queue-heading">
          {t('queue.heading')}
        </h2>
        <p className={styles.note}>{t('queue.note')}</p>
      </div>

      <div className={styles.figures}>
        {figures.map((figure) => (
          <div className={styles.figure} key={figure.key}>
            <span className={styles.eyebrow}>{figure.name}</span>
            {/* Waiting and delayed drain by themselves; a failed job never does, so it is
                the one count here that earns the attention colour. The eyebrow still names
                it, so the colour is never the only thing carrying the state. */}
            <p
              className={`${styles.figureValue} tabular${
                figure.key === 'failed' && figure.value > 0 ? ` ${own.alarm}` : ''
              }`}
              data-testid={`admin-queue-${figure.key}`}
            >
              {format.number(figure.value)}
            </p>
          </div>
        ))}
      </div>

      <div className={styles.card}>
        <h3 className={styles.title}>{t('queue.deadLetterTitle')}</h3>
        <p className={styles.note}>{t('queue.deadLetterNote')}</p>

        {data.deadLetter.length === 0 ? (
          <p className={styles.empty}>{t('queue.deadLetterEmpty')}</p>
        ) : (
          <div className={table.scroller}>
            <table className={table.table}>
              <thead>
                <tr>
                  <th scope="col">{t('queue.col.interview')}</th>
                  <th scope="col" className={table.num}>
                    {t('queue.col.attempts')}
                  </th>
                  <th scope="col">{t('queue.col.reason')}</th>
                  <th scope="col">{t('queue.col.when')}</th>
                </tr>
              </thead>
              <tbody>
                {data.deadLetter.map((row) => (
                  <tr key={row.id} data-testid="admin-deadletter-row">
                    <td className={`${table.id} tabular`} title={row.interviewId}>
                      <Link href={`/admin/interviews/${row.interviewId}`}>{row.interviewId}</Link>
                    </td>
                    <td className={`${table.num} tabular`}>{format.number(row.attemptsMade)}</td>
                    {/* A failure reason is a sentence or a stack trace: one line in the
                        cell, the whole of it in the title. */}
                    <td className={table.occupation} title={row.failedReason ?? undefined}>
                      {row.failedReason ?? t('queue.noReason')}
                    </td>
                    <td className="tabular">
                      {row.failedAt
                        ? format.dateTime(new Date(row.failedAt), {
                            dateStyle: 'short',
                            timeStyle: 'medium',
                          })
                        : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </section>
  );
}
