import localFont from "next/font/local";
import { getLocale } from "next-intl/server";
import "./globals.css";
import { SITE_ORIGIN } from "../lib/site";

import type { Metadata } from "next";

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

/** The deployment's origin, which every relative URL below the tree resolves against. */
export const metadata: Metadata = {
  metadataBase: new URL(SITE_ORIGIN),
};

/**
 * The document, and only the document. Everything that needs to know *which* language this is
 * lives in `[locale]/layout.tsx`; this file exists above that segment because `not-found.tsx`
 * does too.
 *
 * Next renders a not-found outside the matched route's layouts, and when the only layout owning
 * `<html>` sat inside a dynamic segment it had no params to render with — so a 404 came back as
 * a bare error shell with the designed page reachable only after hydration (issue 91). Owning
 * the document one level up puts every response, matched or not, inside the same `<html>`.
 *
 * `lang` comes from the negotiated locale rather than from a route param for the same reason:
 * an unmatched URL has no `[locale]` to read, but the middleware has already decided which
 * language it was asking for.
 */
export default async function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  const locale = await getLocale();

  return (
    <html
      lang={locale}
      className={`${sourceSerif.variable} ${publicSans.variable} ${jetbrainsMono.variable}`}
    >
      <body>{children}</body>
    </html>
  );
}
