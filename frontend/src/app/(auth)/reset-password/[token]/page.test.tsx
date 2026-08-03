import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { messages, renderWithIntl } from '../../../../test/render';

vi.mock('next/navigation', () => ({
  useParams: () => ({ token: 'a-token-from-the-mail' }),
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), prefetch: vi.fn(), refresh: vi.fn() }),
  usePathname: () => '/reset-password/a-token-from-the-mail',
}));

import ResetPasswordPage from './page';

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

async function submit(password: string, confirmation = password) {
  const user = userEvent.setup();
  await user.type(screen.getByLabelText(messages.auth.newPasswordLabel), password);
  await user.type(screen.getByLabelText(messages.auth.confirmPasswordLabel), confirmation);
  await user.click(screen.getByRole('button', { name: messages.auth.resetSubmit }));
}

describe('reset-password page', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('posts the route token with the new password and says the session is gone', async () => {
    const fetchSpy = stubFetch(200, {});
    renderWithIntl(<ResetPasswordPage />);

    await submit('a-long-enough-password');

    expect(await screen.findByText(messages.auth.resetDoneBody)).toBeInTheDocument();
    expect(fetchSpy).toHaveBeenCalledWith(
      '/api/auth/password-reset/confirm',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ token: 'a-token-from-the-mail', password: 'a-long-enough-password' }),
      }),
    );
  });

  // Mismatch is the one rule the API has no code for, so it is checked here or nowhere.
  it('refuses a mismatched confirmation without spending the token', async () => {
    const fetchSpy = stubFetch(200, {});
    renderWithIntl(<ResetPasswordPage />);

    await submit('a-long-enough-password', 'a-different-password');

    await waitFor(() =>
      expect(screen.getByText(messages.auth.passwordsMismatch)).toBeInTheDocument(),
    );
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('applies the server length rule locally and does not call the API', async () => {
    const fetchSpy = stubFetch(200, {});
    renderWithIntl(<ResetPasswordPage />);

    await submit('123456789');

    await waitFor(() =>
      expect(screen.getByText(messages.errors.PASSWORD_TOO_SHORT)).toBeInTheDocument(),
    );
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('renders an expired link from the registry', async () => {
    stubFetch(400, { error: { code: 'EMAIL_TOKEN_EXPIRED' } });
    renderWithIntl(<ResetPasswordPage />);

    await submit('a-long-enough-password');

    expect(await screen.findByRole('alert')).toHaveTextContent(messages.errors.EMAIL_TOKEN_EXPIRED);
  });
});
