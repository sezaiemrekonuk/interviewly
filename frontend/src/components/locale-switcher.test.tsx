import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, describe, expect, it, vi } from 'vitest';

import trMessages from '../../messages/tr.json';
import { formCalls, stubFetch } from '../test/fetch';
import { messages, renderWithProviders } from '../test/render';

const nav = vi.hoisted(() => ({ refresh: vi.fn() }));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), prefetch: vi.fn(), refresh: nav.refresh }),
}));

import { LocaleSwitcher } from './locale-switcher';

const clickTurkish = () =>
  userEvent.setup().click(screen.getByRole('button', { name: messages.common.localeTurkish }));

describe('LocaleSwitcher', () => {
  afterEach(() => {
    nav.refresh.mockReset();
    vi.unstubAllGlobals();
    document.cookie = 'NEXT_LOCALE=; path=/; max-age=0';
  });

  // The labels are endonyms in both message files, so one button is always foreign to the
  // page's `<html lang>` — whichever page it is. Each must name its own language for the
  // screen reader (issue 137), so both directions are checked.
  it.each(['en', 'tr'] as const)('marks each button with its own language on a %s page', (page) => {
    render(
      <NextIntlClientProvider locale={page} messages={page === 'en' ? messages : trMessages}>
        <QueryClientProvider client={new QueryClient()}>
          <LocaleSwitcher />
        </QueryClientProvider>
      </NextIntlClientProvider>,
    );

    expect(screen.getByRole('button', { name: messages.common.localeEnglish })).toHaveAttribute(
      'lang',
      'en',
    );
    expect(screen.getByRole('button', { name: messages.common.localeTurkish })).toHaveAttribute(
      'lang',
      'tr',
    );
  });

  it('writes the cookie and persists the choice on the account (issue 76)', async () => {
    const fetchSpy = stubFetch(200, { locale: 'tr' });
    renderWithProviders(<LocaleSwitcher />);

    await clickTurkish();

    expect(document.cookie).toContain('NEXT_LOCALE=tr');
    await waitFor(() => expect(formCalls(fetchSpy)).toHaveLength(1));
    const [url, init] = formCalls(fetchSpy)[0];
    expect(url).toBe('/api/me/locale');
    expect(init?.method).toBe('PATCH');
    expect(JSON.parse(init?.body as string)).toEqual({ locale: 'tr' });
  });

  // The switcher renders for visitors with no session too. A 401 there means "no row to
  // write", so the cookie half — the half that actually changes what they are reading —
  // must still land, and nothing may be surfaced to them.
  it('still switches for an anonymous visitor and surfaces no error', async () => {
    stubFetch(401, { error: { code: 'UNAUTHENTICATED' } });
    renderWithProviders(<LocaleSwitcher />);

    await clickTurkish();

    expect(document.cookie).toContain('NEXT_LOCALE=tr');
    expect(nav.refresh).toHaveBeenCalled();
    await waitFor(() => expect(screen.queryByRole('alert')).toBeNull());
  });
});
