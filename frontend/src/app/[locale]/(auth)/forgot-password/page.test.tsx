import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { messages, renderWithIntl } from '../../../../test/render';

import ForgotPasswordPage from './page';

// The endpoint answers 202 with no body at all, which is what the screen has to cope with:
// `apiPost` parses the body and gets nothing.
function stubFetch(status: number, body?: unknown) {
  const spy = vi.fn(async () =>
    body === undefined
      ? new Response(null, { status })
      : new Response(JSON.stringify(body), {
          status,
          headers: { 'content-type': 'application/json' },
        }),
  );
  vi.stubGlobal('fetch', spy);
  return spy;
}

async function submit(email: string) {
  const user = userEvent.setup();
  await user.type(screen.getByLabelText(messages.auth.emailLabel), email);
  await user.click(screen.getByRole('button', { name: messages.auth.sendResetLink }));
}

describe('forgot-password page', () => {
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
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
