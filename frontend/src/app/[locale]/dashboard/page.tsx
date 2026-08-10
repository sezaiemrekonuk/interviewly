'use client';

/**
 * `/dashboard` — the signed-in home, and now the only one.
 *
 * There were two. `/` swapped itself for a greeting-and-a-list once `/me` answered, and this
 * route held a second, unmaintained copy of the same screen with no chrome and a one-click
 * delete. Both read the same endpoint under the same query key. This is the surviving one, and
 * `/` is marketing again — which also stops an existing customer being shown "Create account"
 * for a frame on every visit to the front door.
 *
 * What replaced the list: a briefing. The product measures every answer, scores both rounds
 * separately, and writes a reason for each mark — and until now showed a user none of it
 * outside a single report. The modules here are chosen so the screen is worth opening after
 * *one* interview: latest against best, the HR/technical split, the weakest answers with their
 * reasons. The trend line is the only thing that waits, and it says how long it is waiting for.
 */

import { useNow, useTranslations } from 'next-intl';

import {
  CarryOn,
  Focus,
  Rhythm,
  RoundSplit,
  Runway,
  SessionCard,
  StandingCard,
} from '../../../components/dashboard/modules';
import { inFlight, weakest } from '../../../components/dashboard/summary';
import { AppRail } from '../../../components/shell/app-rail';
import { SplitShell, WorkBody, WorkTop } from '../../../components/shell/split-shell';
import { Link } from '../../../i18n/navigation';
import { useMyInterviews, useMyQuestions, useProfile } from '../../../lib/query';
import { useErrorMessage } from '../../../lib/use-error-message';
import { useRequireAuth } from '../../../lib/use-require-auth';

import styles from '../../../components/dashboard/dashboard.module.css';

/**
 * Three is what fits beside the other modules without the page becoming a second list. It is a
 * ceiling, not a quota — `weakest` returns only answers at or below `WEAKNESS_CEILING`, so a
 * candidate with a solid floor gets fewer than three, or none.
 */
const FOCUS_COUNT = 3;
/** The rest are one click away on `/interviews`; this is a briefing, not the archive. */
const RECENT_COUNT = 4;

/** The greeting wants the first word of one free-text field, or nothing. */
function firstName(fullName: string | undefined): string | null {
  const first = fullName?.trim().split(/\s+/)[0];
  return first && first.length > 0 ? first : null;
}

export default function DashboardPage() {
  const t = useTranslations('dashboard');
  const { user, loading: authLoading } = useRequireAuth();
  const ready = !authLoading && user !== null;
  const errorMessage = useErrorMessage();
  const now = useNow();

  const profile = useProfile(ready);
  const list = useMyInterviews(ready);
  const questions = useMyQuestions(ready);

  if (authLoading || !user) return null;

  const items = list.data?.pages.flatMap((page) => page.items) ?? [];
  const allQuestions = questions.data?.pages.flatMap((page) => page.items) ?? [];
  const name = firstName(profile.data?.profile?.fullName);
  const open = inFlight(items);
  const focus = weakest(allQuestions, FOCUS_COUNT);

  // Day one is the *absence of interviews*, not a pending request — a fresh account that has
  // not finished loading must not flash the runway and then replace it with a briefing.
  const firstRun = !list.isPending && !list.isError && items.length === 0;

  const rail = <AppRail user={user} />;

  return (
    <SplitShell rail={rail}>
      {/* No action beside the greeting: the rail carries "New interview" on every signed-in
          surface, and the same link twice in one viewport is the eye choosing for no reason. */}
      <WorkTop title={name ? t('greeting', { name }) : t('greetingPlain')} />

      <WorkBody className={styles.body}>
        {list.isPending ? (
          <div className={styles.skeleton} data-testid="dashboard-skeleton" aria-hidden="true">
            <span className={styles.skeletonWide} />
            <span className={styles.skeletonCard} />
            <span className={styles.skeletonCard} />
          </div>
        ) : null}
        <p className={styles.srOnly} role="status">
          {list.isPending ? t('loading') : ''}
        </p>

        {list.isError ? (
          <p role="alert" className={styles.error}>
            {errorMessage(list.error.code)}
          </p>
        ) : null}

        {firstRun ? (
          <Runway
            hasProfile={Boolean(profile.data?.profile?.fullName && profile.data.profile.jobTitle)}
            hasCv={Boolean(profile.data?.cv)}
          />
        ) : null}

        {!firstRun && !list.isPending && !list.isError ? (
          <>
            {open ? <CarryOn interview={open} /> : null}

            <div className={styles.grid}>
              <StandingCard items={items} />
              <RoundSplit items={items} />
              <Rhythm items={items} now={now.getTime()} />
            </div>

            <Focus
              questions={focus}
              hasScored={allQuestions.some((q) => q.score !== null)}
            />

            <section className={styles.recent}>
              <div className={styles.cardHead}>
                <h2 className={styles.cardTitle}>{t('recent.title')}</h2>
                <Link href="/interviews" className={styles.cardLink}>
                  {t('recent.seeAll')}
                </Link>
              </div>
              <ul className={styles.sessions}>
                {items.slice(0, RECENT_COUNT).map((interview) => (
                  <SessionCard key={interview.id} interview={interview} />
                ))}
              </ul>
            </section>
          </>
        ) : null}
      </WorkBody>
    </SplitShell>
  );
}
