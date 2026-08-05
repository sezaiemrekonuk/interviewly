import type { ReactNode } from 'react';

import styles from '../../../components/chrome/chrome.module.css';
import { SiteFooter } from '../../../components/chrome/footer';
import { SiteHeader } from '../../../components/chrome/header';

/**
 * Setup is an entry surface (ui §4.2, closed gradient route list), so the shell paints the
 * same `--gradient-entry` the page does, with the same `background-attachment: fixed` —
 * both boxes sample the viewport, so the chrome and the page share one continuous ground.
 *
 * Scoped to `new/` rather than `interviews/`: a layout one level up would also wrap
 * `[id]/room`, and the room is full-bleed by contract.
 */
export default function InterviewSetupLayout({ children }: { children: ReactNode }) {
  return (
    <div className={styles.entryShell}>
      <SiteHeader />
      <div className={styles.shellBody}>{children}</div>
      <SiteFooter />
    </div>
  );
}
