'use client';

import { useFormatter, useNow, useTranslations } from 'next-intl';
import Link from 'next/link';
import { useState } from 'react';

import { useDeleteInterview, type MyInterview, type MyQuestion } from '../../lib/query';
import { SCORE_MAX, scoreBand } from '../../lib/score';
import { useErrorMessage } from '../../lib/use-error-message';
import { Meter } from '../shell/meter';

import {
  ADVICE_MINIMUM,
  REPORTED,
  RESUMABLE,
  RHYTHM_WEEKS,
  TREND_MINIMUM,
  UNFINISHED,
  WEAKNESS_CEILING,
  rhythm,
  roundAverages,
  scoredRuns,
  sparkPoints,
  standing,
  type Standing,
} from './summary';

import styles from './dashboard.module.css';

const cx = (...names: Array<string | false | undefined>) => names.filter(Boolean).join(' ');

const SPARK = { width: 240, height: 44, max: SCORE_MAX };

/**
 * Where an interview that is still open is resumed. Voice goes through the device check —
 * `PRODUCT.md` says voice mode routes through pre-join and the landing FAQ promises "there is a
 * device check before the room opens" — and `/room` is not it.
 *
 * The mode is decided here rather than by linking everything at pre-join and letting it sort
 * itself out: pre-join *redirects* a non-voice interview to the room, so that would put a
 * client-side bounce in front of every text resume. Same shape as `interviews/new`, which has
 * always branched this way after a create.
 */
const resumeHref = (interview: MyInterview) =>
  `/interviews/${interview.id}/${interview.mode === 'voice' ? 'pre-join' : 'room'}`;

/* ------------------------------------------------------------------ carry on where you left */

/**
 * The one interview still open. Full width and first, because on a screen a user opens between
 * two things, "you left this half-finished" outranks every number below it.
 */
export function CarryOn({ interview }: { interview: MyInterview }) {
  const t = useTranslations('dashboard.carryOn');
  const tState = useTranslations('dashboard.state');
  const title = interview.occupation ?? t('untitled');

  return (
    <section className={styles.carryOn} data-testid="carry-on">
      <div>
        <p className={styles.carryOnLabel}>{t('label')}</p>
        <h2 className={styles.carryOnTitle}>{title}</h2>
        <p className={styles.carryOnNote}>
          {t('at', { state: tState(interview.state) })}
        </p>
      </div>
      {/* The surface's one --primary. Resuming is the action this screen exists to offer. */}
      <Link href={resumeHref(interview)} className={styles.primaryCta}>
        {t('cta')}
      </Link>
    </section>
  );
}

/* -------------------------------------------------------------------------------- standing */

function DeltaTag({ delta }: { delta: number }) {
  const t = useTranslations('dashboard.standing');
  const direction = delta > 0 ? 'up' : delta < 0 ? 'down' : 'flat';

  return (
    <span className={cx(styles.delta, styles[`delta${direction}`])} data-direction={direction}>
      {t(`delta.${direction}`, { n: Math.abs(delta) })}
    </span>
  );
}

/**
 * Where you stand. Three facts that all work from the first scored interview — latest, best,
 * how many — and a trend line that appears only once there are enough points to be one.
 *
 * The lock is stated rather than hidden: a module that silently appears on the fourth visit is
 * a surprise, and "two more to go" is a reason to come back.
 */
