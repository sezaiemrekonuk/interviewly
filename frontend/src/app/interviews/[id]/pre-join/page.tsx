'use client';

import { useParams, useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useCallback, useEffect, useState } from 'react';

import { MicCheck } from '@/components/pre-join/mic-check';
import { RailMark, SplitShell, WorkBody, WorkTop } from '@/components/shell/split-shell';
import { Button } from '@/components/ui';
import { routeForError } from '@/lib/error-routing';
import { useInterviewState } from '@/lib/query';
import { useErrorMessage } from '@/lib/use-error-message';
import type { MicPermissionState } from '@/lib/use-mic-permission';
import { useRequireAuth } from '@/lib/use-require-auth';

import styles from './pre-join.module.css';

export default function PreJoinPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const t = useTranslations('preJoin');
  const errorMessage = useErrorMessage();
  const { user, loading: authLoading } = useRequireAuth();

  const ready = !authLoading && Boolean(user);
  const stateQuery = useInterviewState(ready ? id : null);
  const [mic, setMic] = useState<MicPermissionState>('idle');

  const mode = stateQuery.data?.mode ?? null;
  const queryErrorCode = stateQuery.error?.code ?? null;
  const pathname = `/interviews/${id}/pre-join`;
  const room = `/interviews/${id}/room`;

  // Stable identity: MicCheck reports on every transition through an effect, and a fresh
  // setter each render would re-run it.
  const onStateChange = useCallback((next: MicPermissionState) => setMic(next), []);

  useEffect(() => {
    if (queryErrorCode) routeForError(queryErrorCode, router, { pathname });
  }, [queryErrorCode, router, pathname]);

  // Trap 1: `mode` decides the gate — a text interview never sees a mic prompt.
  useEffect(() => {
    if (mode && mode !== 'voice') router.replace(room);
  }, [mode, router, room]);

  // The rail says what this step is for and nothing else. It carries no fact about the
  // interview: while the state is still loading there is none to carry that is true yet.
  const rail = (
    <>
      <RailMark />
      <p className={styles.railLead}>{t('subtitle')}</p>
    </>
  );

  function body() {
    if (!ready || stateQuery.isPending) {
      return (
        <div className={styles.pane} data-testid="pre-join-skeleton" aria-busy="true">
          <div className={styles.panel}>
            <div className={`${styles.bar} ${styles.barBody}`} />
            <div className={`${styles.bar} ${styles.barTitle}`} />
          </div>
          <div className={`${styles.bar} ${styles.barCta}`} />
        </div>
      );
    }

    if (queryErrorCode) {
      return (
        <p role="alert" className={styles.error}>
          {errorMessage(queryErrorCode)}
        </p>
      );
    }

    // Redirecting, or the state has not resolved a mode yet — never mount the mic in either.
    if (mode !== 'voice') return null;

    return (
      <section className={styles.pane} data-testid="pre-join">
        <div className={styles.panel}>
          <MicCheck onStateChange={onStateChange} />
        </div>

        {/* Unavailable removes the CTA rather than disabling it: there is nothing to grant. */}
        {mic === 'unavailable' ? null : (
          <div>
            <Button
              className={styles.cta}
              size="lg"
              disabled={mic !== 'granted'}
              onClick={() => router.push(room)}
            >
              {t('enter')}
            </Button>
            {mic === 'granted' ? null : <p className={styles.ctaHint}>{t('enterHint')}</p>}
          </div>
        )}
      </section>
    );
  }

  return (
    <SplitShell rail={rail} width="wide">
      <WorkTop title={t('title')} />
      <WorkBody className={styles.body}>{body()}</WorkBody>
    </SplitShell>
  );
}
