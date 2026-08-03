import type { ReactNode } from 'react';

import styles from './layout.module.css';

/** Same entry ground as the `(auth)` route group — onboarding is still pre-app-shell. */
export default function OnboardingLayout({ children }: { children: ReactNode }) {
  return <main className={styles.ground}>{children}</main>;
}
