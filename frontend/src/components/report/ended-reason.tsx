'use client';

import { useTranslations } from 'next-intl';

/**
 * `interviews.ended_reason` values that mean the run did not reach its last question.
 * `completed` is deliberately absent — it is the one value that needs no explaining.
 */
export const EARLY_END_REASONS = new Set([
  'cut_short',
  'budget_exhausted',
  'time_exhausted',
  'abandoned',
  'error',
]);

/**
 * Why the interview stopped, in one sentence.
 *
 * Rendered on the report screen whether or not a report was produced. An interview that stops
 * at question one and then shows either a thin report or "we couldn't generate your report"
 * tells the candidate that something went wrong and nothing about what — the reason is on the
 * interview row the screen is already reading, and stating it is the difference between a
 * result and a mystery.
 *
 * Keyed off a known set rather than passed straight to `t()`: `EndedReason` is a Postgres enum
 * and a value added to it before this file learns about it must render nothing, not throw
 * `MISSING_MESSAGE` and take the report screen down with it.
 */
export function EndedReasonLine({
  endedReason,
  className,
}: {
  endedReason: string | null;
  className?: string;
}) {
  const t = useTranslations('report');
  if (endedReason === null || !EARLY_END_REASONS.has(endedReason)) return null;

  return (
    <p className={className} data-testid="report-ended-reason">
      {t('endedReasonLine', { reason: t(`endedReason.${endedReason}`) })}
    </p>
  );
}
