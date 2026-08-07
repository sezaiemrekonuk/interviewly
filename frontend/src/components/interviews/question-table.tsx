'use client';

import { useFormatter, useTranslations } from 'next-intl';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';

import type { MyQuestion } from '../../lib/query';

import styles from './question-table.module.css';

const cx = (...names: Array<string | false | undefined>) => names.filter(Boolean).join(' ');

const SCORE_MAX = 5;
const ROUNDS = ['all', 'hr', 'tech'] as const;
const SORTS = ['recent', 'worst'] as const;

type Round = (typeof ROUNDS)[number];
type Sort = (typeof SORTS)[number];

/**
 * Every question this account has answered, in one table.
 *
 * Filtering and sorting happen on what has been fetched rather than on the server: the endpoint
 * is cursor-paged with no sort parameter, and asking it for "worst first" would mean either a
 * new query parameter or an offset page — and a candidate's whole history is tens of rows, not
 * thousands. If that stops being true the sort moves to `/me/questions` and this stays.
 *
 * `ponytail: client-side sort over fetched pages. Move to the endpoint if anyone reaches a
 * few hundred answered questions.`
 */
export function QuestionTable({
  rows,
  hasMore,
  loadingMore,
  onLoadMore,
}: {
  rows: MyQuestion[];
  hasMore: boolean;
  loadingMore: boolean;
  onLoadMore: () => void;
}) {
  const t = useTranslations('archive.questions');
  const tRound = useTranslations('dashboard.rounds');
  const format = useFormatter();
  const router = useRouter();
  const params = useSearchParams();

  const round = (ROUNDS.find((r) => r === params.get('round')) ?? 'all') as Round;
  const sort = (SORTS.find((s) => s === params.get('sort')) ?? 'recent') as Sort;

  function setParam(key: 'round' | 'sort', value: string) {
    const next = new URLSearchParams(params.toString());
    next.set('view', 'questions');
    if (value === 'all' || value === 'recent') next.delete(key);
    else next.set(key, value);
    router.replace(`/interviews?${next.toString()}`);
  }

  const visible = rows
    .filter((row) => round === 'all' || row.roundType === round)
    .slice()
    .sort((a, b) => {
      if (sort === 'worst') {
        // Unscored rows go last: a question with no report is not a weakness, and sorting it
        // to the top of "worst first" would put the least informative rows in the best seats.
        const as = a.score ?? Number.POSITIVE_INFINITY;
        const bs = b.score ?? Number.POSITIVE_INFINITY;
        if (as !== bs) return as - bs;
      }
      return (b.answeredAt ?? '').localeCompare(a.answeredAt ?? '');
    });

  if (rows.length === 0) {
    return (
      <div className={styles.empty}>
        <h2 className={styles.emptyTitle}>{t('empty.title')}</h2>
        <p className={styles.emptyBody}>{t('empty.body')}</p>
      </div>
    );
  }

  return (
    <>
      <div className={styles.filters}>
        <fieldset className={styles.filterGroup}>
          <legend className={styles.filterLegend}>{t('roundFilter')}</legend>
          {ROUNDS.map((key) => (
            <button
              key={key}
              type="button"
              aria-pressed={key === round}
              className={cx(styles.chip, key === round && styles.chipOn)}
              onClick={() => setParam('round', key)}
            >
              {key === 'all' ? t('allRounds') : tRound(key)}
            </button>
          ))}
        </fieldset>

        <fieldset className={styles.filterGroup}>
          <legend className={styles.filterLegend}>{t('sortBy')}</legend>
          {SORTS.map((key) => (
            <button
              key={key}
              type="button"
              aria-pressed={key === sort}
              className={cx(styles.chip, key === sort && styles.chipOn)}
              onClick={() => setParam('sort', key)}
            >
              {t(`sorts.${key}`)}
            </button>
          ))}
        </fieldset>

        <p className={styles.count} role="status">
          {t('count', { shown: visible.length })}
        </p>
      </div>

      {/* The table scrolls inside its own wrapper, so the page body never scrolls sideways. */}
      <div className={styles.wrapper}>
        <table className={styles.table}>
          <caption className={styles.srOnly}>{t('caption')}</caption>
          <thead>
            <tr>
              <th scope="col">{t('columns.question')}</th>
              <th scope="col">{t('columns.round')}</th>
              <th scope="col" className={styles.numeric}>
                {t('columns.score')}
              </th>
              <th scope="col" className={styles.numeric}>
                {t('columns.star')}
              </th>
              <th scope="col">{t('columns.when')}</th>
              <th scope="col">
                <span className={styles.srOnly}>{t('columns.open')}</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {visible.map((row) => (
              <tr key={row.questionId}>
                <td className={styles.questionCell}>
                  <p className={styles.question}>{row.text}</p>
                  {/* The written mark, under the question it belongs to. This is the only
                      part of a score anyone can act on, and it was buried inside one report. */}
                  {row.reason ? <p className={styles.reason}>{row.reason}</p> : null}
                </td>
                <td>
                  <span className={styles.roundChip}>{tRound(row.roundType)}</span>
                </td>
                <td className={styles.numeric}>
                  {row.score === null ? (
                    <span className={styles.none}>{t('noScore')}</span>
                  ) : (
                    <span
                      className={cx(styles.score, 'tabular')}
                      data-band={row.score <= 2 ? 'low' : row.score === 3 ? 'mid' : 'high'}
                    >
                      {row.score}
                      <span className={styles.outOf}>{t('outOf', { max: SCORE_MAX })}</span>
                    </span>
                  )}
                </td>
                {/* STAR is a behavioural-story rubric. The backend scores it 0 on a technical
                    question because it never applied, and "0%" beside a 4/5 and a praising
                    reason reads as either broken scoring or an unnamed disaster. Not applicable
                    is a third state, distinct from `noScore`'s "not scored yet". */}
                <td className={cx(styles.numeric, 'tabular')}>
                  {row.roundType === 'tech' ? (
                    <span className={styles.none}>{t('starNotApplicable')}</span>
                  ) : row.starAdherence === null ? (
                    <span className={styles.none}>{t('noScore')}</span>
                  ) : (
                    `${Math.round(row.starAdherence * 100)}%`
                  )}
                </td>
                <td className={styles.when}>
                  {row.answeredAt ? (
                    <time dateTime={row.answeredAt}>
                      {format.dateTime(new Date(row.answeredAt), {
                        day: 'numeric',
                        month: 'short',
                        year: 'numeric',
                      })}
                    </time>
                  ) : null}
                </td>
                <td>
                  <Link href={`/interviews/${row.interviewId}`} className={styles.open}>
                    {t('columns.open')}
                  </Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Only when a technical row is on screen — under an HR-only filter there is nothing to
          explain. */}
      {visible.some((row) => row.roundType === 'tech') ? (
        <p className={styles.note}>{t('starNote')}</p>
      ) : null}

      {hasMore ? (
        <button type="button" className={styles.loadMore} disabled={loadingMore} onClick={onLoadMore}>
          {t('loadMore')}
        </button>
      ) : null}
    </>
  );
}
