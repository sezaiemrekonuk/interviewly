'use client';

/**
 * `/interviews` — the archive, in two views over the same practice.
 *
 * **Sessions** is the list the product always had. **Questions** is the one it could not offer:
 * every question this account has ever answered, in one sortable table, with the score and the
 * written reason beside it. That data existed the whole time in `report_questions` and was only
 * ever reachable one report at a time, buried under a transcript.
 *
 * Sorting it worst-first is the point. A candidate with six interviews behind them has sixty
 * answers and no way to find the eight that keep going wrong; scanning six reports for that is
 * work nobody does. One column sort replaces it.
 *
 * The view lives in the URL (`?view=`, `?round=`, `?sort=`) rather than in state, so "my worst
 * technical answers" is a link — the dashboard's "Work on this" card links straight into it.
 */

import { useTranslations } from 'next-intl';
import { useSearchParams } from 'next/navigation';
import { Suspense, useEffect, useState } from 'react';

import { SessionCard } from '../../../components/dashboard/modules';
import { REPORTED, RESUMABLE, UNFINISHED } from '../../../components/dashboard/summary';
import { QuestionTable } from '../../../components/interviews/question-table';
import { AppRail } from '../../../components/shell/app-rail';
import { SplitShell, WorkBody, WorkTop } from '../../../components/shell/split-shell';
import { Link, useRouter } from '../../../i18n/navigation';
import { useMyInterviews, useMyQuestions, type MyInterview } from '../../../lib/query';
import { useErrorMessage } from '../../../lib/use-error-message';
import { useRequireAuth } from '../../../lib/use-require-auth';

import styles from './interviews.module.css';

const cx = (...names: Array<string | false | undefined>) => names.filter(Boolean).join(' ');

const VIEWS = ['sessions', 'questions'] as const;
type View = (typeof VIEWS)[number];

function isView(value: string | null): value is View {
  return value === 'sessions' || value === 'questions';
}

const STATE_FILTERS = ['all', 'open', 'scored', 'unfinished'] as const;
const SESSION_SORTS = ['recent', 'oldest', 'best', 'worst'] as const;

type StateFilter = (typeof STATE_FILTERS)[number];
type SessionSort = (typeof SESSION_SORTS)[number];

/**
 * Named by what can still be done with the row, not by state name — and read from the
 * dashboard's own split rather than restated here, so the day a tenth `InterviewState` lands
 * it is sorted in one place instead of falling silently out of every filter on this screen.
 */
const STATE_SETS: Record<Exclude<StateFilter, 'all'>, Set<string>> = {
  open: RESUMABLE,
  scored: REPORTED,
  unfinished: UNFINISHED,
};

/** `startedAt` is when the practice happened; `createdAt` is all a never-started row has. */
const happenedAt = (run: MyInterview) => run.startedAt ?? run.createdAt;

function compareRuns(sort: SessionSort, a: MyInterview, b: MyInterview) {
  if (sort === 'best' || sort === 'worst') {
    // Unscored rows go last under *both* score sorts. A running interview is neither the best
    // nor the worst practice you have done, and sorting it to the top of either hands the
    // least informative rows the seats the sort exists to fill.
    if (a.overallScore === null || b.overallScore === null) {
      if (a.overallScore !== b.overallScore) return a.overallScore === null ? 1 : -1;
    } else if (a.overallScore !== b.overallScore) {
      return sort === 'best' ? b.overallScore - a.overallScore : a.overallScore - b.overallScore;
    }
  }
  const newestFirst = happenedAt(b).localeCompare(happenedAt(a));
  return sort === 'oldest' ? -newestFirst : newestFirst;
}