export function StandingCard({ items }: { items: MyInterview[] }) {
  const t = useTranslations('dashboard.standing');
  const value: Standing = standing(items);
  const runs = scoredRuns(items);
  const scores = runs.map((run) => run.overallScore as number);

  if (value.latest === null) {
    return (
      <section className={styles.card} data-testid="standing">
        <h2 className={styles.cardTitle}>{t('title')}</h2>
        <p className={styles.cardEmpty}>{t('none')}</p>
      </section>
    );
  }

  return (
    <section className={styles.card} data-testid="standing">
      <h2 className={styles.cardTitle}>{t('title')}</h2>

      <div className={styles.figureRow}>
        <p className={styles.figureBlock}>
          <span className={cx(styles.figure, 'tabular')} data-testid="standing-latest">
            {value.latest}
          </span>
          <span className={styles.figureUnit}>{t('outOf', { max: SCORE_MAX })}</span>
        </p>
        {value.delta !== null ? <DeltaTag delta={value.delta} /> : null}
      </div>

      <dl className={styles.factRow}>
        <div className={styles.fact}>
          <dt className={styles.factLabel}>{t('best')}</dt>
          <dd className={cx(styles.factValue, 'tabular')}>{value.best}</dd>
        </div>
        <div className={styles.fact}>
          <dt className={styles.factLabel}>{t('scored')}</dt>
          <dd className={cx(styles.factValue, 'tabular')}>{value.count}</dd>
        </div>
      </dl>

      {scores.length >= TREND_MINIMUM ? (
        <figure className={styles.trend} data-testid="trend">
          <figcaption className={styles.trendCaption}>{t('trend')}</figcaption>
          {/* SVG geometry, not a style attribute — which is why a line chart is possible at
              all under `style-src 'self' 'nonce-…'`. Decorative: the figures above are the
              same data as text, and the caption names what the line is. */}
          <svg
            className={styles.spark}
            viewBox={`0 0 ${SPARK.width} ${SPARK.height}`}
            preserveAspectRatio="none"
            role="presentation"
            aria-hidden="true"
            focusable="false"
          >
            <polyline
              points={sparkPoints(scores, SPARK)}
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              vectorEffect="non-scaling-stroke"
            />
          </svg>
        </figure>
      ) : (
        <p className={styles.locked} data-testid="trend-locked">
          {t('trendLocked', { n: TREND_MINIMUM - scores.length })}
        </p>
      )}
    </section>
  );
}

/* ---------------------------------------------------------------------------- round split */

/**
 * HR against technical. The product has always scored the two rounds separately and has never
 * once told anyone which of them they are worse at — which is the single most useful thing it
 * knows about a candidate.
 */
