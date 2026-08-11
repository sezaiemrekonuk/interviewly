'use client';

import { useFormatter, useTranslations } from 'next-intl';
import { useParams } from 'next/navigation';

import {
  RailFoot,
  RailMark,
  SplitShell,
  WorkBody,
  WorkTop,
} from '../../../../../components/shell/split-shell';
import table from '../../../../../components/admin/table.module.css';
import { Link } from '../../../../../i18n/navigation';
import { DEFAULT_LANDING_PATH } from '../../../../../lib/auth-redirect';
import type { AdminCallRow, AdminEventRow, AdminInterviewDetail } from '../../../../../lib/query';
import { useAdminInterview } from '../../../../../lib/query';
import { useErrorMessage } from '../../../../../lib/use-error-message';
import { useRequireAuth } from '../../../../../lib/use-require-auth';

import panel from '../../admin.module.css';
import styles from './detail.module.css';

/** A uuid at full width owns its column; eight characters identify it, `title` holds the rest. */
const UUID_HEAD = 8;

/**
 * `metadata` is an unknown JSON blob. Only the scalar entries are readable as `key: value`,
 * so those are what the cell shows — stringifying a nested object into a table cell prints
 * punctuation, not information.
 */
function metaPairs(metadata: unknown): [string, string][] {
  if (typeof metadata !== 'object' || metadata === null || Array.isArray(metadata)) return [];
  return Object.entries(metadata as Record<string, unknown>).flatMap(([key, value]) =>
    value === null || ['string', 'number', 'boolean'].includes(typeof value)
      ? [[key, String(value)] as [string, string]]
      : [],
  );
}

/** One labelled fact in the summary list. */
function Fact({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className={styles.fact}>
      <dt className={styles.term}>{label}</dt>
      <dd className={styles.value}>{children}</dd>
    </div>
  );
}

