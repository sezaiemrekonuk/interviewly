'use client';

import { useFormatter, useLocale, useTranslations } from 'next-intl';
import { useState } from 'react';

import { useMonthActivity } from '../../lib/query';
import { useErrorMessage } from '../../lib/use-error-message';

import styles from './dashboard.module.css';
import { ACTIVITY_TIERS, monthGrid, monthOf, shiftMonth } from './summary';

const WEEK = 7;

/**
 * How often you practise, one month at a time.
 *
 * It replaced twelve on/off weekly bars, which answered *did you show up* and had one extra
 * shade for "more than once" — no sense of how much, and no way to look at a month (issue 245).
 *
 * The hue is `--accent` and the steps are mixes of it into the empty ground. `--primary` is
 * the surface's one action colour (DESIGN.md §2 rule 1) and thirty cells would spend that
 * budget thirty times over, on the module least likely to be the screen's action; `--accent`
 * is the informational hue this dashboard already draws its sparkline and its round split in.
 * No new token: `color-mix` against a named ground is how the admin table already tints rows,
 * and it keeps the ramp derived from the one hue rather than three values chosen to fit.
 */
export function MonthHeatmap({ now }: { now: number }) {
  const t = useTranslations('dashboard.practice');
  const format = useFormatter();
  const locale = useLocale();
  const errorMessage = useErrorMessage();

  // `now` from the page, not `Date.now()`: the server's first paint and the client's have to
  // agree on which month is this one, and the dashboard already threads a single `now`.
  const thisMonth = monthOf(now);
  const [month, setMonth] = useState(thisMonth);
  const { data, isPending, error } = useMonthActivity(month);

  const days = data?.days ?? [];
  const max = data?.max ?? 0;
  const cells = monthGrid(month, days, max);
  const total = days.reduce((sum, day) => sum + day.count, 0);

  // Only ever the first load: `placeholderData` holds the previous month through a step. The
  // distinction matters because an unanswered query and an empty month produce the same zeros,
  // and printing "0 interviews across 0 days" over them states a fact nobody has established.
  const loading = isPending && !data;

  // The floor is the account's first practice, so the picker cannot walk back through years of
  // empty grids; the ceiling is this month, because tomorrow has nothing to show.
  const earliest = data?.earliest ?? thisMonth;
  const atStart = month <= earliest;
  const atEnd = month >= thisMonth;

  const monthName = format.dateTime(new Date(`${month}-01T00:00:00.000Z`), {
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  });

  // Narrow weekday initials, Monday first. Read from `Intl` rather than six message keys: they
  // are the locale's own calendar, and next-intl already carries the locale that decides them.
  const weekdays = Array.from({ length: WEEK }, (_, index) =>
    new Intl.DateTimeFormat(locale, { weekday: 'narrow', timeZone: 'UTC' }).format(
      // 2024-01-01 was a Monday, so this walks Monday → Sunday for any locale.
      new Date(Date.UTC(2024, 0, 1 + index)),
    ),
  );

  return (
    <section className={styles.card} data-testid="practice">
      <div className={styles.practiceHead}>
        <h2 className={styles.cardTitle}>{t('title')}</h2>

        {/* Two arrows and the month, in the app's own control language — a native month input
            renders a different widget in every browser, and a calendar popover is more surface
            than stepping through months needs. */}
        <div className={styles.monthPicker}>
          <button
            type="button"
            className={styles.monthStep}
            onClick={() => setMonth(shiftMonth(month, -1))}
            disabled={atStart}
            aria-label={t('previousMonth')}
          >
            <Chevron direction="left" />
          </button>
          <span className={styles.monthName} data-testid="practice-month">
            {monthName}
          </span>
          <button
            type="button"
            className={styles.monthStep}
            onClick={() => setMonth(shiftMonth(month, 1))}
            disabled={atEnd}
            aria-label={t('nextMonth')}
          >
            <Chevron direction="right" />
          </button>
        </div>
      </div>

      {error ? (
        <p className={styles.cardNote} role="alert">
          {errorMessage(error.code)}
        </p>
      ) : null}

      {/* The ground is drawn while the month is still arriving, so the card holds its height
          instead of growing under whatever is below it once the answer lands (issue 237).
          Decorative as a graphic — the sentence under it carries every number, so a screen
          reader gets one claim instead of thirty cell labels (DESIGN.md §6). */}
      {!error && (loading || total > 0) ? (
        <div className={styles.monthGrid} aria-hidden="true" data-loading={loading || undefined}>
          {weekdays.map((initial, index) => (
            <span key={index} className={styles.weekday}>
              {initial}
            </span>
          ))}
          {cells.map((cell, index) => (
            <i
              key={cell.date ?? `blank-${index}`}
              className={cell.date ? styles.day : styles.dayBlank}
              data-tier={cell.date ? cell.tier : undefined}
              data-testid={cell.date ? `day-${cell.date}` : undefined}
            />
          ))}
        </div>
      ) : null}

      {!error && !loading ? (
        total === 0 ? (
          // Thirty grey squares and no explanation reads as a grid that failed to load.
          <p className={styles.cardNote} data-testid="practice-empty">
            {t('emptyMonth', { month: monthName })}
          </p>
        ) : (
          <p className={styles.cardNote} data-testid="practice-summary">
            {t('summary', { total, days: days.length, month: monthName })}
          </p>
        )
      ) : null}

      {/* The legend names the steps rather than only showing them: four shades of one hue is
          colour-alone information, and this is its second channel. */}
      <p className={styles.legend}>
        <span>{t('legendLess')}</span>
        <span className={styles.legendSteps} aria-hidden="true">
          {Array.from({ length: ACTIVITY_TIERS + 1 }, (_, tier) => (
            <i key={tier} className={styles.day} data-tier={tier} />
          ))}
        </span>
        <span>{t('legendMore')}</span>
      </p>
    </section>
  );
}

/** The rail's own back-chevron shape, at the size the two step buttons need. */
function Chevron({ direction }: { direction: 'left' | 'right' }) {
  return (
    <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true" focusable="false">
      <path
        d={direction === 'left' ? 'M9.5 3 4.5 8l5 5' : 'M6.5 3l5 5-5 5'}
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
