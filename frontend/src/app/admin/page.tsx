'use client';

import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { useState } from 'react';

import { CostPanel } from '../../components/admin/cost-panel';
import { InterviewTable } from '../../components/admin/interview-table';
import { StatsPanel } from '../../components/admin/stats-panel';
import {
  RailFoot,
  RailMark,
  Spec,
  SplitShell,
  WorkBody,
  WorkTop,
} from '../../components/shell/split-shell';
import { DEFAULT_LANDING_PATH } from '../../lib/auth-redirect';
import { useAdminInterviews, useAdminStats } from '../../lib/query';
import { useErrorMessage } from '../../lib/use-error-message';
import { useRequireAuth } from '../../lib/use-require-auth';

import styles from './admin.module.css';

/**
 * The console's sections, in nav order. `built` means an endpoint answers it — there are
 * exactly two (`/admin/stats`, `/admin/interviews`), so five sections are drawn in the Spec
 * state with the missing data named in one sentence. A nav item that opens invented numbers
 * is worse than one that opens an honest gap.
 */
const SECTIONS = [
  { id: 'overview', built: true },
  { id: 'interviews', built: true },
  { id: 'costs', built: true },
  { id: 'modelCalls', built: false },
  { id: 'sessions', built: false },
  { id: 'users', built: false },
  { id: 'queue', built: false },
  { id: 'audit', built: false },
] as const;

type SectionId = (typeof SECTIONS)[number]['id'];

/** Two figures and the table at their final row height, so nothing jumps when data lands. */
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

/**
 * A section the design specifies and no endpoint answers yet. Same neutral marker as the
 * rail — never a warning colour, because colouring a scheduled gap as a failure is how an
 * operator learns to ignore the failures that matter.
 */
function SpecPanel({ note }: { note: string }) {
  return (
    <div className={styles.specPanel}>
      <div className={styles.specCard}>
        <Spec />
        <p className={styles.specNote}>{note}</p>
      </div>
    </div>
  );
}

export default function AdminPage() {
  const { user, loading: authLoading } = useRequireAuth();
  const t = useTranslations('admin');
  const errorMessage = useErrorMessage();
  // Sections are client state, not routes: the console reads one pair of endpoints and
  // swapping the working surface costs nothing. A route each would refetch both per click.
  const [section, setSection] = useState<SectionId>('overview');

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
  const built = SECTIONS.find((entry) => entry.id === section)?.built ?? false;

  const table = (
    <InterviewTable
      items={items}
      hasNextPage={Boolean(interviews.hasNextPage)}
      isFetchingNextPage={interviews.isFetchingNextPage}
      onLoadMore={() => interviews.fetchNextPage()}
    />
  );

  function body() {
    if (!built) return <SpecPanel note={t(`spec.${section}`)} />;
    if (interviews.isPending || stats.isPending) return <TableSkeleton label={t('loading')} />;
    if (failure)
      return (
        <p className={styles.error} role="alert">
          {errorMessage(failure)}
        </p>
      );
    if (section === 'interviews') return table;
    if (section === 'costs')
      return (
        <>
          <CostPanel items={items} clusters={stats.data?.perOccupation ?? []} />
          {table}
        </>
      );
    return (
      <>
        {stats.data && <StatsPanel stats={stats.data} />}
        {table}
      </>
    );
  }

  const rail = (
    <>
      <RailMark />
      <p className={styles.railKicker}>{t('title')}</p>

      <nav className={styles.nav} aria-label={t('nav.label')}>
        {SECTIONS.map((entry) => (
          <button
            key={entry.id}
            type="button"
            data-testid={`admin-nav-${entry.id}`}
            className={entry.id === section ? `${styles.navItem} ${styles.navOn}` : styles.navItem}
            aria-current={entry.id === section ? 'page' : undefined}
            onClick={() => setSection(entry.id)}
          >
            <span className={styles.navLabel}>{t(`nav.${entry.id}`)}</span>
            {entry.built ? null : <Spec onRail />}
          </button>
        ))}
      </nav>

      {/* Nothing in the app links here, so the console has to carry its own way out. */}
      <Link className={styles.back} href={DEFAULT_LANDING_PATH}>
        <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true" focusable="false">
          <path
            d="M9.5 3 4.5 8l5 5"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
        {t('nav.back')}
      </Link>

      <RailFoot>
        <span className={styles.operator}>{user.email}</span>
        <span className="tabular">{user.role}</span>
      </RailFoot>
    </>
  );

  return (
    <SplitShell rail={rail} width="narrow">
      <WorkTop title={t(`nav.${section}`)}>
        {built ? (
          <span className={styles.scope}>
            {t('scope.allTime')}
            <Spec />
          </span>
        ) : null}
      </WorkTop>
      <WorkBody className={styles.body}>{body()}</WorkBody>
    </SplitShell>
  );
}
