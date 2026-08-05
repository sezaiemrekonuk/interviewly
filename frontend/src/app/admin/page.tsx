'use client';

import Link from 'next/link';
import { useTranslations } from 'next-intl';

import { InterviewTable } from '../../components/admin/interview-table';
import { StatsPanel } from '../../components/admin/stats-panel';
import { DEFAULT_LANDING_PATH } from '../../lib/auth-redirect';
import { useAdminInterviews, useAdminStats } from '../../lib/query';
import { useErrorMessage } from '../../lib/use-error-message';
import { useRequireAuth } from '../../lib/use-require-auth';

import styles from './admin.module.css';

/** Header row plus five bars at the final row height, so nothing jumps when the data lands. */
function TableSkeleton({ label }: { label: string }) {
  return (
    <div className={styles.skeleton} role="status" aria-label={label} data-testid="admin-loading">
      <div className={styles.skeletonFigures}>
        <div className={styles.skeletonCard} />
        <div className={styles.skeletonCard} />
      </div>
      <div className={styles.skeletonTable}>
        <div className={styles.skeletonHead} />
        {[0, 1, 2, 3, 4].map((row) => (
          <div className={styles.skeletonRow} key={row} />
        ))}
      </div>
    </div>
  );
}

export default function AdminPage() {
  const { user, loading: authLoading } = useRequireAuth();
  const t = useTranslations('admin');
  const errorMessage = useErrorMessage();

  const isAdmin = !authLoading && user !== null && user.role === 'admin';
  const interviews = useAdminInterviews(isAdmin);
  const stats = useAdminStats(isAdmin);

  if (authLoading || !user) return null;

  const refusal =
    interviews.error?.code === 'FORBIDDEN' || stats.error?.code === 'FORBIDDEN' ? 'FORBIDDEN' : null;

  // Rendered in place, never redirected: bouncing a non-admin off `/admin` tells them the
  // route exists and that they were bounced off it (error-routing.ts, `not-authorized`).
  if (user.role !== 'admin' || refusal) {
    return (
      <main className={styles.ground}>
        <div className={styles.forbidden} role="alert" data-testid="admin-forbidden">
          <h1 className={styles.forbiddenTitle}>{t('forbidden.title')}</h1>
          <p className={styles.forbiddenBody}>{t('forbidden.body')}</p>
          {/* W08 put the history surface on `/`, so that is where "back" goes. */}
          <Link className={styles.forbiddenBack} href={DEFAULT_LANDING_PATH}>
            {t('forbidden.back')}
          </Link>
        </div>
      </main>
    );
  }

  const items = interviews.data?.pages.flatMap((page) => page.items) ?? [];
  const failure = interviews.error?.code ?? stats.error?.code ?? null;

  return (
    <main className={styles.ground}>
      <div className={styles.inner}>
        <header className={styles.header}>
          <h1 className={styles.title}>{t('title')}</h1>
          <p className={styles.subtitle}>{t('subtitle')}</p>
        </header>

        {interviews.isPending || stats.isPending ? (
          <TableSkeleton label={t('loading')} />
        ) : failure ? (
          <p className={styles.error} role="alert">
            {errorMessage(failure)}
          </p>
        ) : (
          <>
            {stats.data && <StatsPanel stats={stats.data} />}
            <InterviewTable
              items={items}
              hasNextPage={Boolean(interviews.hasNextPage)}
              isFetchingNextPage={interviews.isFetchingNextPage}
              onLoadMore={() => interviews.fetchNextPage()}
            />
          </>
        )}
      </div>
    </main>
  );
}
