'use client';

import { useTranslations } from 'next-intl';
import { useCallback } from 'react';

/**
 * Turns an API error code into a localised string.
 *
 * The frontend never builds display text out of a code — it looks the code up in the
 * `errors` namespace F01 seeded from the registry. A code the registry does not carry
 * (an older client against a newer API, say) falls back to `errors.UNKNOWN` rather than
 * leaking `SOMETHING_NEW` into the page.
 */
export function useErrorMessage(): (code: string) => string {
  const t = useTranslations('errors');

  return useCallback(
    (code: string) => {
      // `has`/`t` are typed against the compile-time message tree; a code that arrives
      // over the wire is a plain string, which is exactly the case `has` exists for.
      const key = code as Parameters<typeof t.has>[0];
      return t.has(key) ? t(key) : t('UNKNOWN');
    },
    [t],
  );
}
