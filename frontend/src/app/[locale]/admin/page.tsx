'use client';

import { useTranslations } from 'next-intl';
import { useState } from 'react';

import { AuditTable } from '../../../components/admin/audit-table';
import { CallTable } from '../../../components/admin/call-table';
import { CostPanel } from '../../../components/admin/cost-panel';
import { FilterBar, type FilterControl } from '../../../components/admin/filter-bar';
import { InterviewTable } from '../../../components/admin/interview-table';
import { QueuePanel } from '../../../components/admin/queue-panel';
import { SessionTable } from '../../../components/admin/session-table';
import { StatsPanel } from '../../../components/admin/stats-panel';
import { UserTable } from '../../../components/admin/user-table';
import { RailFoot, RailMark, SplitShell, WorkBody, WorkTop } from '../../../components/shell/split-shell';
import { Link } from '../../../i18n/navigation';
import { DEFAULT_LANDING_PATH } from '../../../lib/auth-redirect';
import {
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

/** The nine `InterviewState` values, in the order the state machine walks them. */
const INTERVIEW_STATES = [
  'created',
  'profiling',
  'hr_round',
  'tech_round',
  'paused',
  'evaluating',
  'completed',
  'abandoned',
  'failed',
];

type Filters = Record<string, string | undefined>;

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
  const active = filters[section] ?? {};

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
  const facets = calls.data?.pages[0]?.facets ?? [];
  const auditRows = audit.data?.pages.flatMap((page) => page.items) ?? [];
  const auditActions = audit.data?.pages[0]?.actions ?? [];

  const setFilter = (next: Filters) => setFilters((all) => ({ ...all, [section]: next }));

  /** Jumps to another section carrying one filter — "this account's interviews", and back. */
  const openWith = (target: SectionId, next: Filters) => {
    setFilters((all) => ({ ...all, [target]: next }));
    setSection(target);
  };

  // `option` labels come from the data, never from a hardcoded list that would drift: the
  // clusters are whatever `/admin/stats` grouped, the providers whatever calls were made.
  const controls: Partial<Record<SectionId, FilterControl[]>> = {
    interviews: [
      {
        kind: 'select',
        name: 'occupationCluster',
        label: t('filters.cluster'),
        options: (stats.data?.perOccupation ?? []).map((entry) => ({
          value: entry.cluster,
          label: entry.label,
        })),
      },
      {
        kind: 'select',
        name: 'state',
        label: t('filters.state'),
        options: INTERVIEW_STATES.map((state) => ({
          value: state,
          label: t.has(`state.${state}` as Parameters<typeof t.has>[0])
            ? t(`state.${state}` as Parameters<typeof t>[0])
            : state,
        })),
      },
      { kind: 'text', name: 'userId', label: t('filters.user') },
    ],
    modelCalls: [
      {
        kind: 'select',
        name: 'provider',
        label: t('filters.provider'),
        options: [...new Set(facets.map((facet) => facet.provider))].map((provider) => ({
          value: provider,
          label: provider,
        })),
      },
      {
        kind: 'select',
        name: 'model',
        label: t('filters.model'),
        options: [...new Set(facets.map((facet) => facet.model))].map((model) => ({
          value: model,
          label: model,
        })),
      },
      { kind: 'text', name: 'interviewId', label: t('filters.interview') },
    ],
    users: [
      {
        kind: 'select',
        name: 'role',
        label: t('filters.role'),
        options: [
          { value: 'admin', label: t('users.role.admin') },
          { value: 'user', label: t('users.role.user') },
        ],
      },
      { kind: 'text', name: 'q', label: t('filters.search') },
    ],
    sessions: [
      { kind: 'text', name: 'userId', label: t('filters.user') },
      { kind: 'toggle', name: 'active', label: t('filters.activeOnly') },
    ],
    audit: [
      {
        kind: 'select',
        name: 'action',
        label: t('filters.action'),
        options: auditActions.map((entry) => ({
          value: entry.action,
          label: t.has(
            `audit.action.${entry.action.replaceAll('.', '_')}` as Parameters<typeof t.has>[0],
          )
            ? t(`audit.action.${entry.action.replaceAll('.', '_')}` as Parameters<typeof t>[0])
            : entry.action,
        })),
      },
      { kind: 'text', name: 'actorUserId', label: t('filters.user') },
      { kind: 'text', name: 'subjectId', label: t('filters.interview') },
    ],
  };

  const table = (
    <InterviewTable
      items={items}
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
            hasNextPage={Boolean(sessions.hasNextPage)}
            isFetchingNextPage={sessions.isFetchingNextPage}
            onLoadMore={() => sessions.fetchNextPage()}
          />
        );
      case 'users':
        return (
          <UserTable
            items={users.data?.pages.flatMap((page) => page.items) ?? []}
            hasNextPage={Boolean(users.hasNextPage)}
            isFetchingNextPage={users.isFetchingNextPage}
            onLoadMore={() => users.fetchNextPage()}
            onFilterByUser={(userId) => openWith('interviews', { userId })}
          />
        );
      case 'queue':
        return queue.data ? <QueuePanel data={queue.data} /> : null;
      case 'audit':
        return (
          <AuditTable
            items={auditRows}
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
        {controls[section] ? (
          <FilterBar controls={controls[section]} value={active} onChange={setFilter} />
        ) : null}
        {body()}
      </WorkBody>
    </SplitShell>
  );
}
