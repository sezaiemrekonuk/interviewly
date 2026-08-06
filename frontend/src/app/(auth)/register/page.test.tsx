import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { messages, renderWithIntl } from '../../../test/render';

const nav = vi.hoisted(() => ({ push: vi.fn(), replace: vi.fn(), search: '' }));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: nav.push, replace: nav.replace, prefetch: vi.fn(), refresh: vi.fn() }),
  useSearchParams: () => new URLSearchParams(nav.search),
  usePathname: () => '/register',
}));

import RegisterPage from './page';

/** A `fetch` stand-in that answers with one status + JSON body and records its calls. */
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

/** Consent is part of a normal registration (issue 009), so the happy path ticks the box. */
async function fillAndSubmit(email: string, password: string, consent = true) {
  const user = userEvent.setup();
  await user.type(screen.getByLabelText(messages.auth.emailLabel), email);
  await user.type(screen.getByLabelText(messages.auth.passwordLabel), password);
  if (consent) await user.click(screen.getByRole('checkbox'));
  await user.click(screen.getByRole('button', { name: messages.auth.register }));
}

describe('register page', () => {
  beforeEach(() => {
    nav.push.mockReset();
    nav.replace.mockReset();
    nav.search = '';
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('rejects a short password inline without calling the API', async () => {
    const fetchSpy = stubFetch(201, {});
    renderWithIntl(<RegisterPage />);

    await fillAndSubmit('someone@example.com', 'short');

    expect(await screen.findByText(messages.errors.PASSWORD_TOO_SHORT)).toBeInTheDocument();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  // A06 (K8.7): a brand-new account has never completed onboarding, so registration always
  // lands there — the landing surface is unreachable from here by construction.
  it('sends the credentials to the register endpoint and lands on onboarding', async () => {
    const fetchSpy = stubFetch(201, {
      user: { id: 'u1', email: 'someone@example.com', onboardingCompletedAt: null, interviewCount: 0 },
    });
    renderWithIntl(<RegisterPage />);

    await fillAndSubmit('someone@example.com', 'correct-horse');

    await waitFor(() => expect(nav.replace).toHaveBeenCalledWith('/onboarding/1'));

    const [url, init] = fetchSpy.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('/api/auth/register');
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body as string)).toEqual({
      email: 'someone@example.com',
      password: 'correct-horse',
      consent: true,
    });
  });

  it('renders EMAIL_TAKEN from the error code, never the raw code', async () => {
    stubFetch(409, { error: { code: 'EMAIL_TAKEN' } });
    renderWithIntl(<RegisterPage />);

    await fillAndSubmit('taken@example.com', 'correct-horse');

    expect(await screen.findByText(messages.errors.EMAIL_TAKEN)).toBeInTheDocument();
    expect(screen.queryByText(/EMAIL_TAKEN/)).toBeNull();
    expect(nav.replace).not.toHaveBeenCalled();
  });

  it('falls back to UNKNOWN for a code that is not in the registry', async () => {
    stubFetch(500, { error: { code: 'SOMETHING_NEW' } });
    renderWithIntl(<RegisterPage />);

    await fillAndSubmit('someone@example.com', 'correct-horse');

    expect(await screen.findByText(messages.errors.UNKNOWN)).toBeInTheDocument();
    expect(screen.queryByText(/SOMETHING_NEW/)).toBeNull();
  });

  it('points the Google button at the API redirect chain rather than fetching it', async () => {
    const user = userEvent.setup();
    renderWithIntl(<RegisterPage />);
    await user.click(screen.getByRole('checkbox'));

    const google = screen.getByRole('link', { name: messages.auth.googleButton });
    expect(google).toHaveAttribute('href', '/api/auth/google');
    expect(google).not.toHaveAttribute('aria-disabled');
  });

  // --------------------------------------------------------------- consent (issue 009)

  it('refuses to submit until the policies are accepted, and calls nothing', async () => {
    const fetchSpy = stubFetch(201, {});
    renderWithIntl(<RegisterPage />);

    await fillAndSubmit('someone@example.com', 'correct-horse', false);

    expect(await screen.findByText(messages.errors.CONSENT_REQUIRED)).toBeInTheDocument();
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(nav.replace).not.toHaveBeenCalled();
  });

  // The Google redirect creates an account too, so it cannot sit outside the consent gate.
  it('holds the Google route shut until the box is ticked', async () => {
    const user = userEvent.setup();
    renderWithIntl(<RegisterPage />);

    expect(screen.getByRole('link', { name: messages.auth.googleButton })).toHaveAttribute(
      'aria-disabled',
      'true',
    );

    await user.click(screen.getByRole('checkbox'));
    expect(screen.getByRole('link', { name: messages.auth.googleButton })).not.toHaveAttribute(
      'aria-disabled',
    );
  });

  it('links both policies from the consent line', () => {
    renderWithIntl(<RegisterPage />);

    expect(screen.getByRole('link', { name: 'Privacy Notice' })).toHaveAttribute('href', '/privacy');
    expect(screen.getByRole('link', { name: 'Terms of Service' })).toHaveAttribute('href', '/terms');
  });
});
