import type { ReactNode } from 'react';

import styles from './layout.module.css';

/**
 * The unauthenticated shell: the `--gradient-entry` ground and a centred card, nothing
 * else. The nav bar, the dark-mode toggle and the locale switcher belong to the frontend
 * ledger's global shell and must not appear on an entry screen.
 */
export default function AuthLayout({ children }: { children: ReactNode }) {
  return <main className={styles.ground}>{children}</main>;
}
