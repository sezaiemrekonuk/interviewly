import { createNavigation } from 'next-intl/navigation';

import { routing } from './routing';

/**
 * Drop-in replacements for `next/link` and `next/navigation`, bound to the routing above.
 * Import these — not the Next originals — anywhere an app URL is built, or a Turkish reader
 * clicks a link and lands back on the English URL. `href` stays unprefixed at the call site
 * (`/dashboard`, never `/tr/dashboard`); the current locale is what turns it into an address.
 *
 * `useSearchParams` and `useParams` are not here: they read the URL rather than write it, so
 * they keep coming from `next/navigation` directly.
 */
export const { Link, redirect, permanentRedirect, usePathname, useRouter, getPathname } =
  createNavigation(routing);
