'use client';

import { useParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useEffect, useRef, useState } from 'react';

import { CameraView, rememberCamera } from '@/components/camera-view';
import { MicCheck } from '@/components/pre-join/mic-check';
import { RailMark, SplitShell, WorkBody, WorkTop } from '@/components/shell/split-shell';
import { Button } from '@/components/ui';
import { routeForError } from '@/lib/error-routing';
import { useInterviewState } from '@/lib/query';
import { useErrorMessage } from '@/lib/use-error-message';
import { useMicPermission } from '@/lib/use-mic-permission';
import { useRequireAuth } from '@/lib/use-require-auth';
import { voiceDowngrade } from '@/lib/voice/downgrade';

import { useRouter } from '../../../../../i18n/navigation';
import styles from './pre-join.module.css';

/** The two glyphs on the round controls. Inline, because two paths are not a dependency. */
function MicGlyph({ off }: { off: boolean }) {
  return (
    <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true" focusable="false">
      <path
        d="M12 3a3 3 0 0 1 3 3v6a3 3 0 0 1-6 0V6a3 3 0 0 1 3-3Zm7 9a7 7 0 0 1-6 6.93V21h-2v-2.07A7 7 0 0 1 5 12h2a5 5 0 0 0 10 0h2Z"
        fill="currentColor"
      />
      {off ? <path d="M4 3.5 20.5 20" stroke="currentColor" strokeWidth="2" /> : null}
    </svg>
  );
}

function CameraGlyph({ off }: { off: boolean }) {
  return (
    <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true" focusable="false">
      <path
        d="M4 6h11a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2Zm15 3.5 3-2v9l-3-2v-5Z"
        fill="currentColor"
      />
      {off ? <path d="M4 3.5 20.5 20" stroke="currentColor" strokeWidth="2" /> : null}
    </svg>
  );
}

export default function PreJoinPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const t = useTranslations('preJoin');
  const errorMessage = useErrorMessage();
  const { user, loading: authLoading } = useRequireAuth();

  const ready = !authLoading && Boolean(user);
  const stateQuery = useInterviewState(ready ? id : null);
  // The lobby owns the capture: the mute control sits on the camera preview beside the camera's
  // own, so the hook cannot live inside `MicCheck` any more.
  const mic = useMicPermission();
  // Off until asked for: the camera is optional and the prompt is the candidate's to trigger
  // (voice spec §3.2). It never gates entry either — only the microphone does.
  const [cameraOn, setCameraOn] = useState(false);
  const [downgrade, setDowngrade] = useState<'idle' | 'done' | { code: string }>('idle');
  const downgrading = useRef(false);

  const mode = stateQuery.data?.mode ?? null;
  const queryErrorCode = stateQuery.error?.code ?? null;
  const pathname = `/interviews/${id}/pre-join`;
  const room = `/interviews/${id}/room`;

  const micState = mic.state;
  const { request: requestMic } = mic;

  useEffect(() => {
    if (queryErrorCode) routeForError(queryErrorCode, router, { pathname });
  }, [queryErrorCode, router, pathname]);

  // Trap 1: `mode` decides the gate — a text interview never sees a mic prompt.
  useEffect(() => {
    if (mode && mode !== 'voice') router.replace(room);
  }, [mode, router, room]);

  // Which is why the request waits for the mode rather than firing on mount.
  useEffect(() => {
    if (mode === 'voice' && micState === 'idle') requestMic();
  }, [mode, micState, requestMic]);

  // S07: no microphone is a downgrade, never a dead end. `denied` and `unavailable` are both
  // terminal for voice — the retry inside MicCheck can still win, but the way forward must not
  // depend on it. The ref guards the second render the state change causes; the query cache is
  // deliberately left saying `voice`, or the redirect above would fire and swallow the notice.
  useEffect(() => {
    if (mode !== 'voice' || downgrading.current) return;
    if (micState !== 'denied' && micState !== 'unavailable') return;
    downgrading.current = true;
    void voiceDowngrade(id).then((result) => {
      setDowngrade(result.ok ? 'done' : { code: result.code ?? 'UNKNOWN' });
    });
  }, [micState, mode, id]);

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

    const micOff = micState !== 'granted' || mic.muted;

    return (
      <section className={styles.lobby} data-testid="pre-join">
        {/* Preview and both devices in one frame, the way a call lobby does it: the picture is
            the surface, its two controls sit on it, and the microphone's readout is under it.
            One errand, not two panels. */}
        <div className={styles.stagePane} data-testid="device-check">
          <div className={styles.preview}>
            <CameraView enabled={cameraOn} className={styles.previewMedia} />
            <p className={styles.previewName}>{t('you')}</p>
            <div className={styles.previewControls}>
              <button
                type="button"
                className={styles.round}
                data-off={micOff}
                aria-pressed={!micOff}
                aria-label={mic.muted ? t('unmute') : t('mute')}
                disabled={micState !== 'granted'}
                onClick={() => mic.toggleMute()}
                data-testid="mic-toggle"
              >
                <MicGlyph off={micOff} />
              </button>
              <button
                type="button"
                className={styles.round}
                data-off={!cameraOn}
                aria-pressed={cameraOn}
                aria-label={cameraOn ? t('camera.turnOff') : t('camera.turnOn')}
                onClick={() =>
                  setCameraOn((on) => {
                    // The room opens the way this screen was left (`cameraStartsOn`).
                    rememberCamera(!on);
                    return !on;
                  })
                }
                data-testid="camera-toggle"
              >
                <CameraGlyph off={!cameraOn} />
              </button>
            </div>
          </div>

          <MicCheck mic={mic} />
          <p className={styles.cameraNote}>{t('camera.note')}</p>
        </div>

        <div className={styles.joinPane}>
          <h2 className={styles.joinTitle}>{t('ready')}</h2>
          <Button
            className={styles.cta}
            size="lg"
            disabled={micState !== 'granted' && downgrade !== 'done'}
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
          ) : micState === 'granted' ? null : (
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
