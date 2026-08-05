import type { ReactNode } from 'react';

import styles from '../../../../components/chrome/chrome.module.css';
import { SiteFooter } from '../../../../components/chrome/footer';
import { SiteHeader } from '../../../../components/chrome/header';

/**
 * The report gets the chrome; the room, its sibling at `[id]/room`, must not. A route group
 * is what separates them — a layout at `[id]/` would wrap both, and App Router gives a
 * nested layout no way to opt out of its parent. `(report)` changes no URL: this still
 * serves `/interviews/[id]`.
 *
 * Flat `--bg` ground, never the entry gradient (ui §4.2, AC-4a).
 */
export default function InterviewReportLayout({ children }: { children: ReactNode }) {
  return (
    <div className={styles.flatShell}>
      <SiteHeader />
      <div className={styles.shellBody}>{children}</div>
      <SiteFooter />
    </div>
  );
}
