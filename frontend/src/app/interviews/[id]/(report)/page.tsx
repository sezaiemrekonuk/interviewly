'use client';

import { useParams, useRouter } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';

import { ReportView } from '../../../../components/report/report-view';
import { ReportWait } from '../../../../components/report/report-wait';
import { Transcript } from '../../../../components/room/transcript';
import { routeForError } from '../../../../lib/error-routing';
import { useInterviewState, useReport } from '../../../../lib/query';
import { useErrorMessage } from '../../../../lib/use-error-message';
import { useInterviewEvents } from '../../../../lib/use-interview-events';
import { useRequireAuth } from '../../../../lib/use-require-auth';

import styles from '../../../../components/report/report.module.css';

/**
 * Screen 12 — closes the demo path (land → onboard → set up → room → **report**).
 *
 * Two reads on purpose (ADR-W07): `GET /interviews/:id` carries the report payload and
 * nothing else, while the transcript and `endedReason` come from room-state, which already
 * derives both (ADR-W06). Re-deriving the transcript in the report handler would put a second
 * copy of `state.ts`'s ordering rules in another ledger's file.
 */
export default function InterviewReportPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const errorMessage = useErrorMessage();
  const { user, loading: authLoading } = useRequireAuth();

  const ready = !authLoading && Boolean(user);
  // The ceiling has passed: stop the fallback poll. An SSE nudge still resolves the screen.
  const [timedOut, setTimedOut] = useState(false);
  const onTimeout = useCallback(() => setTimedOut(true), []);

  const reportQuery = useReport(ready ? id : null, !timedOut);
  const stateQuery = useInterviewState(ready ? id : null);
  // K11 — the nudge invalidates the `['interview',id]` prefix, so both reads refetch and
  // nothing on this screen is rendered from an event body.
  useInterviewEvents(ready ? id : null);

  const pathname = `/interviews/${id}`;
  const errorCode = reportQuery.error?.code ?? stateQuery.error?.code ?? null;

  // Navigation belongs in an effect: routing during render is what makes a redirect fire twice.
  useEffect(() => {
    if (errorCode) routeForError(errorCode, router, { pathname });
  }, [errorCode, router, pathname]);

  if (!ready || reportQuery.isPending || stateQuery.isPending) {
    return <div className={styles.skeleton} data-testid="report-skeleton" />;
  }

  if (errorCode) {
    return (
      <main className={styles.page}>
        <p role="alert" className={styles.error}>
          {errorMessage(errorCode)}
        </p>
      </main>
    );
  }

  const report = reportQuery.data?.report ?? null;
  const room = stateQuery.data;
  if (!room) return null;

  return (
    <main className={styles.page} data-testid="interview-report">
      {report ? (
        <ReportView
          interviewId={id}
          payload={report.payload}
          endedReason={room.endedReason}
          turns={room.transcript}
        />
      ) : (
        <ReportWait onTimeout={onTimeout} />
      )}

      {/* W06's read-only transcript, reused verbatim — never a second renderer. */}
      <Transcript turns={room.transcript} />
    </main>
  );
}
