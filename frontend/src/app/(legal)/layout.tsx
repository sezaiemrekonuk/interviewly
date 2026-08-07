import type { ReactNode } from 'react';

import styles from '../../components/chrome/chrome.module.css';
import { SiteFooter } from '../../components/chrome/footer';
import { SiteHeader } from '../../components/chrome/header';

/**
 * `/privacy` and `/terms` (issue 009). A route group, so both keep their top-level URLs —
 * a policy that only resolves under a prefix is a policy nobody links to.
 *
 * Flat `--bg` ground and no rail: a policy has no "right now", so a state column would be a
 * dark stripe down the one screen whose job is an uninterrupted read (DESIGN §2 rule 4).
 */
export default function LegalLayout({ children }: { children: ReactNode }) {
  return (
    <div className={styles.flatShell}>
      <SiteHeader />
      <div className={styles.shellBody}>{children}</div>
      <SiteFooter />
    </div>
  );
}
