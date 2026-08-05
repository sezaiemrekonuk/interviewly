'use client';

import { useTranslations } from 'next-intl';
import { useEffect } from 'react';

import { Mascot } from '@/components/mascot';
import { Button, Field, Select } from '@/components/ui';
import { useMicPermission, type MicPermissionState } from '@/lib/use-mic-permission';

import styles from './mic-check.module.css';

// Above this RMS the status line says we can hear you. Below it the meter may still twitch on
// room noise, which is exactly why the truth is a sentence and not the bar (DESIGN §5).
const SPEAKING = 0.02;

export interface MicCheckProps {
  onStateChange: (state: MicPermissionState) => void;
}

export function MicCheck({ onStateChange }: MicCheckProps) {
  const t = useTranslations('preJoin');
  const { state, level, devices, deviceId, request, select } = useMicPermission();

  useEffect(() => {
    if (state === 'idle') request();
  }, [state, request]);

  useEffect(() => {
    onStateChange(state);
  }, [state, onStateChange]);

  if (state === 'unavailable') {
    return (
      <div className={styles.recovery} data-testid="mic-unavailable">
        <Mascot pose="shrug" size={96} className={styles.recoveryMascot} />
        <p className={styles.recoveryTitle}>{t('unavailable.title')}</p>
        <p className={styles.recoveryBody}>{t('unavailable.body')}</p>
      </div>
    );
  }

  if (state === 'denied') {
    return (
      <div className={styles.recovery} data-testid="mic-recovery">
        <Mascot pose="shrug" size={96} className={styles.recoveryMascot} />
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

      <div className={styles.meter} aria-hidden="true">
        <div
          className={styles.meterFill}
          data-testid="mic-level"
          style={{ width: `${Math.round(level * 100)}%` }}
        />
      </div>
      <p className={styles.status} aria-live="polite">
        {state !== 'granted' ? t('prompt') : level >= SPEAKING ? t('hearYou') : t('quiet')}
      </p>
    </div>
  );
}
