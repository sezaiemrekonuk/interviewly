/**
 * Where this deployment lives, as the metadata layer needs it.
 *
 * `PUBLIC_ORIGIN` arrives at runtime through `env_file` (compose), not as a `NEXT_PUBLIC_*`
 * build arg — so it is read here on the server rather than inlined into the client bundle,
 * and a deployment can move without a rebuild. Absolute URLs matter: Open Graph consumers
 * do not resolve relative image paths, so `metadataBase` is what makes the card work at all.
 */
export const SITE_ORIGIN = process.env.PUBLIC_ORIGIN ?? 'http://localhost';

export const SITE_NAME = 'Interviewly';

/** The routes a crawler should see. Everything else is behind a session and stays out. */
export const PUBLIC_ROUTES = ['/', '/register', '/sign-in', '/privacy', '/terms'] as const;

/**
 * Surfaces that must never be indexed. They redirect or 401 for an anonymous crawler, so they
 * would land in Search Console as soft-404s and spend crawl budget that belongs to the pages
 * that should rank.
 */
export const PRIVATE_ROUTES = ['/admin', '/dashboard', '/interviews', '/onboarding', '/profile', '/settings', '/api'] as const;
