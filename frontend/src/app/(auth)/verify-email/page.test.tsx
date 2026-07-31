import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { messages, renderWithIntl } from '../../../test/render';

const nav = vi.hoisted(() => ({ push: vi.fn(), replace: vi.fn() }));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: nav.push, replace: nav.replace, prefetch: vi.fn(), refresh: vi.fn() }),
  useSearchParams: () => new URLSearchParams(''),
  usePathname: () => '/verify-email',
}));

import VerifyEmailPage from './page';

const UNVERIFIED = {
  user: { id: 'u1', email: 'someone@example.com', role: 'user', locale: 'en', emailVerifiedAt: null },
};

/**
 * Routes `/me` and the resend endpoint separately: every render of this page starts with
 * the session probe, so a single-answer stub would feed the probe's payload to the resend
 * assertion and vice versa.
 */
function stubApi(resend: { status: number; body: unknown }, me: unknown = UNVERIFIED) {
  const spy = vi.fn(async (url: string) => {
    const isResend = url.includes('/auth/verify-email/request');
    const status = isResend ? resend.status : 200;
    const body = isResend ? resend.body : me;
    return new Response(JSON.stringify(body), {
      status,
      headers: { 'content-type': 'application/json' },
    });
  });
  vi.stubGlobal('fetch', spy);
  return spy;
}

describe('verify-email pending page', () => {
  beforeEach(() => {
    nav.replace.mockReset();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('resends the mail and then counts the cooldown down from the server value', async () => {
    const fetchSpy = stubApi({ status: 202, body: { cooldownSeconds: 60 } });
    renderWithIntl(<VerifyEmailPage />);

    const button = await screen.findByRole('button', { name: messages.auth.resend });
    await userEvent.click(button);

    expect(await screen.findByText(messages.auth.resendSent)).toBeInTheDocument();
    expect(fetchSpy).toHaveBeenCalledWith(
      '/api/auth/verify-email/request',
      expect.objectContaining({ method: 'POST' }),
    );
    // The label carries the server's number, and the button is closed for the duration.
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /60/ })).toBeDisabled();
    });
  });

  it('shows the cooldown refusal with the seconds the server still wants', async () => {
    stubApi({
      status: 429,
      body: { error: { code: 'EMAIL_RESEND_COOLDOWN' }, cooldownSeconds: 42 },
    });
    renderWithIntl(<VerifyEmailPage />);

    await userEvent.click(await screen.findByRole('button', { name: messages.auth.resend }));

    expect(
      await screen.findByText(messages.errors.EMAIL_RESEND_COOLDOWN),
    ).toBeInTheDocument();
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /42/ })).toBeDisabled();
    });
  });

  it('offers continuing without verifying, because the gate is one endpoint away', async () => {
    stubApi({ status: 202, body: { cooldownSeconds: 60 } });
    renderWithIntl(<VerifyEmailPage />);

    const link = await screen.findByRole('link', {
      name: messages.auth.continueWithoutVerifying,
    });
    expect(link).toHaveAttribute('href', '/dashboard');
  });

  it('says nothing is pending when the account is already verified', async () => {
    stubApi(
      { status: 202, body: { cooldownSeconds: 60 } },
      { user: { ...UNVERIFIED.user, emailVerifiedAt: '2026-07-31T10:00:00.000Z' } },
    );
    renderWithIntl(<VerifyEmailPage />);

    expect(await screen.findByText(messages.auth.verifyConfirmedTitle)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: messages.auth.resend })).not.toBeInTheDocument();
  });
});
