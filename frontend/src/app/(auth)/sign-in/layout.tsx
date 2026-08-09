import type { Metadata } from 'next';
import { getLocale, getTranslations } from 'next-intl/server';

/**
 * Issue 92: every route shared the root title, so `/`, `/register` and `/sign-in` were three
 * identical SERP entries. The title comes from the same key the page renders as its heading —
 * one string, not a second copy to drift — and the root `title.template` adds the brand.
 *
 * `canonical` because both routes take query parameters (`?returnPath=`, `?error=`) that name
 * the same page; without it each variant is a separate URL to a crawler.
 *
 * A layout because the page is a client component and only a server component exports metadata.
 */
export async function generateMetadata(): Promise<Metadata> {
  const locale = await getLocale();
  const t = await getTranslations({ locale, namespace: 'auth' });

  return {
    title: t('signInTitle'),
    description: t('signInSubtitle'),
    alternates: { canonical: '/sign-in' },
  };
}

export default function SignInLayout({ children }: { children: React.ReactNode }) {
  return children;
}
