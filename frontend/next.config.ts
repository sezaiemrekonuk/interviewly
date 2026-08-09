import createNextIntlPlugin from "next-intl/plugin";

import { locales } from "./src/lib/locales";

import type { NextConfig } from "next";

const withNextIntl = createNextIntlPlugin("./src/i18n/request.ts");

// Aliases, not second pages: `/sign-in` and `/register` stay the only rendered routes, so
// there is one canonical URL per screen and no duplicate form to keep in sync. Next carries
// the query string across, which is what keeps `/login?error=CODE` showing its banner.
const ALIASES = [
  ["/login", "/sign-in"],
  ["/signin", "/sign-in"],
  ["/signup", "/register"],
] as const;

const nextConfig: NextConfig = {
  output: "standalone",
  // Redirects run ahead of middleware, so a bare `/login` is rewritten before the locale is
  // negotiated and lands on the right language by itself. The prefixed forms are here because
  // a Turkish visitor typing `/tr/login` would otherwise get a 404 rather than the sign-in
  // form — the alias has to exist at every address the route does (issue 91).
  async redirects() {
    return ALIASES.flatMap(([from, to]) => [
      { source: from, destination: to, permanent: true },
      ...locales.map((locale) => ({
        source: `/${locale}${from}`,
        destination: `/${locale}${to}`,
        permanent: true,
      })),
    ]);
  },
};

export default withNextIntl(nextConfig);
