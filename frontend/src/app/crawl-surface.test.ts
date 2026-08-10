/**
 * Issues 92 and 93. The half worth pinning in CI is the crawl policy: `/admin`, `/dashboard`
 * and `/interviews/*` were indexable, and they 401 or redirect for a crawler — so they burn
 * crawl budget and land in Search Console as soft-404s, suppressing the pages that should
 * rank. A route added to the app without a thought about which side of that line it falls on
 * is exactly how the list rots, so the two files are asserted against one another rather than
 * against a copy of themselves.
 *
 * Both halves are now per-locale (issue 91): `/dashboard` and `/tr/dashboard` are two URLs, so
 * a policy that names only one of them covers half the site.
 */
import { describe, expect, it } from 'vitest';

import { getPathname } from '../i18n/navigation';
import { locales } from '../lib/locales';
import { DEFAULT_LOCALE } from '../lib/locales';
import { alternatesFor, PRIVATE_ROUTES, PUBLIC_ROUTES, SITE_ORIGIN } from '../lib/site';
import { token } from '../lib/design-tokens';

/** Every address a route answers on — `/privacy` and `/tr/privacy`, not one or the other. */
const addresses = (route: string) =>
  locales.map((locale) => getPathname({ href: route, locale }));

import robots from './robots';
import sitemap from './sitemap';

describe('robots.txt', () => {
  const rules = () => {
    const value = robots().rules;
    return Array.isArray(value) ? value[0] : value;
  };

  it('disallows every private surface, at the path Next actually serves', () => {
    const disallow = rules().disallow;
    const listed = Array.isArray(disallow) ? disallow : [disallow];

    for (const route of PRIVATE_ROUTES.flatMap(addresses)) {
      // The bare path, not `${route}/`. robots.txt matching is a prefix test, so a rule with a
      // trailing slash covers `/admin/foo` and misses `/admin` — the URL Next serves — which
      // left every one of these crawlable while the file looked correct. The first version of
      // this test asserted the slashed form and so agreed with the bug.
      expect({ route, listed: listed.includes(route) }).toEqual({ route, listed: true });
    }
  });

  it('blocks the bare path, the slashed path and everything under it', () => {
    const disallow = rules().disallow;
    const listed = (Array.isArray(disallow) ? disallow : [disallow]).filter(Boolean) as string[];
    // What a crawler actually does with the file: does any rule prefix-match this URL?
    const blocked = (path: string) => listed.some((rule) => path.startsWith(rule));

    for (const route of PRIVATE_ROUTES.flatMap(addresses)) {
      for (const path of [route, `${route}/`, `${route}/anything/deeper`]) {
        expect({ path, blocked: blocked(path) }).toEqual({ path, blocked: true });
      }
    }
    // And the public surface is not caught by any of them, in either language. `/tr` is the
    // Turkish landing page and a prefix of every other Turkish URL, so a careless
    // `Disallow: /tr` would take the whole primary market out of the index.
    for (const route of PUBLIC_ROUTES.flatMap(addresses)) {
      expect({ route, blocked: blocked(route) }).toEqual({ route, blocked: false });
    }
  });

  it('names a hostname in `host`, which takes no scheme', () => {
    const { host } = robots();
    expect(host).toBe(new URL(SITE_ORIGIN).host);
    expect(host).not.toMatch(/^https?:/);
  });

  it('points at an absolute sitemap on this deployment, not a relative path', () => {
    const { sitemap: url } = robots();
    expect(url).toBe(`${SITE_ORIGIN}/sitemap.xml`);
    expect(() => new URL(String(url))).not.toThrow();
  });
});

describe('sitemap.xml', () => {
  it('lists both language variants of every public route, and nothing else', () => {
    const listed = sitemap().map((entry) => new URL(entry.url).pathname);
    expect(listed.sort()).toEqual(PUBLIC_ROUTES.flatMap(addresses).sort());
  });

  it('gives every entry a reciprocal hreflang set including itself', () => {
    // The half Google enforces: an entry that names its counterpart without being named back
    // is discarded, and the pair then reads as two unrelated pages competing with each other.
    for (const entry of sitemap()) {
      const languages = entry.alternates?.languages ?? {};
      expect({ url: entry.url, locales: Object.keys(languages).sort() }).toEqual({
        url: entry.url,
        locales: [...locales].sort(),
      });
      expect(Object.values(languages)).toContain(entry.url);
    }
  });

  it('never leaks a private surface into the index', () => {
    // The failure this catches is a route landing in both lists, which reads as "crawl this"
    // and "do not crawl this" at once — and the sitemap is the one a crawler acts on first.
    const privateAddresses = PRIVATE_ROUTES.flatMap(addresses);
    for (const entry of sitemap()) {
      const path = new URL(entry.url).pathname;
      const clash = privateAddresses.find((p) => path === p || path.startsWith(`${p}/`));
      expect({ path, clash: clash ?? null }).toEqual({ path, clash: null });
    }
  });

  it('emits absolute URLs — a sitemap of relative paths is rejected outright', () => {
    for (const entry of sitemap()) {
      expect(entry.url.startsWith(SITE_ORIGIN)).toBe(true);
    }
  });
});

describe('design tokens behind the metadata images', () => {
  it('resolves from the shipped registry rather than a literal', () => {
    // What keeps the manifest and the OG card obeying DESIGN.md §2 instead of hardcoding
    // three hexes in a file the token lint would otherwise have to exempt.
    expect(token('--rail')).toMatch(/^#[0-9A-Fa-f]{6}$/);
    expect(token('--bg')).toMatch(/^#[0-9A-Fa-f]{6}$/);
  });

  it('throws on an unknown token instead of shipping a wrong colour quietly', () => {
    expect(() => token('--not-a-token')).toThrow(/not found/);
  });
});

describe('hreflang alternates on a public route', () => {
  it('gives every locale a URL of its own — which is the whole of issue 91', () => {
    for (const route of PUBLIC_ROUTES) {
      const languages = alternatesFor(route, DEFAULT_LOCALE)!.languages!;
      expect({ route, distinct: new Set(Object.values(languages)).size }).toEqual({
        route,
        // One address per locale, plus `x-default`, which repeats the default locale's.
        distinct: locales.length,
      });
    }
  });

  it('points its canonical at the address the reader is actually on', () => {
    for (const locale of locales) {
      expect(alternatesFor('/privacy', locale)!.canonical).toBe(
        getPathname({ href: '/privacy', locale }),
      );
    }
  });

  it('names the same set from either side, because Google discards a one-way pair', () => {
    for (const route of PUBLIC_ROUTES) {
      const [first, ...rest] = locales.map((locale) => alternatesFor(route, locale)!.languages);
      for (const other of rest) expect(other).toEqual(first);
    }
  });

  it('sends an unmatched visitor to the default locale via x-default', () => {
    const languages = alternatesFor('/', 'tr')!.languages!;
    expect(languages['x-default']).toBe(getPathname({ href: '/', locale: DEFAULT_LOCALE }));
  });
});
