/**
 * Issue 96: a skip link, because the header is sticky and full of section anchors, so the
 * content is six Tab presses away on every navigation and there is no scrolling past it.
 *
 * And the header's two auth actions, which are now the same two labels for everyone — only
 * where they lead depends on the session. That is what retired issue 95's tri-state: with no
 * label that differs by session there is no wrong doorway to flash, so nothing waits on `/me`.
 */
import { screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { messages, renderWithIntl } from '../../test/render';

vi.mock('next/navigation', async () => ({
  ...(await import('@/test/navigation')).serverNavigation,
  usePathname: () => '/',
}));

import { SkipLink } from './skip-link';

/**
 * `lib/session-probe.ts` memoises the in-flight `/me` promise, and the pending case below
 * never settles — so it would leak into every test after it. A fresh module graph per case is
 * also closer to what each of these actually describes: a page load.
 */
async function freshHeaderNav() {
  vi.resetModules();
  const mod = await import('./header-nav');
  return mod.HeaderNav;
}

/** `/me`, answered on demand so the pending state is observable rather than raced past. */
function stubMe(response: 'signed-in' | 'anonymous' | 'pending') {
  const json = (status: number, body: unknown) =>
    new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

  vi.stubGlobal(
    'fetch',
    vi.fn(async () => {
      if (response === 'pending') return new Promise<Response>(() => {});
      return response === 'signed-in'
        ? json(200, {
            user: {
              id: 'u1',
              email: 'a@b.c',
              onboardingCompletedAt: '2026-08-01T09:00:00Z',
              interviewCount: 3,
            },
          })
        : json(401, { error: { code: 'UNAUTHENTICATED' } });
    }),
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.resetModules();
});

describe('<SkipLink>', () => {
  it('points at the id every main in the app carries', () => {
    renderWithIntl(<SkipLink />);

    const link = screen.getByRole('link', { name: messages.common.skipToContent });
    // An anchor, not a scroll handler: `href` is what moves focus, and focus is the point.
    expect(link).toHaveAttribute('href', '#content');
  });
});

describe('<HeaderNav> auth actions', () => {
  it('paints both actions with the anonymous destinations before /me has answered', async () => {
    stubMe('pending');
    const HeaderNav = await freshHeaderNav();
    renderWithIntl(<HeaderNav />);

    expect(screen.getByRole('link', { name: messages.nav.signIn })).toHaveAttribute(
      'href',
      '/sign-in',
    );
    expect(screen.getByRole('link', { name: messages.nav.tryNow })).toHaveAttribute(
      'href',
      '/register',
    );
    expect(screen.getByRole('link', { name: messages.nav.sections.faq })).toBeInTheDocument();
  });

  it('keeps the two doorways once the visitor is known to be anonymous', async () => {
    stubMe('anonymous');
    const HeaderNav = await freshHeaderNav();
    renderWithIntl(<HeaderNav />);

    await waitFor(() =>
      expect(screen.getByRole('link', { name: messages.nav.signIn })).toHaveAttribute(
        'href',
        '/sign-in',
      ),
    );
    expect(screen.getByRole('link', { name: messages.nav.tryNow })).toHaveAttribute(
      'href',
      '/register',
    );
  });

  it('keeps the same two labels for a signed-in visitor and re-points both into the app', async () => {
    stubMe('signed-in');
    const HeaderNav = await freshHeaderNav();
    renderWithIntl(<HeaderNav />);

    await waitFor(() =>
      expect(screen.getByRole('link', { name: messages.nav.signIn })).toHaveAttribute(
        'href',
        '/dashboard',
      ),
    );
    expect(screen.getByRole('link', { name: messages.nav.tryNow })).toHaveAttribute(
      'href',
      '/dashboard',
    );
    expect(screen.queryByRole('link', { name: messages.nav.today })).toBeNull();
  });
});
