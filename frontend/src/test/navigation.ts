import { vi } from 'vitest';

/**
 * What a `vi.mock('next/navigation', …)` factory has to keep alive.
 *
 * Components navigate through `i18n/navigation` now, so that the locale survives a click
 * (issue 91) — and next-intl builds those wrappers by importing `redirect` and
 * `permanentRedirect` from `next/navigation` at module load. A factory that returns only the
 * hooks a test cares about deletes those two exports, and every component importing the
 * wrappers then fails to import at all, with an error that names next-intl rather than the
 * mock. Neither is ever called from a client component; they exist here to be present.
 *
 * Spread it first, so a test can still override anything it names itself:
 *
 * ```ts
 * vi.mock('next/navigation', async () => ({
 *   ...(await import('@/test/navigation')).serverNavigation,
 *   useRouter: () => router,
 * }));
 * ```
 */
export const serverNavigation = {
  redirect: vi.fn(),
  permanentRedirect: vi.fn(),
};
