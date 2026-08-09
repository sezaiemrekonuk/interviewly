'use client';

import { useTranslations } from 'next-intl';
import type { ReactNode } from 'react';

import { RailMark, SplitShell } from '../shell/split-shell';

import styles from './auth.module.css';

/**
 * Which argument the rail makes. One per subject rather than one per route: the two
 * verify-email screens are the same subject seen twice, and the copy that would tell them
 * apart is already the heading on the working surface.
 *
 * Each name resolves three keys in the `auth` namespace — `rail<Name>Lede|Body|Foot`.
 */
export type AuthRailCopy = 'SignIn' | 'Register' | 'Forgot' | 'Reset' | 'Verify';

/**
 * The entry screens use the app's one shell (DESIGN §03), so auth is not a special case:
 * the rail says what this product is to someone who has never seen it, the working surface
 * holds exactly one form. The rail is 340px because its argument is prose, not state.
 */
export function AuthShell({
  rail,
  title,
  subtitle,
  children,
}: {
  rail: AuthRailCopy;
  /** Omitted while a screen does not yet know what it is about to say (the auth probe). */
  title?: ReactNode;
  subtitle?: ReactNode;
  children?: ReactNode;
}) {
  const t = useTranslations('auth');

  return (
    <SplitShell
      width="wide"
      rail={
        <>
          {/* Linked, as it was in the layout this shell replaced: an entry screen has no
              nav, so the wordmark is the only way back out of a form opened by accident.
              `RailMark` carries its own link now — this is the one call site that already
              had one, so it's simplified to use `RailMark`'s built-in `href` instead of
              double-wrapping it. */}
          <RailMark href="/" />
          <p className={styles.railLede}>{t(`rail${rail}Lede`)}</p>
          <p className={styles.railBody}>{t(`rail${rail}Body`)}</p>
          <p className={styles.railFoot}>{t(`rail${rail}Foot`)}</p>
        </>
      }
    >
      <div className={styles.center}>
        <div className={styles.column}>
          {title ? <h1 className={styles.title}>{title}</h1> : null}
          {subtitle ? <p className={styles.subtitle}>{subtitle}</p> : null}
          {children}
        </div>
      </div>
    </SplitShell>
  );
}
