import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { messages, renderWithIntl } from '../../../../test/render';

const nav = vi.hoisted(() => ({ replace: vi.fn() }));

vi.mock('next/navigation', async () => ({
  ...(await import('@/test/navigation')).serverNavigation,
  useRouter: () => ({ push: vi.fn(), replace: nav.replace, prefetch: vi.fn(), refresh: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
  usePathname: () => '/forgot-password',
}));

import ForgotPasswordPage from './page';

// The endpoint answers 202 with no body at all, which is what the screen has to cope with:
// `apiPost` parses the body and gets nothing.
//
// `/api/me` is answered separately and anonymously: the screen is wrapped in
// `components/auth/anonymous-only.tsx`, so it probes the session on mount, and the canned
// answer here would otherwise make every case a signed-in one.
function stubFetch(status: number, body?: unknown) {
  const spy = vi.fn(async (url: string | URL) => {
    if (String(url) === '/api/me')
      return new Response(JSON.stringify({ error: { code: 'UNAUTHENTICATED' } }), {
        status: 401,
        headers: { 'content-type': 'application/json' },
      });
    return body === undefined
      ? new Response(null, { status })
      : new Response(JSON.stringify(body), {
          status,
          headers: { 'content-type': 'application/json' },
        });
  });
  vi.stubGlobal('fetch', spy);
  return spy;
}

function formCalls(spy: ReturnType<typeof stubFetch>) {
  return spy.mock.calls.filter(([url]) => String(url) !== '/api/me');
}

async function submit(email: string) {
  const user = userEvent.setup();
  await user.type(screen.getByLabelText(messages.auth.emailLabel), email);
  await user.click(screen.getByRole('button', { name: messages.auth.sendResetLink }));
}

describe('forgot-password page', () => {
  beforeEach(() => {
    nav.replace.mockReset();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('posts the address and confirms without saying whether an account exists', async () => {
    const fetchSpy = stubFetch(202);
    renderWithIntl(<ForgotPasswordPage />);

    await submit('known@example.com');

    expect(await screen.findByText(messages.auth.forgotSentBody)).toBeInTheDocument();
    expect(fetchSpy).toHaveBeenCalledWith(
      '/api/auth/password-reset/request',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ email: 'known@example.com' }),
      }),
    );
    expect(nav.replace).not.toHaveBeenCalled();
  });

  // The API cannot tell the two apart, and this is the assertion that keeps the client from
  // reintroducing the difference on its own.
  it('shows the same copy for an address that has no account', async () => {
    stubFetch(202);
    const { unmount } = renderWithIntl(<ForgotPasswordPage />);
    await submit('known@example.com');
    const known = (await screen.findByText(messages.auth.forgotSentBody)).textContent;
    unmount();

    renderWithIntl(<ForgotPasswordPage />);
    await submit('unknown@example.com');
    expect((await screen.findByText(messages.auth.forgotSentBody)).textContent).toBe(known);
  });

  it('renders the rate-limit refusal from the registry', async () => {
    stubFetch(429, { error: { code: 'RATE_LIMITED' } });
    renderWithIntl(<ForgotPasswordPage />);

    await submit('known@example.com');

    expect(await screen.findByRole('alert')).toHaveTextContent(messages.errors.RATE_LIMITED);
  });

  it('does not call the API for an address that is not an email', async () => {
    const fetchSpy = stubFetch(202);
    renderWithIntl(<ForgotPasswordPage />);

    await submit('not-an-email');

    await waitFor(() =>
      expect(screen.getByText(messages.errors.VALIDATION_ERROR)).toBeInTheDocument(),
    );
    expect(formCalls(fetchSpy)).toEqual([]);
  });
});
