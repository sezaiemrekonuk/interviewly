import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { formCalls, jsonResponse, stubFetch } from '../../../test/fetch';
import { messages, renderWithProviders } from '../../../test/render';

const nav = vi.hoisted(() => ({ push: vi.fn(), replace: vi.fn(), search: '' }));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: nav.push, replace: nav.replace, prefetch: vi.fn(), refresh: vi.fn() }),
  useSearchParams: () => new URLSearchParams(nav.search),
  usePathname: () => '/sign-in',
}));

import SignInPage from './page';

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
    renderWithProviders(<SignInPage />);

    await fillAndSubmit('someone@example.com', 'wrong-password');

    expect(await screen.findByText(messages.errors.INVALID_CREDENTIALS)).toBeInTheDocument();
    expect(screen.queryByText(/INVALID_CREDENTIALS/)).toBeNull();
    expect(nav.replace).not.toHaveBeenCalled();
  });

  // A06 (K8.7): with no explicit returnPath the landing place is the server's answer about
  // this account, not a constant. A signed-in visitor who never finished onboarding is sent
  // back to it however they arrived.
  it('sends the credentials to the login endpoint and lands where first-run says', async () => {
    const fetchSpy = stubFetch(200, {
      user: { id: 'u1', email: 'someone@example.com', onboardingCompletedAt: null, interviewCount: 0 },
    });
    renderWithProviders(<SignInPage />);

    await fillAndSubmit('someone@example.com', 'correct-horse');

    await waitFor(() => expect(nav.replace).toHaveBeenCalledWith('/onboarding/1'));
    expect(formCalls(fetchSpy)[0][0]).toBe('/api/auth/login');
  });

  it('lands a returning user on the briefing at /dashboard', async () => {
    stubFetch(200, {
      user: {
        id: 'u1',
        email: 'someone@example.com',
        onboardingCompletedAt: '2026-08-01T09:00:00Z',
        interviewCount: 3,
      },
    });
    renderWithProviders(<SignInPage />);

    await fillAndSubmit('someone@example.com', 'correct-horse');

    await waitFor(() => expect(nav.replace).toHaveBeenCalledWith('/dashboard'));
  });

  // A02 redirects the two K8 refusals to `/sign-in?error=<CODE>`; the browser arrives with
  // no form interaction at all, so the message has to come up on mount.
  //
  // Issue 139: and it has to come up *at the Google button*. Both codes are reachable only
  // through the OAuth flow and both recover by using the password form, so rendering them
  // above that form marked the control that would have worked.
  it.each(['ADMIN_MUST_USE_PASSWORD', 'ACCOUNT_LINK_REQUIRES_PASSWORD'])(
    'puts the OAuth-only refusal %s beside the Google button, not above the form',
    async (code) => {
      nav.search = `error=${code}`;
      stubFetch(200, {});
      const { container } = renderWithProviders(<SignInPage />);

      const message = await screen.findByText(
        messages.errors[code as keyof typeof messages.errors],
      );
      expect(message).toHaveAttribute('role', 'alert');
      expect(screen.queryByText(new RegExp(code))).toBeNull();

      // Position, not just presence: the message must follow the form, and the banner slot
      // above it must be empty. `.banner` is the element this used to render into.
      const form = container.querySelector('form')!;
      expect(form.compareDocumentPosition(message) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
      expect(container.querySelector('[class*="banner"]')).toBeNull();
    },
  );

  it('still renders a non-OAuth code as the form banner', async () => {
    nav.search = 'error=RATE_LIMITED';
    stubFetch(200, {});
    const { container } = renderWithProviders(<SignInPage />);

    const message = await screen.findByText(messages.errors.RATE_LIMITED);
    const form = container.querySelector('form')!;
    expect(form.compareDocumentPosition(message) & Node.DOCUMENT_POSITION_PRECEDING).toBeTruthy();
  });

  // Issue 60: `GET /auth/google` on a deployment with no client credentials now redirects
  // here instead of answering a JSON body, so this is the screen that has to say what
  // happened. The code arrives the same way the two K8 refusals above do.
  it('renders NOT_READY as a message rather than as the code the redirect carried', async () => {
    nav.search = 'error=NOT_READY';
    stubFetch(200, {});
    renderWithProviders(<SignInPage />);

    expect(await screen.findByText(messages.errors.NOT_READY)).toBeInTheDocument();
    expect(screen.queryByText(/NOT_READY/)).toBeNull();
  });

  it('honours a relative returnPath after a successful sign-in', async () => {
    nav.search = 'returnPath=%2Finterviews%2Fabc';
    stubFetch(200, { user: { id: 'u1' } });
    renderWithProviders(<SignInPage />);

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
      renderWithProviders(<SignInPage />);

      await fillAndSubmit('someone@example.com', 'correct-horse');

      await waitFor(() => expect(nav.replace).toHaveBeenCalledWith('/dashboard'));
    },
  );

  // Issue 113 — the spec's loading state is "submit button in-flight, fields locked". An
  // editable field mid-request means the error that lands describes the value that was sent,
  // next to the different value now on screen.
  it('locks both fields while the request is in flight and frees them on the error', async () => {
    let answer: (response: Response) => void = () => {};
    const inFlight = new Promise<Response>((resolve) => {
      answer = resolve;
    });
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string | URL) =>
        String(url) === '/api/auth/capabilities'
          ? jsonResponse(200, { oauth: { google: true } })
          : inFlight,
      ),
    );
    renderWithProviders(<SignInPage />);

    const email = screen.getByLabelText(messages.auth.emailLabel);
    const password = screen.getByLabelText(messages.auth.passwordLabel);
    await fillAndSubmit('someone@example.com', 'wrong-password');

    await waitFor(() => expect(email).toBeDisabled());
    expect(password).toBeDisabled();
    expect(email.closest('form')).toHaveAttribute('aria-busy', 'true');

    answer(jsonResponse(401, { error: { code: 'INVALID_CREDENTIALS' } }));

    // Editable again on the failure path, not only on success, and still carrying what the
    // visitor typed — otherwise the correction starts from an empty form.
    expect(await screen.findByText(messages.errors.INVALID_CREDENTIALS)).toBeInTheDocument();
    expect(email).toBeEnabled();
    expect(password).toBeEnabled();
    expect(email).toHaveValue('someone@example.com');
    expect(password).toHaveValue('wrong-password');
    expect(email.closest('form')).not.toHaveAttribute('aria-busy');
  });

  it('offers the forgot-password and register links', () => {
    stubFetch(200, {});
    renderWithProviders(<SignInPage />);

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
