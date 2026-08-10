import { act, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { messages, renderWithProviders } from '../../../test/render';

// One object, not a fresh one per call: `useRequireAuth` keys its effect on the router
// identity, and a new object every render refetches `/me` forever.
const nav = vi.hoisted(() => ({
  push: vi.fn(),
  replace: vi.fn(),
  prefetch: vi.fn(),
  refresh: vi.fn(),
}));

vi.mock('next/navigation', async () => ({
  ...(await import('@/test/navigation')).serverNavigation,
  useRouter: () => nav,
  usePathname: () => '/settings',
  useSearchParams: () => new URLSearchParams(''),
}));

import SettingsPage from './page';

const USER = {
  id: 'u1',
  email: 'ada@example.com',
  role: 'user',
  locale: 'en',
  emailVerifiedAt: '2026-08-01T09:00:00.000Z',
  onboardingCompletedAt: 'now',
  interviewCount: 1,
};

interface Call {
  url: string;
  method: string;
}

function stub(user: Record<string, unknown> = USER) {
  const calls: Call[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      calls.push({ url, method: init?.method ?? 'GET' });
      if (url === '/api/me' && (init?.method ?? 'GET') === 'DELETE')
        return new Response(null, { status: 204 });
      if (url === '/api/me')
        return new Response(JSON.stringify({ user }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      return new Response(JSON.stringify({}), {
        status: 202,
        headers: { 'content-type': 'application/json' },
      });
    }),
  );
  return calls;
}

async function renderPage() {
  await act(async () => {
    renderWithProviders(<SettingsPage />);
  });
}

const s = messages.settings;

describe('/settings — the account surface the product did not have', () => {
  afterEach(() => vi.unstubAllGlobals());

  // The defect the owner named: the address was on a profile form tab while its verification
  // state was in the dark nav rail, on a different material.
  it('shows the address and its verification state on the same row', async () => {
    stub();
    await renderPage();

    // Scoped to the working surface: the rail also names who is signed in.
    const work = await screen.findByRole('main');
    const row = within(work).getByText('ada@example.com').closest('div');
    expect(row).not.toBeNull();
    expect(within(row as HTMLElement).getByText(s.account.verified)).toBeInTheDocument();
  });

  it('offers the verify link only while the address is unverified', async () => {
    stub({ ...USER, emailVerifiedAt: null });
    await renderPage();

    expect(await screen.findByText(s.account.unverified)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: s.account.verify })).toHaveAttribute(
      'href',
      '/verify-email',
    );
  });

  it('changes a password through the reset flow, which is the endpoint that exists', async () => {
    const calls = stub();
    await renderPage();

    await act(async () => {
      await userEvent.click(
        await screen.findByRole('button', { name: s.account.passwordAction }),
      );
    });

    await waitFor(() =>
      expect(
        calls.some((c) => c.method === 'POST' && c.url === '/api/auth/password-reset/request'),
      ).toBe(true),
    );
    expect(await screen.findByText(s.account.passwordSent)).toBeInTheDocument();
  });

  // Erasure is guarded by typing the address rather than by a second click: two clicks are
  // muscle memory, an address has to be read off the row above before it can be typed.
  it('refuses to erase until the address is typed back', async () => {
    const calls = stub();
    await renderPage();

    const erase = await screen.findByRole('button', { name: s.erase.action });
    expect(erase).toBeDisabled();

    await act(async () => {
      await userEvent.type(screen.getByLabelText(s.erase.confirmLabel), 'wrong@example.com');
    });
    expect(erase).toBeDisabled();
    expect(calls.every((c) => c.method !== 'DELETE')).toBe(true);
  });

  it('erases once the address matches, ignoring case and surrounding space', async () => {
    const calls = stub();
    await renderPage();

    await act(async () => {
      await userEvent.type(
        await screen.findByLabelText(s.erase.confirmLabel),
        '  Ada@Example.com  ',
      );
    });

    const erase = screen.getByRole('button', { name: s.erase.action });
    expect(erase).toBeEnabled();

    await act(async () => {
      await userEvent.click(erase);
    });

    await waitFor(() =>
      expect(calls.some((c) => c.method === 'DELETE' && c.url === '/api/me')).toBe(true),
    );
  });

  it('reaches the privacy notice, which the signed-in app could not link to before', async () => {
    stub();
    await renderPage();

    expect(await screen.findByRole('link', { name: s.privacy.notice })).toHaveAttribute(
      'href',
      '/privacy',
    );
    expect(screen.getByRole('link', { name: s.privacy.terms })).toHaveAttribute('href', '/terms');
  });

  it('carries the language switcher, which lived in a header two routes rendered', async () => {
    stub();
    await renderPage();

    expect(
      await screen.findByRole('button', { name: messages.common.localeTurkish }),
    ).toBeInTheDocument();
  });
});
