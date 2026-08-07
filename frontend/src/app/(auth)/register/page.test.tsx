import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { formCalls, stubFetch } from '../../../test/fetch';
import { messages, renderWithProviders } from '../../../test/render';

const nav = vi.hoisted(() => ({ push: vi.fn(), replace: vi.fn(), search: '' }));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: nav.push, replace: nav.replace, prefetch: vi.fn(), refresh: vi.fn() }),
  useSearchParams: () => new URLSearchParams(nav.search),
  usePathname: () => '/register',
}));

import RegisterPage from './page';

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
    renderWithProviders(<RegisterPage />);

    await fillAndSubmit('someone@example.com', 'short');

    expect(await screen.findByText(messages.errors.PASSWORD_TOO_SHORT)).toBeInTheDocument();
    expect(formCalls(fetchSpy)).toEqual([]);
  });

  // A06 (K8.7): a brand-new account has never completed onboarding, so registration always
  // lands there — the landing surface is unreachable from here by construction.
  it('sends the credentials to the register endpoint and lands on onboarding', async () => {
    const fetchSpy = stubFetch(201, {
      user: { id: 'u1', email: 'someone@example.com', onboardingCompletedAt: null, interviewCount: 0 },
    });
    renderWithProviders(<RegisterPage />);

    await fillAndSubmit('someone@example.com', 'correct-horse');

    await waitFor(() => expect(nav.replace).toHaveBeenCalledWith('/onboarding/1'));

    const [url, init] = formCalls(fetchSpy)[0];
    expect(url).toBe('/api/auth/register');
    expect(init?.method).toBe('POST');
    // `locale` is the form's own language (issue 76) — the verification mail is queued inside
    // this request, so the choice has to travel with it rather than wait for the switcher.
    expect(JSON.parse(init?.body as string)).toEqual({
      email: 'someone@example.com',
      password: 'correct-horse',
      consent: true,
      locale: 'en',
    });
  });

  it('renders EMAIL_TAKEN from the error code, never the raw code', async () => {
    stubFetch(409, { error: { code: 'EMAIL_TAKEN' } });
    renderWithProviders(<RegisterPage />);

    await fillAndSubmit('taken@example.com', 'correct-horse');

    expect(await screen.findByText(messages.errors.EMAIL_TAKEN)).toBeInTheDocument();
    expect(screen.queryByText(/EMAIL_TAKEN/)).toBeNull();
    expect(nav.replace).not.toHaveBeenCalled();
  });

  it('falls back to UNKNOWN for a code that is not in the registry', async () => {
    stubFetch(500, { error: { code: 'SOMETHING_NEW' } });
    renderWithProviders(<RegisterPage />);

    await fillAndSubmit('someone@example.com', 'correct-horse');

    expect(await screen.findByText(messages.errors.UNKNOWN)).toBeInTheDocument();
    expect(screen.queryByText(/SOMETHING_NEW/)).toBeNull();
  });

  it('points the Google button at the API redirect chain rather than fetching it', async () => {
    const user = userEvent.setup();
    stubFetch(201, {});
    renderWithProviders(<RegisterPage />);

    await user.click(screen.getByRole('checkbox'));

    const google = await screen.findByRole('link', { name: messages.auth.googleButton });
    expect(google).toHaveAttribute('href', '/api/auth/google');
    expect(google).not.toHaveAttribute('aria-disabled');
  });

  // Issue 60: the anchor is a real navigation, so an unconfigured deployment would answer it
  // by replacing the whole app with `{"error":{"code":"NOT_READY"}}`. The screen must not
  // offer the control at all in that case — and ticking consent must not bring it back, the
  // two gates being independent.
  it('omits the Google button entirely when the API reports the flow unavailable', async () => {
    const user = userEvent.setup();
    stubFetch(201, {}, false);
    renderWithProviders(<RegisterPage />);

    await user.click(screen.getByRole('checkbox'));

    // `findByRole` rather than `queryByRole`: the button is absent on the first render
    // whatever the answer turns out to be, so only a query that keeps looking until it times
    // out can tell "never appears" from "has not appeared yet".
    await expect(
      screen.findByRole('link', { name: messages.auth.googleButton }),
    ).rejects.toThrow();
  });

  // --------------------------------------------------------------- consent (issue 009)

  it('refuses to submit until the policies are accepted, and calls nothing', async () => {
    const fetchSpy = stubFetch(201, {});
    renderWithProviders(<RegisterPage />);

    await fillAndSubmit('someone@example.com', 'correct-horse', false);

    expect(await screen.findByText(messages.errors.CONSENT_REQUIRED)).toBeInTheDocument();
    expect(formCalls(fetchSpy)).toEqual([]);
    expect(nav.replace).not.toHaveBeenCalled();
  });

  // The Google redirect creates an account too, so it cannot sit outside the consent gate.
  it('holds the Google route shut until the box is ticked', async () => {
    const user = userEvent.setup();
    stubFetch(201, {});
    renderWithProviders(<RegisterPage />);

    expect(await screen.findByRole('link', { name: messages.auth.googleButton })).toHaveAttribute(
      'aria-disabled',
      'true',
    );

    await user.click(screen.getByRole('checkbox'));
    expect(screen.getByRole('link', { name: messages.auth.googleButton })).not.toHaveAttribute(
      'aria-disabled',
    );
  });

  it('links both policies from the consent line', () => {
    stubFetch(201, {});
    renderWithProviders(<RegisterPage />);

    expect(screen.getByRole('link', { name: 'Privacy Notice' })).toHaveAttribute('href', '/privacy');
    expect(screen.getByRole('link', { name: 'Terms of Service' })).toHaveAttribute('href', '/terms');
  });
});
