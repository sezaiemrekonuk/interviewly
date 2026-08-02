import { screen } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { messages, renderWithIntl } from '../../../../test/render';

vi.mock('next/navigation', () => ({
  useParams: () => ({ token: 'a-token-from-the-mail' }),
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), prefetch: vi.fn(), refresh: vi.fn() }),
  usePathname: () => '/verify-email/a-token-from-the-mail',
}));

import ConfirmVerificationPage from './page';

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

describe('verify-email confirm page', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('confirms on mount and posts the token from the route', async () => {
    const fetchSpy = stubFetch(200, { user: { id: 'u1', emailVerifiedAt: '2026-07-31T10:00:00Z' } });
    renderWithIntl(<ConfirmVerificationPage />);

    expect(await screen.findByText(messages.auth.verifyConfirmedTitle)).toBeInTheDocument();
    expect(fetchSpy).toHaveBeenCalledWith(
      '/api/auth/verify-email/confirm',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ token: 'a-token-from-the-mail' }),
      }),
    );
  });

  it('confirms exactly once, so a re-render cannot spend the token on itself', async () => {
    const fetchSpy = stubFetch(200, { user: { id: 'u1' } });
    const { rerender } = renderWithIntl(<ConfirmVerificationPage />);

    await screen.findByText(messages.auth.verifyConfirmedTitle);
    // `rerender` replaces the whole tree, so the provider has to come with it — otherwise
    // the second render fails on a missing intl context instead of testing the guard.
    rerender(
      <NextIntlClientProvider locale="en" messages={messages}>
        <ConfirmVerificationPage />
      </NextIntlClientProvider>,
    );

    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it('distinguishes an expired link from an unknown one', async () => {
    stubFetch(400, { error: { code: 'EMAIL_TOKEN_EXPIRED' } });
    renderWithIntl(<ConfirmVerificationPage />);

    expect(await screen.findByText(messages.errors.EMAIL_TOKEN_EXPIRED)).toBeInTheDocument();
    expect(screen.getByText(messages.auth.verifyFailedTitle)).toBeInTheDocument();
  });
});
