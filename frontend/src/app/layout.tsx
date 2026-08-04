import type { Metadata } from "next";
import localFont from "next/font/local";
import { NextIntlClientProvider } from "next-intl";
import { getLocale, getMessages } from "next-intl/server";
import "./globals.css";
import { Providers } from "./providers";

const outfit = localFont({
  src: "../../public/fonts/outfit-latin.woff2",
  variable: "--font-heading",
  weight: "500 700",
  display: "swap",
});

const inter = localFont({
  src: "../../public/fonts/inter-latin.woff2",
  variable: "--font-body",
  weight: "400 600",
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
    <html lang={locale} className={`${outfit.variable} ${inter.variable}`}>
      <body>
        <NextIntlClientProvider locale={locale} messages={messages}>
          <Providers>{children}</Providers>
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
