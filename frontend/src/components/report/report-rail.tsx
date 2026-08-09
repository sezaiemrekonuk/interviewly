'use client';

import Link from 'next/link';
import { useTranslations } from 'next-intl';

import { DEFAULT_LANDING_PATH } from '../../lib/auth-redirect';
import { useReportDownload } from '../../lib/query';
import { Meter } from '../shell/meter';
import { RailBlock, RailFoot, RailMark } from '../shell/split-shell';
import { Button } from '../ui';

import styles from './report.module.css';

/**
 * The report's context column: the headline result and the one action the screen has.
 *
 * The score lives here rather than on the working surface so the reading column starts at
 * the impression — the number is the state of this interview, which is what the rail is for.
 *
 * ponytail: no occupation and no date, which the design asks for. Neither read this screen
 * makes carries them — `GET /interviews/:id` returns `{interviewId, state, report}` and
 * `/state` returns no timestamp at all — and the `Spec` marker is an operator convention
 * that has no business on a candidate's result. Both columns are already on the interview
 * row (`my-interviews.ts` ships them on the list endpoint); add `occupation` and `createdAt`
 * to either response and a `RailBlock` each lands them here.
 */
export function ReportRail({
  interviewId,
  mode,
  score,
}: {
  interviewId: string;
  mode: 'text' | 'voice';
  /** `null` while the report is still being generated — no figure, and nothing to download. */
  score: number | null;
}) {
  const t = useTranslations('report');
  const tSetup = useTranslations('setup');
  const tNav = useTranslations('nav');
  const download = useReportDownload(interviewId);
  // `INTERVIEW_NOT_FOUND` from this endpoint means "no pdf_key yet" as often as "not yours"
  // (ADR-I11) — shown in place, never routed to /not-found via routeForError.
  const notReady = download.isError && download.error.code === 'INTERVIEW_NOT_FOUND';
  const downloadFailed = download.isError && !notReady;

  return (
    <>
      <RailMark href="/" />

      {score === null ? null : (
        <>
          <RailBlock label={t('scoreLabel')}>
            <p className={styles.railFigure} data-testid="report-score">
              <span className={styles.railScore}>{score}</span>
              <span className={styles.railScoreMax}>{t('scoreMax')}</span>
            </p>
            {/* Decorative: the figure above is the accessible truth, and a second
                announcement of the same number is noise. */}
            <Meter className={styles.railMeter} value={score} max={5} onRail decorative />
          </RailBlock>

          <div className={styles.download}>
            <Button
              className={styles.downloadButton}
              variant="secondary"
              loading={download.isPending}
              onClick={() =>
                download.mutate(undefined, {
                  onSuccess: (data) => {
                    window.location.href = data.url;
                  },
                })
              }
              data-testid="report-download"
            >
              {t('download')}
            </Button>
            {notReady ? (
              <p role="status" className={styles.downloadNote} data-testid="report-download-not-ready">
                {t('downloadNotReady')}
              </p>
            ) : null}
            {downloadFailed ? (
              <p role="alert" className={styles.downloadNote} data-testid="report-download-error">
                {t('downloadError')}
              </p>
            ) : null}
          </div>
        </>
      )}

      {/* W08 put the history surface on `/`, so that is where "back" goes. */}
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
        {tNav('today')}
      </Link>

      <RailFoot>
        <span className="tabular">
          {mode === 'voice' ? tSetup('modeVoice') : tSetup('modeText')}
        </span>
      </RailFoot>
    </>
  );
}
