'use client';

import { useTranslations } from 'next-intl';
import { useState } from 'react';

import { AuditTable } from '../../../components/admin/audit-table';
import { CallTable } from '../../../components/admin/call-table';
import { CostPanel } from '../../../components/admin/cost-panel';
import { FilterBuilder } from '../../../components/admin/filter-builder';
import { InterviewTable } from '../../../components/admin/interview-table';
import { QueuePanel } from '../../../components/admin/queue-panel';
import { SessionTable } from '../../../components/admin/session-table';
import { StatsPanel } from '../../../components/admin/stats-panel';
import { UserTable } from '../../../components/admin/user-table';
import { RailFoot, RailMark, SplitShell, WorkBody, WorkTop } from '../../../components/shell/split-shell';
import { Link } from '../../../i18n/navigation';
import { DEFAULT_LANDING_PATH } from '../../../lib/auth-redirect';
import {
  type AdminListMeta,
  useAdminAudit,
  useAdminInterviews,
  useAdminLlmCalls,
  useAdminQueue,
  useAdminSessions,
  useAdminStats,
  useAdminUsers,
} from '../../../lib/query';
import { useErrorMessage } from '../../../lib/use-error-message';
import { useRequireAuth } from '../../../lib/use-require-auth';

import styles from './admin.module.css';

/**
 * The console's sections, in nav order. Every one of them is answered by an endpoint now —
 * the five that were drawn in the Spec state (`modelCalls`, `sessions`, `users`, `queue`,
 * `audit`) were placeholders for reads that did not exist, not for features nobody wanted.
 */
const SECTIONS = [
  'overview',
  'interviews',
  'costs',
  'modelCalls',
  'sessions',
  'users',
  'queue',
  'audit',
] as const;

type SectionId = (typeof SECTIONS)[number];

type Filters = Record<string, string | undefined>;

/**
 * Which filter bag a section reads and writes.
 *
 * Overview, Interviews and Costs are three views of ONE list, so they share one bag: narrowing
 * on Overview and switching to Costs must keep the narrowing, and a bag each would have let a
 * section write a filter that the query it renders never reads.
 */
const FILTER_BAG: Record<SectionId, SectionId> = {
  overview: 'interviews',
  interviews: 'interviews',
  costs: 'interviews',
  modelCalls: 'modelCalls',
  sessions: 'sessions',
  users: 'users',
  queue: 'queue',
  audit: 'audit',
};

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

