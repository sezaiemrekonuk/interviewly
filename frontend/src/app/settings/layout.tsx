import type { Metadata } from 'next';

/**
 * Issue 93. `robots.ts` *asks* crawlers to stay out of the signed-in surfaces; this is the
 * half they cannot ignore, emitted as `X-Robots-Tag` and a meta tag on the page itself.
 *
 * A layout rather than the page: `settings/page.tsx` is a client component, and only a server
 * component can export metadata.
 */
export const metadata: Metadata = {
  robots: { index: false, follow: false, nocache: true },
};

export default function SettingsLayout({ children }: { children: React.ReactNode }) {
  return children;
}
