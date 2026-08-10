import { hasLocale } from 'next-intl';
import { getRequestConfig } from 'next-intl/server';

import { routing } from './routing';

/**
 * `requestLocale` is the `[locale]` segment now, resolved by the middleware before the request
 * reaches a page — no cookie read here. That is what makes the locale a property of the URL
 * rather than of the browser asking for it (issue 91), and it is also what lets a page be
 * rendered without a request at all.
 */
export default getRequestConfig(async ({ requestLocale }) => {
  const requested = await requestLocale;
  const locale = hasLocale(routing.locales, requested) ? requested : routing.defaultLocale;

  return {
    locale,
    // A global `now` is what `format.relativeTime` reads when no explicit one is passed;
    // without it next-intl falls back to the environment clock and logs ENVIRONMENT_FALLBACK.
    // Call sites that must keep ticking pair this with `useNow({ updateInterval })`.
    now: new Date(),
    messages: (await import(`../../messages/${locale}.json`)).default,
  };
});
