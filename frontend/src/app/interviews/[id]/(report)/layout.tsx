import type { ReactNode } from 'react';

/**
 * The report is a full-bleed split shell now, like the room and the console, so it takes no
 * site chrome: a dark context column that starts below a header and stops above a footer is
 * not the shell. The rail carries its own way back instead.
 *
 * The `(report)` group still earns its keep — it is what lets this page have a layout at all
 * without `[id]/room`, its sibling, inheriting one. A pass-through today is a place to hang
 * report-only metadata tomorrow. `(report)` changes no URL: this still serves
 * `/interviews/[id]`.
 */
export default function InterviewReportLayout({ children }: { children: ReactNode }) {
  return children;
}
