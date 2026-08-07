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
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense } from 'react';

import { SessionCard } from '../../components/dashboard/modules';
import { QuestionTable } from '../../components/interviews/question-table';
import { AppRail } from '../../components/shell/app-rail';
import { SplitShell, WorkBody, WorkTop } from '../../components/shell/split-shell';
import { useMyInterviews, useMyQuestions } from '../../lib/query';
import { useErrorMessage } from '../../lib/use-error-message';
import { useRequireAuth } from '../../lib/use-require-auth';

import styles from './interviews.module.css';

const VIEWS = ['sessions', 'questions'] as const;
type View = (typeof VIEWS)[number];

function isView(value: string | null): value is View {
  return value === 'sessions' || value === 'questions';
}

function InterviewsArchive() {
  const t = useTranslations('archive');
  const { user, loading: authLoading } = useRequireAuth();
  const ready = !authLoading && user !== null;
  const errorMessage = useErrorMessage();
  const router = useRouter();
  const params = useSearchParams();

  const view: View = isView(params.get('view')) ? (params.get('view') as View) : 'sessions';

  const list = useMyInterviews(ready && view === 'sessions');
  const questions = useMyQuestions(ready && view === 'questions');

  if (authLoading || !user) return null;

  const items = list.data?.pages.flatMap((page) => page.items) ?? [];
  const rows = questions.data?.pages.flatMap((page) => page.items) ?? [];

  /** Switching view drops the question filters — they mean nothing to a list of sessions. */
  function selectView(next: View) {
    router.replace(next === 'sessions' ? '/interviews' : `/interviews?view=${next}`);
  }

  const active = view === 'sessions' ? list : questions;

  return (
    <SplitShell rail={<AppRail user={user} />}>
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
              <ul className={styles.sessions}>
                {items.map((interview) => (
                  <SessionCard key={interview.id} interview={interview} />
                ))}
              </ul>
              {list.hasNextPage ? (
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
