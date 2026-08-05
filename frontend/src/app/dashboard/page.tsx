'use client';

import { useTranslations } from 'next-intl';

import { EmptyDashboard } from '../../components/dashboard/empty-state';
import { InterviewRow } from '../../components/dashboard/interview-row';
import { useInterviewList } from '../../lib/query';
import { useErrorMessage } from '../../lib/use-error-message';
import { useRequireAuth } from '../../lib/use-require-auth';

import styles from './dashboard.module.css';

export default function DashboardPage() {
  const { user, loading: authLoading } = useRequireAuth();
  const t = useTranslations('dashboard');
  const list = useInterviewList(!authLoading && user !== null);
  const errorMessage = useErrorMessage();

  if (authLoading || !user) return null;

  const items = list.data?.pages.flatMap((page) => page.items) ?? [];

  return (
    <main className={styles.ground}>
      <div className={styles.inner}>
        {list.isPending ? (
          <p data-testid="dashboard-loading">{t('loading')}</p>
        ) : list.isError ? (
          <p role="alert">{errorMessage(list.error?.code ?? 'UNKNOWN')}</p>
        ) : items.length === 0 ? (
          <EmptyDashboard />
        ) : (
          <>
            <h1 className={styles.title}>{t('title')}</h1>
            <ul className={styles.list}>
              {items.map((item) => (
                <InterviewRow key={item.id} item={item} />
              ))}
            </ul>
            {list.hasNextPage && (
              <button
                className={styles.loadMore}
                type="button"
                disabled={list.isFetchingNextPage}
                onClick={() => list.fetchNextPage()}
              >
                {t('loadMore')}
              </button>
            )}
          </>
        )}
      </div>
    </main>
  );
}
