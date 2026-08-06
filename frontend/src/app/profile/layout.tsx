import type { ReactNode } from 'react';

import styles from '../../components/chrome/chrome.module.css';
import { SiteFooter } from '../../components/chrome/footer';
import { SiteHeader } from '../../components/chrome/header';

/**
 * `/profile` (issue 75). Flat `--bg` ground: the route is not in the closed gradient list
 * (`lib/entry-routes.ts`), so the shell is the same one the report and the legal pages use.
 */
export default function ProfileLayout({ children }: { children: ReactNode }) {
  return (
    <div className={styles.flatShell}>
      <SiteHeader />
      <div className={styles.shellBody}>{children}</div>
      <SiteFooter />
    </div>
  );
}
