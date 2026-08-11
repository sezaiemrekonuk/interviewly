'use client';

import { useTranslations } from 'next-intl';

import { Meter } from '@/components/shell/meter';
import { Button, Field, Select } from '@/components/ui';
import type { UseMicPermission } from '@/lib/use-mic-permission';

import styles from './mic-check.module.css';

// Above this RMS the status line says we can hear you. Below it the meter may still twitch on
// room noise, which is exactly why the truth is a sentence and not the bar (DESIGN §5).
const SPEAKING = 0.02;

export interface MicCheckProps {
  /**
   * The live capture, owned by the lobby: the mute button sits on the camera preview beside the
   * camera's, so the page holds the hook and this component reads it. It used to own the hook
   * and report upwards through an effect, which meant the one control that had to sit outside
   * it could not exist.
   */
  mic: UseMicPermission;
}

export function MicCheck({ mic }: MicCheckProps) {
  const t = useTranslations('preJoin');
  const { state, level, devices, deviceId, request, select } = mic;

  if (state === 'unavailable') {
    return (
      <div className={styles.recovery} data-testid="mic-unavailable">
        <p className={styles.recoveryTitle}>{t('unavailable.title')}</p>
        <p className={styles.recoveryBody}>{t('unavailable.body')}</p>
      </div>
    );
  }

  if (state === 'denied') {
    return (
      <div className={styles.recovery} data-testid="mic-recovery">
        <p className={styles.recoveryTitle}>{t('denied.title')}</p>
        <ol className={styles.steps}>
          <li>{t('denied.step1')}</li>
          <li>{t('denied.step2')}</li>
          <li>{t('denied.step3')}</li>
        </ol>
        <Button variant="secondary" onClick={() => request(deviceId ?? undefined)}>
          {t('denied.retry')}
        </Button>
      </div>
    );
  }

  const hearing = state === 'granted' && !mic.muted && level >= SPEAKING;

  return (
    <div className={styles.check} data-testid="mic-check">
      {devices.length > 1 ? (
        <Field label={t('deviceLabel')}>
          {(control) => (
            <Select
              {...control}
              value={deviceId ?? ''}
              onChange={(e) => select(e.target.value)}
            >
              {devices.map((device, i) => (
                <option key={device.deviceId} value={device.deviceId}>
                  {device.label || t('deviceFallback', { n: i + 1 })}
                </option>
              ))}
            </Select>
          )}
        </Field>
      ) : null}

      {/* `Meter`, not a width in a style prop: the CSP is `style-src 'self' 'nonce-…'`, so the
          attribute was dropped in production and this bar rendered at zero width for every real
          user. Decorative because the sentence under it states the same thing in words.
          Not `tone="live"`: `--live` is the in-session signal and DESIGN §2 rule 3 names
          pre-join among the surfaces it may never appear on. This room has not started. */}
      <div data-testid="mic-level">
        <Meter value={level} max={1} tone="default" instant decorative tall />
      </div>

      <p className={styles.status} aria-live="polite" data-hearing={hearing ? 'yes' : 'no'}>
        <span className={styles.dot} aria-hidden="true" />
        {state !== 'granted'
          ? t('prompt')
          : mic.muted
            ? t('muted')
            : hearing
              ? t('hearYou')
              : t('quiet')}
      </p>
    </div>
  );
}
