'use client';

import { useTranslations } from 'next-intl';
import { useEffect } from 'react';

import { Meter } from '@/components/shell/meter';
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

  const hearing = state === 'granted' && level >= SPEAKING;

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
        {state !== 'granted' ? t('prompt') : hearing ? t('hearYou') : t('quiet')}
      </p>
    </div>
  );
}
