'use client';

import { useParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useCallback, useEffect, useRef, useState } from 'react';

import { CameraView, rememberCamera } from '@/components/camera-view';
import { MicCheck } from '@/components/pre-join/mic-check';
import { RailMark, SplitShell, WorkBody, WorkTop } from '@/components/shell/split-shell';
import { Button } from '@/components/ui';
import { routeForError } from '@/lib/error-routing';
import { useInterviewState } from '@/lib/query';
import { useErrorMessage } from '@/lib/use-error-message';
import type { MicPermissionState } from '@/lib/use-mic-permission';
import { useRequireAuth } from '@/lib/use-require-auth';
import { voiceDowngrade } from '@/lib/voice/downgrade';

import { useRouter } from '../../../../../i18n/navigation';
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
  // Off until asked for: the camera is optional and the prompt is the candidate's to trigger
  // (voice spec §3.2). It never gates entry either — only the microphone does.
  const [cameraOn, setCameraOn] = useState(false);
  const [downgrade, setDowngrade] = useState<'idle' | 'done' | { code: string }>('idle');
  const downgrading = useRef(false);

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

  // S07: no microphone is a downgrade, never a dead end. `denied` and `unavailable` are both
  // terminal for voice — the retry inside MicCheck can still win, but the way forward must not
  // depend on it. The ref guards the second render `setMic` causes; the query cache is
  // deliberately left saying `voice`, or the redirect above would fire and swallow the notice.
  useEffect(() => {
    if (mode !== 'voice' || downgrading.current) return;
    if (mic !== 'denied' && mic !== 'unavailable') return;
    downgrading.current = true;
    void voiceDowngrade(id).then((result) => {
      setDowngrade(result.ok ? 'done' : { code: result.code ?? 'UNKNOWN' });
    });
  }, [mic, mode, id]);

  // The rail says what this step is for and nothing else. It carries no fact about the
  // interview: while the state is still loading there is none to carry that is true yet.
  const rail = (
    <>
      <RailMark href="/" />
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
        {/* One device check, the way a call lobby does it: the picture on top, its control
            under it, then the microphone. Two panels made them two errands — and only one of
            them is a gate, which the copy has to carry rather than the layout. */}
        <div className={`${styles.panel} ${styles.deviceCheck}`} data-testid="device-check">
          <CameraView enabled={cameraOn} />
          <Button
            variant="secondary"
            aria-pressed={cameraOn}
            onClick={() =>
              setCameraOn((on) => {
                // The room opens the way this screen was left (`cameraStartsOn`).
                rememberCamera(!on);
                return !on;
              })
            }
          >
            {cameraOn ? t('camera.turnOff') : t('camera.turnOn')}
          </Button>

          <hr className={styles.divide} />

          <MicCheck onStateChange={onStateChange} />
          <p className={styles.cameraNote}>{t('camera.note')}</p>
        </div>

        <div>
          <Button
            className={styles.cta}
            size="lg"
            disabled={mic !== 'granted' && downgrade !== 'done'}
            onClick={() => router.push(room)}
          >
            {t('enter')}
          </Button>
          {downgrade === 'done' ? (
            <p className={styles.ctaHint}>{errorMessage('VOICE_UNAVAILABLE')}</p>
          ) : typeof downgrade === 'object' ? (
            <p role="alert" className={styles.ctaHint}>
              {errorMessage(downgrade.code)}
            </p>
          ) : mic === 'granted' ? null : (
            <p className={styles.ctaHint}>{t('enterHint')}</p>
          )}
        </div>
      </section>
    );
  }

  return (
    <SplitShell rail={rail} width="wide" className={styles.shell}>
      <WorkTop title={t('title')} />
      <WorkBody className={styles.body}>{body()}</WorkBody>
    </SplitShell>
  );
}
