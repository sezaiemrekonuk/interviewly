import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';

import { LegalPage } from '../../../components/legal/legal-page';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('legal.terms');
  return {
    // Bare title: the root layout's `title.template` adds the brand, and spelling it out here
    // too produced "… — Interviewly · Interviewly".
    title: t('title'),
    // Its own canonical. The root sets none, so a route without one has no canonical at all —
    // better than inheriting the landing page's and claiming to be a duplicate of it.
    alternates: { canonical: '/terms' },
  };
}

export default function TermsPage() {
  return <LegalPage doc="terms" />;
}
