import { screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { renderWithIntl } from '../../test/render';

const router = vi.hoisted(() => ({
  push: vi.fn(),
  replace: vi.fn(),
  prefetch: vi.fn(),
  refresh: vi.fn(),
}));
const nav = vi.hoisted(() => ({ search: '' }));

vi.mock('next/navigation', async () => ({
  ...(await import('@/test/navigation')).serverNavigation,
  useRouter: () => router,
  useSearchParams: () => new URLSearchParams(nav.search),
  usePathname: () => '/sign-in',
}));

const RETURNING = {
  id: 'u1',
  email: 'a@b.c',
  onboardingCompletedAt: '2026-08-01T09:00:00Z',
  interviewCount: 3,
};

const MID_ONBOARDING = {
  id: 'u2',
  email: 'n@b.c',
  onboardingCompletedAt: null,
  interviewCount: 0,
};

async function freshGraph() {
  vi.resetModules();
  const [{ AnonymousOnly }, { probeSession }] = await Promise.all([
    import('./anonymous-only'),
    import('../../lib/session-probe'),
  ]);
  return { AnonymousOnly, probeSession };
}

function stubMe(respond: () => Promise<Response>) {
  vi.stubGlobal('fetch', vi.fn(respond));
}

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

const anonymous = () => Promise.resolve(json(401, { error: { code: 'UNAUTHENTICATED' } }));
const signedInAs = (user: unknown) => () => Promise.resolve(json(200, { user }));

beforeEach(() => {
  router.replace.mockReset();
  nav.search = '';
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.resetModules();
});

describe('<AnonymousOnly>', () => {
  it('leaves an anonymous visitor on the page', async () => {
    stubMe(anonymous);
    const { AnonymousOnly, probeSession } = await freshGraph();
    renderWithIntl(
      <AnonymousOnly>
        <p>sign-in form</p>
      </AnonymousOnly>,
    );

    expect(screen.getByText('sign-in form')).toBeInTheDocument();
    await probeSession();
    expect(router.replace).not.toHaveBeenCalled();
  });

  it('sends a signed-in visitor to their landing surface', async () => {
    stubMe(signedInAs(RETURNING));
    const { AnonymousOnly } = await freshGraph();
    renderWithIntl(
      <AnonymousOnly>
        <p>sign-in form</p>
      </AnonymousOnly>,
    );

    await waitFor(() => expect(router.replace).toHaveBeenCalledWith('/dashboard'));
  });

  it('sends a signed-in visitor who never finished onboarding back to onboarding', async () => {
    stubMe(signedInAs(MID_ONBOARDING));
    const { AnonymousOnly } = await freshGraph();
    renderWithIntl(
      <AnonymousOnly>
        <p>sign-in form</p>
      </AnonymousOnly>,
    );

    await waitFor(() => expect(router.replace).toHaveBeenCalledWith('/onboarding/1'));
  });

  it('honours a returnPath over the first-run destination', async () => {
    nav.search = 'returnPath=%2Fsettings';
    stubMe(signedInAs(RETURNING));
    const { AnonymousOnly } = await freshGraph();
    renderWithIntl(
      <AnonymousOnly>
        <p>sign-in form</p>
      </AnonymousOnly>,
    );

    await waitFor(() => expect(router.replace).toHaveBeenCalledWith('/settings'));
  });

  it.each(['https://evil.example/phish', '//evil.example/phish'])(
    'refuses the off-site returnPath %s',
    async (hostile) => {
      nav.search = `returnPath=${encodeURIComponent(hostile)}`;
      stubMe(signedInAs(RETURNING));
      const { AnonymousOnly } = await freshGraph();
      renderWithIntl(
        <AnonymousOnly>
          <p>sign-in form</p>
        </AnonymousOnly>,
      );

      await waitFor(() => expect(router.replace).toHaveBeenCalledWith('/dashboard'));
    },
  );

  it('leaves the page usable when the probe fails outright', async () => {
    stubMe(() => Promise.reject(new Error('offline')));
    const { AnonymousOnly, probeSession } = await freshGraph();
    renderWithIntl(
      <AnonymousOnly>
        <p>sign-in form</p>
      </AnonymousOnly>,
    );

    expect(screen.getByText('sign-in form')).toBeInTheDocument();
    await probeSession();
    expect(router.replace).not.toHaveBeenCalled();
  });
});
