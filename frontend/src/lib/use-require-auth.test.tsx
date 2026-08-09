import { renderHook, waitFor } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import messages from '../../messages/en.json';

const nav = vi.hoisted(() => ({ replace: vi.fn(), pathname: '/interviews/abc' }));

vi.mock('next/navigation', async () => ({
  ...(await import('@/test/navigation')).serverNavigation,
  useRouter: () => ({ replace: nav.replace, push: vi.fn(), prefetch: vi.fn(), refresh: vi.fn() }),
  usePathname: () => nav.pathname,
}));

import { useRequireAuth } from './use-require-auth';

/**
 * The hook routes through `i18n/navigation`, which reads the active locale to decide whether
 * the destination needs a prefix (issue 91) — so it needs the provider even though nothing it
 * renders is translated.
 */
function render() {
  return renderHook(() => useRequireAuth(), {
    wrapper: ({ children }) => (
      <NextIntlClientProvider locale="en" messages={messages}>
        {children}
      </NextIntlClientProvider>
    ),
  });
}

function stubFetch(status: number, body: unknown) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () =>
      new Response(JSON.stringify(body), {
        status,
        headers: { 'content-type': 'application/json' },
      }),
    ),
  );
}

describe('useRequireAuth', () => {
  beforeEach(() => {
    nav.replace.mockReset();
    nav.pathname = '/interviews/abc';
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('sends an unauthenticated visitor to sign-in with the path preserved', async () => {
    stubFetch(401, { error: { code: 'UNAUTHENTICATED' } });

    render();

    await waitFor(() =>
      expect(nav.replace).toHaveBeenCalledWith('/sign-in?returnPath=%2Finterviews%2Fabc'),
    );
  });

  it('returns the user and stops loading when the session is live', async () => {
    stubFetch(200, { user: { id: 'u1', email: 'a@b.io', role: 'user', locale: 'en' } });

    const { result } = render();

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.user?.id).toBe('u1');
    expect(nav.replace).not.toHaveBeenCalled();
  });
});
