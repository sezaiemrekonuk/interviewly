'use client';

import { useFormatter, useTranslations } from 'next-intl';
import { useState } from 'react';

import { Link } from '../../i18n/navigation';
import type { AdminQueueResponse } from '../../lib/query';
import type { RowSpec } from '../../lib/row-query';
import { fieldDescriptors, filterRows, sortRows } from '../../lib/row-query';

import styles from './panels.module.css';
import own from './queue-panel.module.css';
import { FilterBuilder } from './filter-builder';
import { SortHeader } from './sort-header';
// The dead letter is a table, and the console already has one table vocabulary.
import table from './table.module.css';

type DeadLetterRow = AdminQueueResponse['deadLetter'][number];

/**
 * The dead letter arrives whole inside `GET /admin/queue` — twenty rows at most — so its search
 * is a predicate over the array rather than a round trip. `interview` is the name the list
 * sections already use for an interview id (`backend/modules/admin/specs.ts`).
 */
const DEAD_LETTER_SPEC: RowSpec<DeadLetterRow> = {
  fields: {
    interview: { get: (row) => row.interviewId, kind: 'text' },
    attempts: { get: (row) => row.attemptsMade, kind: 'number' },
    reason: { get: (row) => row.failedReason, kind: 'text' },
    failed: { get: (row) => row.failedAt, kind: 'date' },
  },
  freeText: ['interview', 'reason'],
  sortable: ['failed', 'attempts', 'interview'],
  defaultSort: 'failed',
};

/**
 * Queue depth and the dead letter. `/admin/queue` reports the report queue and only that one
 * — question generation and scoring run inline on the request — so this reads `queues[0]`
 * rather than looping over a list that is structurally length 1.
 */
export function QueuePanel({ data }: { data: AdminQueueResponse }) {
  const t = useTranslations('admin');
  const format = useFormatter();

  const [query, setQuery] = useState('');
  const [sort, setSort] = useState<{ field: string; dir: 'asc' | 'desc' }>({
    field: DEAD_LETTER_SPEC.defaultSort,
    dir: 'desc',
  });

  const found = filterRows(data.deadLetter, query, DEAD_LETTER_SPEC);
  const rows = sortRows(found.rows, sort.field, sort.dir, DEAD_LETTER_SPEC);

  /**
   * Same column flips the direction; a different column starts at descending — newest, biggest,
   * most attempts first is what an operator means by "sort by this". The rule `/admin` uses.
   */
  const onSort = (field: string) =>
    setSort((current) => ({
      field,
      dir: field === current.field && current.dir === 'desc' ? 'asc' : 'desc',
    }));

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

        {/* Hidden while the dead letter is empty: a box that can only ever return the same
            empty table is chrome. */}
        {data.deadLetter.length > 0 ? (
          <FilterBuilder
            value={query}
            onChange={setQuery}
            fields={fieldDescriptors(DEAD_LETTER_SPEC)}
          />
        ) : null}

        {rows.length === 0 ? (
          // Two different facts: no job has died, versus the search matched none of the ones
          // that did. `stats.empty` ("No data yet") is the closest existing key for the second
          // — a dedicated `queue.deadLetterNoMatch` would say it better if anyone adds one.
          <p className={styles.empty}>
            {t(data.deadLetter.length === 0 ? 'queue.deadLetterEmpty' : 'stats.empty')}
          </p>
        ) : (
          <div className={table.scroller}>
            <table className={table.table}>
              <thead>
                <tr>
                  <SortHeader
                    field="interview"
                    label={t('queue.col.interview')}
                    sort={sort}
                    onSort={onSort}
                  />
                  <SortHeader
                    field="attempts"
                    label={t('queue.col.attempts')}
                    sort={sort}
                    onSort={onSort}
                    numeric
                  />
                  <th scope="col">{t('queue.col.reason')}</th>
                  <SortHeader
                    field="failed"
                    label={t('queue.col.when')}
                    sort={sort}
                    onSort={onSort}
                  />
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
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
