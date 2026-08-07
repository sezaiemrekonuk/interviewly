import type { Metadata } from "next";
import localFont from "next/font/local";
import { NextIntlClientProvider } from "next-intl";
import { getLocale, getMessages } from "next-intl/server";
import "./globals.css";
import { Providers } from "./providers";

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

export const metadata: Metadata = {
  title: "Interviewly",
  description: "AI-powered interview practice.",
};

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
          <Providers>{children}</Providers>
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
