/**
 * Issues 95 and 96 — the two things the site chrome owes a visitor who has not signed in and
 * is not using a mouse.
 *
 * 96: a skip link, because the header is sticky and full of section anchors, so the content is
 * six Tab presses away on every navigation and there is no scrolling past it.
 *
 * 95: the header guessed "signed out" from a still-pending `/me`, so it painted the anonymous
 * doorway on every load and swapped it a moment later for anyone who was actually signed in.
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
        ? json(200, { user: { id: 'u1', email: 'a@b.c' } })
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
  it('renders neither doorway until /me has answered', async () => {
    stubMe('pending');
    const HeaderNav = await freshHeaderNav();
    renderWithIntl(<HeaderNav />);

    // The anonymous actions are a *guess* while the probe is in flight, and the wrong one for
    // a signed-in visitor — which is every returning user, on every page load.
    expect(screen.queryByRole('link', { name: messages.nav.signIn })).toBeNull();
    expect(screen.queryByRole('link', { name: messages.nav.tryNow })).toBeNull();
    expect(screen.queryByRole('link', { name: messages.nav.today })).toBeNull();
    // The section anchors do not depend on the session, so they are there immediately.
    expect(screen.getByRole('link', { name: messages.nav.sections.faq })).toBeInTheDocument();
  });

  it('offers the two doorways once the visitor is known to be anonymous', async () => {
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

  it('offers the way back into the product once the visitor is known to be signed in', async () => {
    stubMe('signed-in');
    const HeaderNav = await freshHeaderNav();
    renderWithIntl(<HeaderNav />);

    await waitFor(() =>
      expect(screen.getByRole('link', { name: messages.nav.today })).toBeInTheDocument(),
    );
    expect(screen.queryByRole('link', { name: messages.nav.signIn })).toBeNull();
  });
});