export default function AdminPage() {
  const { user, loading: authLoading } = useRequireAuth();
  const t = useTranslations('admin');
  const errorMessage = useErrorMessage();
  // Sections are client state, not routes: swapping the working surface must not remount the
  // shell or refetch what the previous section already has. A route each would.
  const [section, setSection] = useState<SectionId>('overview');
  // One filter bag per section. Shared state would carry `state=completed` from the interview
  // list into the audit trail, where it means nothing and silently empties the table.
  const [filters, setFilters] = useState<Record<string, Filters>>({});
  const bagKey = FILTER_BAG[section];
  const active = filters[bagKey] ?? {};

  const isAdmin = !authLoading && user !== null && user.role === 'admin';
  // Enabled per section: eight endpoints fired on every load would make opening the console
  // the most expensive request in the system, seven-eighths of it for a panel nobody opened.
  const wantsInterviews = section === 'overview' || section === 'interviews' || section === 'costs';
  const wantsStats = wantsInterviews;

  const interviews = useAdminInterviews(isAdmin && wantsInterviews, filters.interviews ?? {});
  const stats = useAdminStats(isAdmin && wantsStats);
  const calls = useAdminLlmCalls(isAdmin && section === 'modelCalls', filters.modelCalls ?? {});
  const sessions = useAdminSessions(isAdmin && section === 'sessions', filters.sessions ?? {});
  const users = useAdminUsers(isAdmin && section === 'users', filters.users ?? {});
  const queue = useAdminQueue(isAdmin && section === 'queue');
  const audit = useAdminAudit(isAdmin && section === 'audit', filters.audit ?? {});

  if (authLoading || !user) return null;

  const queries = [interviews, stats, calls, sessions, users, queue, audit];
  const refusal = queries.some((query) => query.error?.code === 'FORBIDDEN');

  // Rendered in place, never redirected: bouncing a non-admin off `/admin` tells them the
  // route exists and that they were bounced off it (error-routing.ts, `not-authorized`).
  if (user.role !== 'admin' || refusal) {
    return (
      <main id="content" tabIndex={-1} className={styles.ground}>
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
  const callRows = calls.data?.pages.flatMap((page) => page.items) ?? [];
  const auditRows = audit.data?.pages.flatMap((page) => page.items) ?? [];

  const setFilter = (next: Filters) => setFilters((all) => ({ ...all, [bagKey]: next }));

  // The first page of whichever list is on screen. Every list echoes the same envelope, so the
  // search box and the headers read their vocabulary from the server rather than from a copy
  // of the whitelist that would drift the first time a field is renamed.
  const meta: AdminListMeta | undefined = {
    overview: interviews.data?.pages[0],
    interviews: interviews.data?.pages[0],
    costs: interviews.data?.pages[0],
    modelCalls: calls.data?.pages[0],
    sessions: sessions.data?.pages[0],
    users: users.data?.pages[0],
    queue: undefined,
    audit: audit.data?.pages[0],
  }[section];

  /**
   * The local bag wins over the echo while a re-sort is in flight, so a clicked header flips
   * immediately instead of waiting a round trip to look like it did anything. Before the first
   * click there is nothing local, and the server's default is the truth.
   */
  const activeSort = active.sort
    ? { field: active.sort, dir: active.dir === 'asc' ? ('asc' as const) : ('desc' as const) }
    : { field: meta?.sort?.field ?? '', dir: meta?.sort?.dir ?? ('desc' as const) };

  /**
   * Same column flips the direction; a different column starts at descending — newest, biggest,
   * most expensive first is what an operator means by "sort by this".
   *
   * The cursor is not cleared by hand: the sort lives in the query key, so a new order is a new
   * cache entry that starts at page one. The backend refuses a cursor minted under a different
   * order anyway, which is the belt to this bracers.
   */
  const onSort = (field: string) =>
    setFilter({
      ...active,
      sort: field,
      dir: field === activeSort.field && activeSort.dir === 'desc' ? 'asc' : 'desc',
    });

  const onSearch = (q: string) => setFilter({ ...active, q: q || undefined });

  /**
   * "Show me this account's interviews", from a row in the accounts table.
   *
   * Written as a query term rather than a separate parameter so it lands as a visible, removable
   * chip — a jump that filtered the next screen invisibly is how an operator ends up reading a
   * narrowed list without knowing it is narrowed.
   */
  const openInterviewsFor = (userId: string) => {
    setFilters((all) => ({ ...all, interviews: { q: `user:${userId}` } }));
    setSection('interviews');
  };

  const table = (
    <InterviewTable
      items={items}
      sort={activeSort}
      onSort={onSort}
      hasNextPage={Boolean(interviews.hasNextPage)}
      isFetchingNextPage={interviews.isFetchingNextPage}
      onLoadMore={() => interviews.fetchNextPage()}
    />
  );

  function body() {
    // The section's OWN query decides the skeleton. A shared `isPending` would blank the
    // queue panel because the interview list it never asked for has not landed.
    const query = {
      overview: interviews,
      interviews,
      costs: interviews,
      modelCalls: calls,
      sessions,
      users,
      queue,
      audit,
    }[section];

    if (query.isPending) return <TableSkeleton label={t('loading')} />;
    const failure = query.error?.code ?? (wantsStats ? (stats.error?.code ?? null) : null);
    if (failure)
      return (
        <p className={styles.error} role="alert">
          {errorMessage(failure)}
        </p>
      );

    switch (section) {
      case 'interviews':
        return table;
      case 'costs':
        return (
          <>
            <CostPanel items={items} stats={stats.data} />
            {table}
          </>
        );
      case 'modelCalls':
        return (
          <CallTable
            items={callRows}
            sort={activeSort}
            onSort={onSort}
            showInterview
            hasNextPage={Boolean(calls.hasNextPage)}
            isFetchingNextPage={calls.isFetchingNextPage}
            onLoadMore={() => calls.fetchNextPage()}
          />
        );
      case 'sessions':
        return (
          <SessionTable
            items={sessions.data?.pages.flatMap((page) => page.items) ?? []}
            sort={activeSort}
            onSort={onSort}
            hasNextPage={Boolean(sessions.hasNextPage)}
            isFetchingNextPage={sessions.isFetchingNextPage}
            onLoadMore={() => sessions.fetchNextPage()}
          />
        );
      case 'users':
        return (
          <UserTable
            items={users.data?.pages.flatMap((page) => page.items) ?? []}
            sort={activeSort}
            onSort={onSort}
            hasNextPage={Boolean(users.hasNextPage)}
            isFetchingNextPage={users.isFetchingNextPage}
            onLoadMore={() => users.fetchNextPage()}
            onFilterByUser={openInterviewsFor}
          />
        );
      case 'queue':
        return queue.data ? <QueuePanel data={queue.data} /> : null;
      case 'audit':
        return (
          <AuditTable
            items={auditRows}
            sort={activeSort}
            onSort={onSort}
            hasNextPage={Boolean(audit.hasNextPage)}
            isFetchingNextPage={audit.isFetchingNextPage}
            onLoadMore={() => audit.fetchNextPage()}
          />
        );
      default:
        return (
          <>
            {stats.data && <StatsPanel stats={stats.data} />}
            {table}
          </>
        );
    }
  }

  const rail = (
    <>
      <RailMark href="/" />
      <p className={styles.railKicker}>{t('title')}</p>

      <nav className={styles.nav} aria-label={t('nav.label')}>
        {SECTIONS.map((id) => (
          <button
            key={id}
            type="button"
            data-testid={`admin-nav-${id}`}
            className={id === section ? `${styles.navItem} ${styles.navOn}` : styles.navItem}
            aria-current={id === section ? 'page' : undefined}
            onClick={() => setSection(id)}
          >
            <span className={styles.navLabel}>{t(`nav.${id}`)}</span>
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
      <WorkTop title={t(`nav.${section}`)} />
      <WorkBody className={styles.body}>
        {/* Above the data, not in the header strip: three selects and a search box need the
            work column's width, and a filter that wraps into the title row reads as chrome. */}
        {/* One control for every field this table has. The hand-written dropdowns it replaces
            covered three facets out of fifteen and had to be extended by hand for each new one;
            this is built from the envelope, so a field added on the server appears here with
            no client change at all.

            The queue is the one section without it: no list, no cursor, no order, and a filter
            over five counters would be furniture.

            Optional-chained through `query` as well as `meta` — an older api container answers
            these lists without the envelope, and crashing over a filter control would take the
            whole surface down. */}
        {meta ? (
          <FilterBuilder
            value={active.q ?? ''}
            onChange={onSearch}
            fields={meta.query?.fields ?? []}
          />
        ) : null}
        {(meta?.query?.ignored?.length ?? 0) > 0 ? (
          <p className={styles.ignored} role="status" data-testid="admin-search-ignored">
            {t('filter.ignored', { terms: (meta?.query?.ignored ?? []).join(', ') })}
          </p>
        ) : null}
        {body()}
      </WorkBody>
    </SplitShell>
  );
}
