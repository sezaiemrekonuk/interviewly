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
import { useEffect } from 'react';

import { MonthHeatmap } from '../../../components/dashboard/month-heatmap';
import {
  CarryOn,
  Focus,
  RoundSplit,
  Runway,
  SessionCard,
  StandingCard,
} from '../../../components/dashboard/modules';
import { inFlight, weakest } from '../../../components/dashboard/summary';
import { AppRail } from '../../../components/shell/app-rail';
import { SplitShell, WorkBody, WorkTop } from '../../../components/shell/split-shell';
import { Link, useRouter } from '../../../i18n/navigation';
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
  const router = useRouter();
  const { user, loading: authLoading } = useRequireAuth();
  const unonboarded = user !== null && !user.onboardingCompletedAt;
  const ready = !authLoading && user !== null && !unonboarded;
  const errorMessage = useErrorMessage();
  const now = useNow();

  // K8.7 at the signed-in home, which is the one arrival `firstRunPath` cannot cover: the
  // Google callback is a server 302 straight into the app, so it passes no sign-in call site.
  // `/` used to carry this bounce and is public now, redirecting nobody (ADR-ADD06), which left
  // a Google user reading marketing copy. Only the onboarding half of the rule belongs here —
  // `firstRunPath` would send a fully-onboarded account with no interviews to `/interviews/new`
  // and make this page unreachable for them (issue 80).
  useEffect(() => {
    if (unonboarded) router.replace('/onboarding/1');
  }, [unonboarded, router]);

  const profile = useProfile(ready);
  const list = useMyInterviews(ready);
  const questions = useMyQuestions(ready);

  if (authLoading || !user || unonboarded) return null;

  const items = list.data?.pages.flatMap((page) => page.items) ?? [];
  const allQuestions = questions.data?.pages.flatMap((page) => page.items) ?? [];
  const name = firstName(profile.data?.profile?.fullName);
  const open = inFlight(items);
  const focus = weakest(allQuestions, FOCUS_COUNT);

  // Day one is the *absence of interviews*, not a pending request — a fresh account that has
  // not finished loading must not flash the runway and then replace it with a briefing.
  const firstRun = !list.isPending && !list.isError && items.length === 0;

  const rail = <AppRail user={user} />;

  // The surface's one `--primary`, when nothing else has claimed it. `CarryOn` outranks this —
  // somebody with a half-finished interview should finish it, not start a second — and the
  // runway owns day one. What is left is the returning visitor with nothing in flight, whose
  // dashboard had no action on it at all: the only way to the product's one job was the third
  // link in the rail, at navigation weight.
  //
  // Yes, that link is also in the rail, and this screen is not the first to show it twice: the
  // runway's third step and the archive's empty state both draw a `--primary` to the same
  // place, for the same reason. A rail link says where you may go; it does not say what to do.
  const canStart = !list.isPending && !list.isError && items.length > 0 && !open;

  return (
    <SplitShell rail={rail} className={styles.shell}>
      <WorkTop title={name ? t('greeting', { name }) : t('greetingPlain')}>
        {canStart ? (
          <Link href="/interviews/new" className={styles.primaryCta} data-testid="start-new">
            {t('startNew')}
          </Link>
        ) : null}
      </WorkTop>

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
              <MonthHeatmap now={now.getTime()} />
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
