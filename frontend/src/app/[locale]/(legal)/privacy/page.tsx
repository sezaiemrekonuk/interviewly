import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';

import { LegalPage } from '../../../../components/legal/legal-page';
import { alternatesFor } from '../../../../lib/site';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations('legal.privacy');
  return {
    // Bare title: the root layout's `title.template` adds the brand, and spelling it out here
    // too produced "… — Interviewly · Interviewly".
    title: t('title'),
    // Its own canonical, plus the hreflang pair (issue 91). The root sets none, so a route
    // without one has no canonical at all — better than inheriting the landing page's and
    // claiming to be a duplicate of it.
    alternates: alternatesFor('/privacy', locale),
  };
}

export default function PrivacyPage() {
  return <LegalPage doc="privacy" />;
}
