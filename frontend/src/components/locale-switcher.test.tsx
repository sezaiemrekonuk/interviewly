import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, describe, expect, it, vi } from 'vitest';

import trMessages from '../../messages/tr.json';
import { formCalls, stubFetch } from '../test/fetch';
import { messages, renderWithProviders } from '../test/render';

const nav = vi.hoisted(() => ({ push: vi.fn(), pathname: '/settings', search: '' }));

vi.mock('next/navigation', async () => ({
  ...(await import('@/test/navigation')).serverNavigation,
  useRouter: () => ({ push: nav.push, replace: vi.fn(), prefetch: vi.fn(), refresh: vi.fn() }),
  usePathname: () => nav.pathname,
  useSearchParams: () => new URLSearchParams(nav.search),
}));

import { LocaleSwitcher } from './locale-switcher';

const clickTurkish = () =>
  userEvent.setup().click(screen.getByRole('button', { name: messages.common.localeTurkish }));

describe('LocaleSwitcher', () => {
  afterEach(() => {
    nav.push.mockReset();
    nav.pathname = '/settings';
    nav.search = '';
    vi.unstubAllGlobals();
    document.cookie = 'NEXT_LOCALE=; path=/; max-age=0';
  });

  // The labels are endonyms in both message files, so one button is always foreign to the
  // page's `<html lang>` — whichever page it is. Each must name its own language for the
  // screen reader (issue 137), so both directions are checked.
  it.each(['en', 'tr'] as const)('marks each button with its own language on a %s page', (page) => {
    const pageMessages = page === 'en' ? messages : trMessages;
    render(
      <NextIntlClientProvider locale={page} messages={pageMessages}>
        <QueryClientProvider
          client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
        >
          <LocaleSwitcher />
        </QueryClientProvider>
      </NextIntlClientProvider>,
    );

    expect(
      screen.getByRole('button', { name: pageMessages.common.localeEnglish }),
    ).toHaveAttribute('lang', 'en');
    expect(
      screen.getByRole('button', { name: pageMessages.common.localeTurkish }),
    ).toHaveAttribute('lang', 'tr');
  });

  // The point of issue 91: the language is the URL, so switching it has to move the visitor to
  // the other language's address. A refresh in place — what this did before — left the page
  // unlinkable and unindexable in Turkish.
  it('navigates to the Turkish address of the page being read', async () => {
    stubFetch(200, { locale: 'tr' });
    renderWithProviders(<LocaleSwitcher />);

    await clickTurkish();

    // `push`, not `replace`: Back must return to the language they came from.
    expect(nav.push).toHaveBeenCalledWith('/tr/settings');
  });

  it('carries the query string across, because it is part of what is being read', async () => {
    stubFetch(200, { locale: 'tr' });
    nav.pathname = '/interviews';
    nav.search = 'status=completed';
    renderWithProviders(<LocaleSwitcher />);

    await clickTurkish();

    expect(nav.push).toHaveBeenCalledWith('/tr/interviews?status=completed');
  });

  it('persists the choice on the account (issue 76)', async () => {
    const fetchSpy = stubFetch(200, { locale: 'tr' });
    renderWithProviders(<LocaleSwitcher />);

    await clickTurkish();

    await waitFor(() => expect(formCalls(fetchSpy)).toHaveLength(1));
    const [url, init] = formCalls(fetchSpy)[0];
    expect(url).toBe('/api/me/locale');
    expect(init?.method).toBe('PATCH');
    expect(JSON.parse(init?.body as string)).toEqual({ locale: 'tr' });
  });

  // The switcher renders for visitors with no session too. A 401 there means "no row to
  // write", so the navigation — the half that actually changes what they are reading — must
  // still happen, and nothing may be surfaced to them.
  it('still switches for an anonymous visitor and surfaces no error', async () => {
    stubFetch(401, { error: { code: 'UNAUTHENTICATED' } });
    renderWithProviders(<LocaleSwitcher />);

    await clickTurkish();

    expect(nav.push).toHaveBeenCalledWith('/tr/settings');
    await waitFor(() => expect(screen.queryByRole('alert')).toBeNull());
  });
});
