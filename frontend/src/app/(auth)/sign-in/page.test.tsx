import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { messages, renderWithIntl } from '../../../test/render';

const nav = vi.hoisted(() => ({ push: vi.fn(), replace: vi.fn(), search: '' }));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: nav.push, replace: nav.replace, prefetch: vi.fn(), refresh: vi.fn() }),
  useSearchParams: () => new URLSearchParams(nav.search),
  usePathname: () => '/sign-in',
}));

import SignInPage from './page';

function stubFetch(status: number, body: unknown) {
  const spy = vi.fn(async () =>
    new Response(JSON.stringify(body), {
      status,
      headers: { 'content-type': 'application/json' },
    }),
  );
  vi.stubGlobal('fetch', spy);
  return spy;
}

async function fillAndSubmit(email: string, password: string) {
  const user = userEvent.setup();
  await user.type(screen.getByLabelText(messages.auth.emailLabel), email);
  await user.type(screen.getByLabelText(messages.auth.passwordLabel), password);
  await user.click(screen.getByRole('button', { name: messages.auth.signIn }));
}

describe('sign-in page', () => {
  beforeEach(() => {
    nav.push.mockReset();
    nav.replace.mockReset();
    nav.search = '';
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('renders INVALID_CREDENTIALS from the error code', async () => {
    stubFetch(401, { error: { code: 'INVALID_CREDENTIALS' } });
    renderWithIntl(<SignInPage />);

    await fillAndSubmit('someone@example.com', 'wrong-password');

    expect(await screen.findByText(messages.errors.INVALID_CREDENTIALS)).toBeInTheDocument();
    expect(screen.queryByText(/INVALID_CREDENTIALS/)).toBeNull();
    expect(nav.replace).not.toHaveBeenCalled();
  });

  it('sends the credentials to the login endpoint and lands on the dashboard', async () => {
    const fetchSpy = stubFetch(200, { user: { id: 'u1', email: 'someone@example.com' } });
    renderWithIntl(<SignInPage />);

    await fillAndSubmit('someone@example.com', 'correct-horse');

    await waitFor(() => expect(nav.replace).toHaveBeenCalledWith('/dashboard'));
    expect((fetchSpy.mock.calls[0] as unknown as [string])[0]).toBe('/api/auth/login');
  });

  // A02 redirects the two K8 refusals to `/sign-in?error=<CODE>`; the browser arrives with
  // no form interaction at all, so the banner has to come up on mount.
  it('shows the OAuth refusal carried in ?error= on mount', async () => {
    nav.search = 'error=ADMIN_MUST_USE_PASSWORD';
    renderWithIntl(<SignInPage />);

    expect(
      await screen.findByText(messages.errors.ADMIN_MUST_USE_PASSWORD),
    ).toBeInTheDocument();
    expect(screen.queryByText(/ADMIN_MUST_USE_PASSWORD/)).toBeNull();
  });

  it('honours a relative returnPath after a successful sign-in', async () => {
    nav.search = 'returnPath=%2Finterviews%2Fabc';
    stubFetch(200, { user: { id: 'u1' } });
    renderWithIntl(<SignInPage />);

    await fillAndSubmit('someone@example.com', 'correct-horse');

    await waitFor(() => expect(nav.replace).toHaveBeenCalledWith('/interviews/abc'));
  });

  // Open-redirect defence: `?returnPath=https://evil.example` must not become a navigation
  // target, and neither must a protocol-relative `//evil.example`, which `startsWith('/')`
  // alone would wave through.
  it.each(['https://evil.example/phish', '//evil.example/phish'])(
    'ignores the off-site returnPath %s',
    async (hostile) => {
      nav.search = `returnPath=${encodeURIComponent(hostile)}`;
      stubFetch(200, { user: { id: 'u1' } });
      renderWithIntl(<SignInPage />);

      await fillAndSubmit('someone@example.com', 'correct-horse');

      await waitFor(() => expect(nav.replace).toHaveBeenCalledWith('/dashboard'));
    },
  );

  it('offers the forgot-password and register links', () => {
    renderWithIntl(<SignInPage />);

    expect(screen.getByRole('link', { name: messages.auth.forgotPassword })).toHaveAttribute(
      'href',
      '/forgot-password',
    );
    expect(screen.getByRole('link', { name: messages.auth.register })).toHaveAttribute(
      'href',
      '/register',
    );
  });
});
