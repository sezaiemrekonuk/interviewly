import { notFound } from "next/navigation";
import { hasLocale, NextIntlClientProvider } from "next-intl";
import { getMessages, getTranslations, setRequestLocale } from "next-intl/server";

import { SkipLink } from "../../components/chrome/skip-link";
import { routing } from "../../i18n/routing";
import { SITE_NAME } from "../../lib/site";

import { Providers } from "./providers";

import type { Metadata } from "next";

type LocaleParams = { params: Promise<{ locale: string }> };

/**
 * The whole metadata surface used to be two hardcoded English lines, applied identically to
 * every route in both languages — so sharing any link rendered a bare grey box, and the
 * Turkish site described itself in English (issue 92).
 *
 * A function, not a constant, because none of it is static: the copy is the landing page's own
 * translated hero. `title.template` is what lets each route name itself without repeating the
 * brand. `metadataBase` is one level up, in the document layout — it is the deployment's
 * origin, which is the same sentence in both languages.
 */
export async function generateMetadata({ params }: LocaleParams): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'landing' });

  return {
    title: { default: SITE_NAME, template: `%s · ${SITE_NAME}` },
    description: t('subhead'),
    applicationName: SITE_NAME,
    openGraph: {
      type: 'website',
      siteName: SITE_NAME,
      locale,
      title: t('hero'),
      description: t('subhead'),
      // Resolved against `metadataBase`; `opengraph-image.tsx` is what serves it.
      images: ['/opengraph-image'],
    },
    twitter: {
      card: 'summary_large_image',
      title: t('hero'),
      description: t('subhead'),
      images: ['/opengraph-image'],
    },
    // No `alternates` here, deliberately. Next merges metadata down the tree, so a canonical
    // set at the root is inherited by every route that does not override it — which told
    // crawlers `/privacy` and `/terms` were duplicates of the landing page while `sitemap.xml`
    // listed them as distinct URLs. Each public route calls `alternatesFor` instead; a route
    // with none is better off with no canonical than with a wrong one.
  };
}

/**
 * Everything that depends on *which* language this is. The `<html>` around it belongs to
 * `app/layout.tsx`, which sits above this segment so that a 404 has a document too.
 */
export default async function LocaleLayout({
  children,
  params,
}: Readonly<{ children: React.ReactNode } & LocaleParams>) {
  const { locale } = await params;
  // The segment is user input — `/de/dashboard` is a URL anyone can type. The middleware only
  // ever produces a known locale, so anything else reached this layout by guessing.
  if (!hasLocale(routing.locales, locale)) notFound();
  setRequestLocale(locale);

  const messages = await getMessages();

  return (
    <NextIntlClientProvider locale={locale} messages={messages}>
      {/* First in the body, so it is the first Tab stop on every page (issue 96). */}
      <SkipLink />
      <Providers>{children}</Providers>
    </NextIntlClientProvider>
  );
}