export function RoundSplit({ items }: { items: MyInterview[] }) {
  const t = useTranslations('dashboard.rounds');
  const { hr, tech, n } = roundAverages(items);

  if (hr === null && tech === null) {
    return (
      <section className={styles.card} data-testid="round-split">
        <h2 className={styles.cardTitle}>{t('title')}</h2>
        <p className={styles.cardEmpty}>{t('none')}</p>
      </section>
    );
  }

  const gap = hr !== null && tech !== null ? Math.round(Math.abs(hr - tech) * 10) / 10 : null;
  const weaker = hr !== null && tech !== null ? (hr < tech ? 'hr' : 'tech') : null;

  return (
    <section className={styles.card} data-testid="round-split">
      <h2 className={styles.cardTitle}>{t('title')}</h2>

      <dl className={styles.bars}>
        {([['hr', hr], ['tech', tech]] as const).map(([key, value]) => (
          <div key={key} className={styles.bar}>
            <dt className={styles.barLabel}>{t(key)}</dt>
            <dd className={styles.barValue}>
              {/* --accent, not --primary: this is a measurement, and the sparkline and the
                  rhythm grid two cards away already draw the same category in --accent. */}
              <Meter
                value={value ?? 0}
                max={SCORE_MAX}
                className={styles.barMeter}
                decorative
                tall
              />
              <span className={cx(styles.barNumber, 'tabular')}>
                {value === null ? t('noScore') : value}
              </span>
            </dd>
          </div>
        ))}
      </dl>

      {/* The reading, in a sentence, and somewhere to go with it. A user should not have to
          compare two bars themselves — and should not be told to practise a round on the
          strength of one sitting either, which is why the sentence changes below
          ADVICE_MINIMUM instead of the module disappearing. */}
      {gap !== null && weaker !== null ? (
        <div className={styles.reading}>
          <p className={styles.readingText}>
            {n < ADVICE_MINIMUM
              ? t('gapOne', { hr: hr as number, tech: tech as number })
              : gap === 0
                ? t('even')
                : t('gap', { round: t(weaker), n: gap })}
          </p>
          {/* The round-filtered worst-questions view already existed and nothing linked to it,
              so the briefing named a weakness and dead-ended. Navigation, not advice — it is
              the same set of facts at n = 1, so it is not gated. */}
          {gap > 0 ? (
            <Link
              href={`/interviews?view=questions&round=${weaker}&sort=worst`}
              className={styles.cardLink}
            >
              {t('weakerLink', { round: t(weaker) })}
            </Link>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}

/* ---------------------------------------------------------------------------------- focus */

/**
 * The answers worth working on, across every interview this account has ever run — the view the
 * product could not offer while a score lived inside one report at a time.
 *
 * `questions` is `weakest()`, so it holds only answers at or below `WEAKNESS_CEILING`. Three
 * states, not two: rows, a floor that has nothing under the ceiling, and an account with no
 * scored answer yet. The middle one is the whole point of the ceiling — a candidate whose
 * lowest mark is an 80 was being shown two commendations under a remediation heading.
 *
 * Each row carries the reason it was marked down, because "you scored 40" is a grade and the
 * sentence under it is the only part anyone can act on.
 */
export function Focus({
  questions,
  hasScored,
}: {
  questions: MyQuestion[];
  /** Any scored answer at all. Decides which of the two empty states is true, and keeps the
      archive reachable from a card that has no rows to link from. */
  hasScored: boolean;
}) {
  const t = useTranslations('dashboard.focus');
  const tRound = useTranslations('dashboard.rounds');

  return (
    <section className={styles.card} data-testid="focus">
      <div className={styles.cardHead}>
        <h2 className={styles.cardTitle}>{t('title')}</h2>
        {hasScored ? (
          <Link href="/interviews?view=questions&sort=worst" className={styles.cardLink}>
            {t('seeAll')}
          </Link>
        ) : null}
      </div>

      {questions.length === 0 ? (
        hasScored ? (
          <p className={styles.focusClear} data-testid="focus-clear">
            {t('clear', { ceiling: WEAKNESS_CEILING })}
          </p>
        ) : (
          <p className={styles.cardEmpty}>{t('none')}</p>
        )
      ) : (
        <ol className={styles.focusList}>
          {questions.map((question) => (
            <li key={question.questionId} className={styles.focusItem}>
              <div className={styles.focusHead}>
                <span className={styles.roundChip}>{tRound(question.roundType)}</span>
                {/* Toned by the score, not by the section: this list is "your lowest", and
                    when your lowest is an 80 it must not be printed in the failure colour. */}
                <span
                  className={cx(styles.focusScore, 'tabular')}
                  data-band={scoreBand(question.score as number)}
                >
                  {question.score}
                  <span className={styles.figureUnit}>{t('outOf', { max: SCORE_MAX })}</span>
                </span>
              </div>
              <p className={styles.focusQuestion}>{question.text}</p>
              {question.reason ? <p className={styles.focusReason}>{question.reason}</p> : null}
              <Link href={`/interviews/${question.interviewId}`} className={styles.focusLink}>
                {t('open')}
              </Link>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}

/* --------------------------------------------------------------------------------- rhythm */

/** How often you practise, as twelve weeks. Reads as progress from the first interview. */
export function Rhythm({ items, now }: { items: MyInterview[]; now: number }) {
  const t = useTranslations('dashboard.rhythm');
  const weeks = rhythm(items, now);
  const total = weeks.reduce((sum, week) => sum + week.count, 0);
  const active = weeks.filter((week) => week.count > 0).length;

  return (
    <section className={styles.card} data-testid="rhythm">
      <h2 className={styles.cardTitle}>{t('title')}</h2>

      {/* Decorative as a graphic; the line under it carries both numbers as text. */}
      <ol className={styles.weeks} aria-hidden="true">
        {weeks.map((week) => (
          <li
            key={week.offset}
            className={cx(
              styles.week,
              week.count > 0 && styles.weekOn,
              week.count > 1 && styles.weekBusy,
            )}
          />
        ))}
      </ol>

      <p className={styles.cardNote}>
        {total === 0
          ? t('none', { weeks: RHYTHM_WEEKS })
          : t('summary', { total, active, weeks: RHYTHM_WEEKS })}
      </p>
    </section>
  );
}

/* --------------------------------------------------------------------------- session cards */

/** Still running is the one place a lit chip is earned; everything else is the quiet bed. */
const LIVE_STATES = new Set(['profiling', 'hr_round', 'tech_round', 'evaluating']);

export function SessionCard({ interview }: { interview: MyInterview }) {
  const t = useTranslations('dashboard.session');
  const tState = useTranslations('dashboard.state');
  const format = useFormatter();
  // Seeded from the request's `now` so the first paint matches the server, then ticks: a
  // long-lived surface with a frozen "2 minutes ago" ages into a lie.
  const now = useNow({ updateInterval: 60_000 });
  const errorMessage = useErrorMessage();
  const remove = useDeleteInterview();
  const [confirming, setConfirming] = useState(false);

  const title = interview.occupation ?? t('untitled');
  const at = interview.startedAt ?? interview.createdAt;

  return (
    <li className={styles.session} data-testid="session-card">
      <div className={styles.sessionMain}>
        <p className={styles.sessionTitle} title={title}>
          {title}
        </p>
        <p className={styles.sessionMeta}>
          <span
            className={styles.pill}
            data-live={LIVE_STATES.has(interview.state) || undefined}
            data-quiet={UNFINISHED.has(interview.state) || undefined}
          >
            {tState(interview.state)}
          </span>
          <span className={styles.sessionMode}>{t(`mode.${interview.mode}`)}</span>
          <time dateTime={at}>{format.relativeTime(new Date(at), now)}</time>
        </p>
      </div>

      {/* The score is the reason to reopen a session, so it is on the card rather than one
          navigation away inside the report. */}
      <p className={styles.sessionScore}>
        {interview.overallScore === null ? (
          <span className={styles.sessionNoScore}>{t('noScore')}</span>
        ) : (
          <>
            <span className={cx(styles.sessionScoreValue, 'tabular')}>
              {interview.overallScore}
            </span>
            <span className={styles.figureUnit}>{t('outOf', { max: SCORE_MAX })}</span>
          </>
        )}
      </p>

      {confirming ? (
        <div className={styles.confirm}>
          <span className={styles.confirmQuestion}>{t('deleteConfirm')}</span>
          <button
            type="button"
            className={styles.confirmAction}
            disabled={remove.isPending}
            onClick={() => remove.mutate(interview.id)}
          >
            {t('deleteConfirmAction')}
          </button>
          <button type="button" className={styles.textAction} onClick={() => setConfirming(false)}>
            {t('cancel')}
          </button>
        </div>
      ) : (
        <div className={styles.sessionActions}>
          {RESUMABLE.has(interview.state) ? (
            <Link href={resumeHref(interview)} className={styles.sessionLink}>
              {t('continue')}
            </Link>
          ) : null}
          {/* `abandoned` and `failed` used to offer Delete and nothing else, even though the
              report route renders their transcript. An ended interview is always readable. */}
          {REPORTED.has(interview.state) || UNFINISHED.has(interview.state) ? (
            <Link href={`/interviews/${interview.id}`} className={styles.sessionLink}>
              {REPORTED.has(interview.state) ? t('viewReport') : t('viewTranscript')}
            </Link>
          ) : null}
          <button
            type="button"
            className={styles.textAction}
            aria-label={t('deleteLabel', { occupation: title })}
            onClick={() => setConfirming(true)}
          >
            {t('delete')}
          </button>
        </div>
      )}

      {remove.error ? (
        <p role="alert" className={styles.sessionError}>
          {errorMessage(remove.error.code)}
        </p>
      ) : null}
    </li>
  );
}

/* --------------------------------------------------------------------------------- runway */

/**
 * Day one. Not an empty state — an empty state is a sentence apologising for a blank region.
 * This is the shortest path to the thing that makes every other module on this page exist,
 * with the two inputs that decide how good the questions will be marked done as they land.
 */
export function Runway({ hasProfile, hasCv }: { hasProfile: boolean; hasCv: boolean }) {
  const t = useTranslations('dashboard.runway');
  const steps = [
    { key: 'profile', done: hasProfile, href: '/profile' },
    { key: 'cv', done: hasCv, href: '/profile' },
    { key: 'first', done: false, href: '/interviews/new' },
  ] as const;

  return (
    <section className={styles.runway} data-testid="runway">
      <h2 className={styles.runwayTitle}>{t('title')}</h2>
      <p className={styles.runwayLede}>{t('lede')}</p>

      <ol className={styles.runwaySteps}>
        {steps.map((step, index) => (
          <li key={step.key} className={cx(styles.runwayStep, step.done && styles.runwayStepDone)}>
            <span className={cx(styles.runwayIndex, 'tabular')} aria-hidden="true">
              {index + 1}
            </span>
            <div>
              <h3 className={styles.runwayStepTitle}>{t(`steps.${step.key}.title`)}</h3>
              <p className={styles.runwayStepBody}>{t(`steps.${step.key}.body`)}</p>
            </div>
            {/* Done is a word, never a tick alone — the state has to survive being read out. */}
            {step.done ? (
              <span className={styles.runwayDone}>{t('done')}</span>
            ) : (
              <Link
                href={step.href}
                className={step.key === 'first' ? styles.primaryCta : styles.runwayLink}
              >
                {t(`steps.${step.key}.cta`)}
              </Link>
            )}
          </li>
        ))}
      </ol>
    </section>
  );
}
