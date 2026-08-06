import type { ReactNode } from 'react';

import styles from '../../components/chrome/chrome.module.css';
import { SiteFooter } from '../../components/chrome/footer';
import { SiteHeader } from '../../components/chrome/header';

/**
 * `/privacy` and `/terms` (issue 009). A route group, so both keep their top-level URLs —
 * a policy that only resolves under a prefix is a policy nobody links to.
 *
 * Flat `--bg` ground: neither route is in the closed gradient list (`lib/entry-routes.ts`),
 * so the shell is the same one the report uses.
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
