import Link from 'next/link';
import type { ReactNode } from 'react';

import styles from './layout.module.css';

/**
 * The unauthenticated shell: the `--gradient-entry` ground and a centred card. The nav bar,
 * the dark-mode toggle and the locale switcher belong to the global shell and must not
 * appear on an entry screen — but the wordmark does, as the one way back out of a form
 * someone opened by accident.
 */
export default function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <main className={styles.ground}>
      <div className={styles.stack}>
        <Link href="/" className={styles.wordmark}>
          Interviewly
        </Link>
        {children}
      </div>
    </main>
  );
}