function InterviewsArchive() {
  const t = useTranslations('archive');
  const tSessions = useTranslations('archive.sessions');
  const { user, loading: authLoading } = useRequireAuth();
  const ready = !authLoading && user !== null;
  const errorMessage = useErrorMessage();
  const router = useRouter();
  const params = useSearchParams();

  const view: View = isView(params.get('view')) ? (params.get('view') as View) : 'sessions';

  const list = useMyInterviews(ready && view === 'sessions');
  const questions = useMyQuestions(ready && view === 'questions');

  /** Typing is not an address. State and sort are — the dashboard links into them. */
  const [query, setQuery] = useState('');

  const stateFilter = STATE_FILTERS.find((key) => key === params.get('state')) ?? 'all';
  const sort = SESSION_SORTS.find((key) => key === params.get('sort')) ?? 'recent';
  const needle = query.trim().toLocaleLowerCase();
  const narrowed = view === 'sessions' && (stateFilter !== 'all' || sort !== 'recent' || needle !== '');

  /**
   * Filtering and sorting run over the pages already fetched, and a narrowed list that only
   * answers for page one is a wrong answer, not a partial one: "no completed interviews" while
   * three sit unfetched, "best score" that is only the best of the newest twenty. So while any
   * of the three is on, the cursor is drained first. Off by default — an untouched archive
   * still pages on the button.
   *
   * `ponytail: drains every page while narrowed. Push state/sort onto GET /me/interviews if a
   * candidate's own history ever reaches thousands of rows.`
   */
  const { hasNextPage, isFetchingNextPage, fetchNextPage } = list;
  useEffect(() => {
    if (narrowed && hasNextPage && !isFetchingNextPage) void fetchNextPage();
  }, [narrowed, hasNextPage, isFetchingNextPage, fetchNextPage]);

  /** Narrowed and still pulling pages: the count and the "nothing matched" block would both
      be claims about a history the client has not finished reading. */
  const draining = narrowed && (hasNextPage === true || isFetchingNextPage);

  if (authLoading || !user) return null;

  const items = list.data?.pages.flatMap((page) => page.items) ?? [];
  const rows = questions.data?.pages.flatMap((page) => page.items) ?? [];

  const visible = items
    .filter(
      (run) =>
        (stateFilter === 'all' || STATE_SETS[stateFilter].has(run.state)) &&
        (needle === '' || (run.occupation ?? '').toLocaleLowerCase().includes(needle)),
    )
    .sort((a, b) => compareRuns(sort, a, b));

  /** Switching view drops the filters — a round means nothing to a list of sessions, or back. */
  function selectView(next: View) {
    setQuery('');
    router.replace(next === 'sessions' ? '/interviews' : `/interviews?view=${next}`);
  }

  function setSessionParam(key: 'state' | 'sort', value: string) {
    const next = new URLSearchParams(params.toString());
    // The default is the absence of the parameter, so a cleared filter leaves a clean URL.
    if (value === 'all' || value === 'recent') next.delete(key);
    else next.set(key, value);
    const search = next.toString();
    router.replace(search ? `/interviews?${search}` : '/interviews');
  }

  function clearFilters() {
    setQuery('');
    router.replace('/interviews');
  }

  const active = view === 'sessions' ? list : questions;

  return (
    <SplitShell rail={<AppRail user={user} />} className={styles.shell}>
      <WorkTop title={t('title')}>
        {/* Two views of one archive, so a segmented control rather than two nav entries: the
            subject does not change, only how it is cut.

            `aria-pressed` buttons in a labelled group, not `role="tab"`. These write a URL and
            navigate — the views are addressable routes, and a tab role promises `aria-controls`,
            a `tabpanel`, roving tabindex and arrow keys, none of which a `router.replace` can
            honour. It also matches the Round and Sort chips forty pixels below, which are the
            same control drawn the same way; two semantics for one visual pattern on one screen
            is the worse defect. */}
        <div className={styles.views} role="group" aria-label={t('viewLabel')}>
          {VIEWS.map((key) => (
            <button
              key={key}
              type="button"
              aria-pressed={key === view}
              className={key === view ? `${styles.view} ${styles.viewOn}` : styles.view}
              onClick={() => selectView(key)}
            >
              {t(`views.${key}`)}
            </button>
          ))}
        </div>
      </WorkTop>

      <WorkBody className={styles.body}>
        {active.isError ? (
          <p role="alert" className={styles.error}>
            {errorMessage(active.error.code)}
          </p>
        ) : null}

        {active.isPending ? (
          <div className={styles.skeleton} data-testid="archive-skeleton" aria-hidden="true">
            <span className={styles.skeletonRow} />
            <span className={styles.skeletonRow} />
            <span className={styles.skeletonRow} />
          </div>
        ) : null}

        {view === 'sessions' && !list.isPending && !list.isError ? (
          items.length === 0 ? (
            <div className={styles.empty}>
              <h2 className={styles.emptyTitle}>{t('empty.sessions.title')}</h2>
              <p className={styles.emptyBody}>{t('empty.sessions.body')}</p>
              <Link href="/interviews/new" className={styles.emptyCta}>
                {t('empty.sessions.cta')}
              </Link>
            </div>
          ) : (
            <>
              {/* Search, state and sort in one row above the list — the same chip the question
                  view sets forty pixels below, so one control is learned once. Sort is a native
                  <select>: four options is a menu, and four more chips beside four state chips
                  is a wall of pills where the eye has to find which row means what. */}
              <div className={styles.filters}>
                <label className={styles.search}>
                  <span className={styles.filterLegend}>{tSessions('searchLabel')}</span>
                  <input
                    type="search"
                    className={styles.searchInput}
                    value={query}
                    placeholder={tSessions('searchPlaceholder')}
                    onChange={(event) => setQuery(event.target.value)}
                  />
                </label>

                <fieldset className={styles.filterGroup}>
                  <legend className={styles.filterLegend}>{tSessions('stateFilter')}</legend>
                  {STATE_FILTERS.map((key) => (
                    <button
                      key={key}
                      type="button"
                      aria-pressed={key === stateFilter}
                      className={cx(styles.chip, key === stateFilter && styles.chipOn)}
                      onClick={() => setSessionParam('state', key)}
                    >
                      {tSessions(`states.${key}`)}
                    </button>
                  ))}
                </fieldset>

                <label className={styles.sortField}>
                  <span className={styles.filterLegend}>{tSessions('sortBy')}</span>
                  <select
                    className={styles.select}
                    value={sort}
                    onChange={(event) => setSessionParam('sort', event.target.value)}
                  >
                    {SESSION_SORTS.map((key) => (
                      <option key={key} value={key}>
                        {tSessions(`sorts.${key}`)}
                      </option>
                    ))}
                  </select>
                </label>

                {/* Says what is on screen against what it was drawn from, so a filter that hides
                    nine rows is a fact rather than a disappearance. */}
                <p className={styles.count} role="status">
                  {draining
                    ? tSessions('loadingAll')
                    : tSessions('count', { shown: visible.length, total: items.length })}
                </p>
              </div>

              {visible.length === 0 && !draining ? (
                <div className={styles.empty}>
                  <h2 className={styles.emptyTitle}>{tSessions('noMatch.title')}</h2>
                  <p className={styles.emptyBody}>{tSessions('noMatch.body')}</p>
                  <button type="button" className={styles.clear} onClick={clearFilters}>
                    {tSessions('noMatch.clear')}
                  </button>
                </div>
              ) : (
                <ul className={styles.sessions}>
                  {visible.map((interview) => (
                    <SessionCard key={interview.id} interview={interview} />
                  ))}
                </ul>
              )}

              {/* Only unnarrowed: under a filter the rest of the history is already being
                  fetched, and a button offering what is in flight is a second answer. */}
              {!narrowed && list.hasNextPage ? (
                <button
                  type="button"
                  className={styles.loadMore}
                  disabled={list.isFetchingNextPage}
                  onClick={() => void list.fetchNextPage()}
                >
                  {t('loadMore')}
                </button>
              ) : null}
            </>
          )
        ) : null}

        {view === 'questions' && !questions.isPending && !questions.isError ? (
          <QuestionTable
            rows={rows}
            hasMore={Boolean(questions.hasNextPage)}
            loadingMore={questions.isFetchingNextPage}
            onLoadMore={() => void questions.fetchNextPage()}
          />
        ) : null}
      </WorkBody>
    </SplitShell>
  );
}

/**
 * `useSearchParams` opts the tree into client-side rendering, and Next requires the boundary to
 * be explicit. The fallback is null rather than a skeleton: this resolves in the same tick.
 */
export default function InterviewsPage() {
  return (
    <Suspense fallback={null}>
      <InterviewsArchive />
    </Suspense>
  );
}
