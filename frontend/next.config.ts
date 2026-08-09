import type { NextConfig } from "next";
import createNextIntlPlugin from "next-intl/plugin";

const withNextIntl = createNextIntlPlugin("./src/i18n/request.ts");

const nextConfig: NextConfig = {
  output: "standalone",
  // Aliases, not second pages: `/sign-in` and `/register` stay the only rendered routes, so
  // there is one canonical URL per screen and no duplicate form to keep in sync. Next carries
  // the query string across, which is what keeps `/login?error=CODE` showing its banner.
  async redirects() {
    return [
      { source: "/login", destination: "/sign-in", permanent: true },
      { source: "/signin", destination: "/sign-in", permanent: true },
      { source: "/signup", destination: "/register", permanent: true },
    ];
  },
};

export default withNextIntl(nextConfig);