export default function AdminInterviewDetailPage() {
  const params = useParams<{ id: string | string[] }>();
  const id = Array.isArray(params.id) ? (params.id[0] ?? '') : (params.id ?? '');
  const { user, loading: authLoading } = useRequireAuth();
  const t = useTranslations('admin');
  const format = useFormatter();
  const errorMessage = useErrorMessage();

  const isAdmin = !authLoading && user !== null && user.role === 'admin';
  const detail = useAdminInterview(id, isAdmin);

  if (authLoading || !user) return null;

  // In place, never a redirect: bouncing a non-admin tells them the route exists and that
  // they were bounced off it (error-routing.ts, `not-authorized`).
  if (user.role !== 'admin' || detail.error?.code === 'FORBIDDEN') {
    return (
      <main id="content" tabIndex={-1} className={panel.ground}>
        <div className={panel.forbidden} role="alert" data-testid="admin-forbidden">
          <h1 className={panel.forbiddenTitle}>{t('forbidden.title')}</h1>
          <p className={panel.forbiddenBody}>{t('forbidden.body')}</p>
          <Link className={panel.forbiddenBack} href={DEFAULT_LANDING_PATH}>
            {t('forbidden.back')}
          </Link>
        </div>
      </main>
    );
  }

  // A wire string against a compile-time message tree: `has` is exactly this case.
  const label = (key: string, raw: string) => {
    const typed = key as Parameters<typeof t.has>[0];
    return t.has(typed) ? t(typed) : raw;
  };

  const when = (iso: string) =>
    format.dateTime(new Date(iso), { dateStyle: 'short', timeStyle: 'medium' });

  const rail = (
    <>
      <RailMark href="/" />
      <p className={panel.railKicker}>{t('title')}</p>

      <Link className={panel.back} href="/admin">
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
        {t('detail.back')}
      </Link>

      <RailFoot>
        <span className={panel.operator}>{user.email}</span>
        <span className="tabular">{user.role}</span>
      </RailFoot>
    </>
  );

  function summary(interview: AdminInterviewDetail['interview']) {
    const tokens = (detail.data?.calls ?? []).reduce(
      (sum, call) => sum + (call.inputTokens ?? 0) + (call.outputTokens ?? 0),
      0,
    );
    const minutes = Math.floor(interview.elapsedSeconds / 60);
    const seconds = interview.elapsedSeconds % 60;

    return (
      <section className={table.card} aria-labelledby="admin-detail-summary-heading">
        <div className={table.head}>
          <h2 className={table.heading} id="admin-detail-summary-heading">
            {t('detail.summaryTitle')}
          </h2>
        </div>
        <dl className={styles.grid} data-testid="admin-detail-summary">
          <Fact label={t('detail.account')}>{interview.userEmail}</Fact>
          <Fact label={t('detail.occupation')}>
            {interview.occupation ?? interview.occupationLabel ?? t('interviews.noOccupation')}
            {interview.occupationCluster ? (
              <span className={table.pill}>{interview.occupationCluster}</span>
            ) : null}
          </Fact>
          <Fact label={t('detail.mode')}>
            {label(`detail.mode_${interview.mode}`, interview.mode)}
          </Fact>
          <Fact label={t('detail.language')}>{interview.language}</Fact>
          <Fact label={t('detail.state')}>
            <span className={table.pill}>{label(`state.${interview.state}`, interview.state)}</span>
            {interview.deleted ? (
              <span className={table.deletedPill}>{t('interviews.deletedPill')}</span>
            ) : null}
          </Fact>
          {interview.endedReason ? (
            <Fact label={t('detail.endedReason')}>
              {label(`endedReason.${interview.endedReason}`, interview.endedReason)}
            </Fact>
          ) : null}
          {/* The backend's six-decimal strings (K11) — printed, never re-rounded. */}
          <Fact label={t('detail.spent')}>
            <span className="tabular">{interview.spentUsd}</span>
          </Fact>
          <Fact label={t('detail.budget')}>
            <span className="tabular">{interview.budgetUsd}</span>
          </Fact>
          <Fact label={t('detail.tokens')}>
            <span className="tabular">{format.number(tokens)}</span>
          </Fact>
          <Fact label={t('detail.activeTime')}>
            <span className="tabular">{t('stats.duration', { minutes, seconds })}</span>
          </Fact>
          <Fact label={t('detail.questions')}>
            {t('detail.questionSplit', {
              hr: interview.hrQuestionCount,
              tech: interview.targetQuestionCount - interview.hrQuestionCount,
            })}
          </Fact>
          <Fact label={t('detail.created')}>
            <span className="tabular">{when(interview.createdAt)}</span>
          </Fact>
          {interview.startedAt ? (
            <Fact label={t('detail.started')}>
              <span className="tabular">{when(interview.startedAt)}</span>
            </Fact>
          ) : null}
          {interview.endedAt ? (
            <Fact label={t('detail.ended')}>
              <span className="tabular">{when(interview.endedAt)}</span>
            </Fact>
          ) : null}
          {interview.deletedAt ? (
            <Fact label={t('detail.deletedAt')}>
              <span className="tabular">{when(interview.deletedAt)}</span>
            </Fact>
          ) : null}
        </dl>
      </section>
    );
  }

  function report(interview: AdminInterviewDetail['interview']) {
    return (
      <section className={table.card} aria-labelledby="admin-detail-report-heading">
        <div className={table.head}>
          <h2 className={table.heading} id="admin-detail-report-heading">
            {t('detail.reportTitle')}
          </h2>
        </div>
        {interview.report ? (
          <p className={styles.report} data-testid="admin-detail-report">
            {/* US-28 rolls a prompt back by this uuid, so it stays selectable in full. */}
            <span className={`${styles.uuid} tabular`}>
              {t('detail.reportPrompt', {
                uuid: interview.report.promptUuid,
                version: interview.report.promptVersion,
              })}
            </span>
            <span className={table.pill}>{interview.report.status}</span>
          </p>
        ) : (
          <p className={table.empty} data-testid="admin-detail-report">
            {t('detail.noReport')}
          </p>
        )}
      </section>
    );
  }

  function calls(rows: AdminCallRow[], truncated: boolean) {
    return (
      <section className={table.card} aria-labelledby="admin-detail-calls-heading">
        <div className={table.head}>
          <h2 className={table.heading} id="admin-detail-calls-heading">
            {t('detail.callsTitle')}
          </h2>
          {truncated ? (
            <p className={table.note}>{t('detail.callsTruncated', { count: rows.length })}</p>
          ) : null}
        </div>

        {rows.length === 0 ? (
          <p className={table.empty}>{t('detail.callsEmpty')}</p>
        ) : (
          <div className={table.scroller}>
            <table className={table.table}>
              <caption className={table.caption}>{t('calls.caption')}</caption>
              <thead>
                <tr>
                  <th scope="col">{t('calls.col.when')}</th>
                  <th scope="col">{t('calls.col.provider')}</th>
                  <th scope="col">{t('calls.col.model')}</th>
                  <th scope="col">{t('calls.col.prompt')}</th>
                  <th scope="col" className={table.num}>
                    {t('calls.col.units')}
                  </th>
                  <th scope="col" className={table.num}>
                    {t('calls.col.tokens')}
                  </th>
                  <th scope="col" className={table.num}>
                    {t('calls.col.cost')}
                  </th>
                  <th scope="col" className={table.num}>
                    {t('calls.col.latency')}
                  </th>
                </tr>
              </thead>
              <tbody>
                {rows.map((call) => {
                  // Both halves or neither: one null side would print as the other's total.
                  // A voice call carries no tokens at all — it is billed per second and
                  // stays a per-second row.
                  const tokens =
                    call.inputTokens === null || call.outputTokens === null
                      ? null
                      : call.inputTokens + call.outputTokens;
                  return (
                    <tr key={call.id} data-testid="admin-detail-call">
                      <td className="tabular">{when(call.createdAt)}</td>
                      <td>{call.provider}</td>
                      <td className={table.occupation}>{call.model}</td>
                      <td className={table.flags}>
                        <span className="tabular" title={call.promptUuid}>
                          {call.promptUuid.slice(0, UUID_HEAD)}
                        </span>
                        <span className={table.pill}>
                          {t('calls.promptVersion', { version: call.promptVersion })}
                        </span>
                        {call.attemptNo > 1 && (
                          <span className={table.pill}>
                            {t('calls.attempt', { n: call.attemptNo })}
                          </span>
                        )}
                        {call.fellBackFrom && (
                          <span className={table.pill}>
                            {t('calls.fellBack', { provider: call.fellBackFrom })}
                          </span>
                        )}
                      </td>
                      <td className={`${table.num} tabular`} data-unit-kind={call.unitKind}>
                        {call.units} {label(`calls.unit.${call.unitKind}`, call.unitKind)}
                      </td>
                      <td className={`${table.num} tabular`}>
                        {tokens === null ? '—' : format.number(tokens)}
                      </td>
                      {/* Six decimals as the backend returned them (K11). */}
                      <td className={`${table.num} tabular`}>{call.costUsd}</td>
                      <td className={`${table.num} tabular`}>
                        {t('calls.latency', { ms: call.latencyMs })}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
    );
  }

  function events(rows: AdminEventRow[]) {
    return (
      <section className={table.card} aria-labelledby="admin-detail-events-heading">
        <div className={table.head}>
          <h2 className={table.heading} id="admin-detail-events-heading">
            {t('detail.eventsTitle')}
          </h2>
          <p className={table.note}>{t('detail.eventsNote')}</p>
        </div>

        {rows.length === 0 ? (
          <p className={table.empty}>{t('detail.eventsEmpty')}</p>
        ) : (
          <div className={table.scroller}>
            <table className={table.table}>
              <caption className={table.caption}>{t('audit.caption')}</caption>
              <thead>
                <tr>
                  <th scope="col">{t('audit.col.when')}</th>
                  <th scope="col">{t('audit.col.action')}</th>
                  <th scope="col">{t('audit.col.trace')}</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((event) => (
                  <tr key={event.id} data-testid="admin-detail-event">
                    <td className="tabular">{when(event.createdAt)}</td>
                    <td>
                      {/* The wire writes `security.prompt_injection_suspected`; the key
                          carries underscores throughout. */}
                      {label(`audit.action.${event.action.replaceAll('.', '_')}`, event.action)}
                      {metaPairs(event.metadata).map(([key, value]) => (
                        <span className={styles.meta} key={key}>
                          <span className={styles.metaKey}>{key}</span>
                          {value}
                        </span>
                      ))}
                    </td>
                    <td className={`${table.id} tabular`} title={event.traceId ?? undefined}>
                      {event.traceId ?? t('audit.noSubject')}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    );
  }

  function body() {
    if (detail.isPending)
      return (
        <div
          className={panel.skeleton}
          role="status"
          aria-label={t('detail.loading')}
          data-testid="admin-loading"
        >
          <div className={panel.skeletonTable}>
            <div className={panel.skeletonHead} />
            {[0, 1, 2, 3, 4].map((line) => (
              <div className={panel.skeletonRow} key={line} />
            ))}
          </div>
        </div>
      );

    if (detail.error?.code === 'INTERVIEW_NOT_FOUND')
      return (
        <p className={panel.error} role="alert" data-testid="admin-detail-notfound">
          {t('detail.notFound')}
        </p>
      );

    if (detail.error)
      return (
        <p className={panel.error} role="alert">
          {errorMessage(detail.error.code)}
        </p>
      );

    if (!detail.data) return null;

    return (
      <>
        {summary(detail.data.interview)}
        {report(detail.data.interview)}
        {calls(detail.data.calls, detail.data.callsTruncated)}
        {events(detail.data.events)}
      </>
    );
  }

  return (
    <SplitShell rail={rail} width="narrow">
      <WorkTop
        title={
          <>
            {t('detail.heading')} <span className={`${styles.titleId} tabular`}>{id}</span>
          </>
        }
      />
      <WorkBody className={panel.body}>{body()}</WorkBody>
    </SplitShell>
  );
}
