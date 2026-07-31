import { renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const nav = vi.hoisted(() => ({ replace: vi.fn(), pathname: '/interviews/abc' }));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: nav.replace, push: vi.fn(), prefetch: vi.fn(), refresh: vi.fn() }),
  usePathname: () => nav.pathname,
}));

import { useRequireAuth } from './use-require-auth';

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

    renderHook(() => useRequireAuth());

    await waitFor(() =>
      expect(nav.replace).toHaveBeenCalledWith('/sign-in?returnPath=%2Finterviews%2Fabc'),
    );
  });

  it('returns the user and stops loading when the session is live', async () => {
    stubFetch(200, { user: { id: 'u1', email: 'a@b.io', role: 'user', locale: 'en' } });

    const { result } = renderHook(() => useRequireAuth());

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.user?.id).toBe('u1');
    expect(nav.replace).not.toHaveBeenCalled();
  });
});
