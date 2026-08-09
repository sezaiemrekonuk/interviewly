import type { Metadata } from "next";
import localFont from "next/font/local";
import { NextIntlClientProvider } from "next-intl";
import { getLocale, getMessages, getTranslations } from "next-intl/server";
import "./globals.css";
import { Providers } from "./providers";
import { SkipLink } from "../components/chrome/skip-link";
import { SITE_NAME, SITE_ORIGIN } from "../lib/site";

// Direction B's three roles. Self-hosted woff2 because the CSP is `default-src 'self'`;
// each is subset to latin + latin-ext so Turkish (İ ğ Ğ ş Ş) renders — enforced by
// ui-checks/fonts.test.ts against the real cmaps.

// Display: titles, figures, and the spoken question. Never dense data.
const sourceSerif = localFont({
  src: "../../public/fonts/source-serif-latin.woff2",
  variable: "--font-heading",
  weight: "400 700",
  display: "swap",
});

// Interface: everything the user operates.
const publicSans = localFont({
  src: "../../public/fonts/public-sans-latin.woff2",
  variable: "--font-body",
  weight: "400 700",
  display: "swap",
});

// Data: money, ids, timers, latency — anything that lines up in a column.
const jetbrainsMono = localFont({
  src: "../../public/fonts/jetbrains-mono-latin.woff2",
  variable: "--font-mono",
  weight: "400 700",
  display: "swap",
});

/**
 * The whole metadata surface used to be two hardcoded English lines, applied identically to
 * every route in both languages — so sharing any link rendered a bare grey box, and the
 * Turkish site described itself in English (issue 92).
 *
 * A function, not a constant, because none of it is static: the copy is the landing page's own
 * translated hero, and `metadataBase` is the deployment's origin. `title.template` is what
 * lets each route name itself without repeating the brand.
 */
export async function generateMetadata(): Promise<Metadata> {
  const locale = await getLocale();
  const t = await getTranslations({ locale, namespace: 'landing' });

  return {
    metadataBase: new URL(SITE_ORIGIN),
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
    // listed them as distinct URLs. Each public route declares its own instead; a route with
    // none is better off with no canonical than with a wrong one.
  };
}

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const messages = await getMessages();
  const locale = await getLocale();

  return (
    <html
      lang={locale}
      className={`${sourceSerif.variable} ${publicSans.variable} ${jetbrainsMono.variable}`}
    >
      <body>
        <NextIntlClientProvider locale={locale} messages={messages}>
          {/* First in the body, so it is the first Tab stop on every page (issue 96). */}
          <SkipLink />
          <Providers>{children}</Providers>
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
