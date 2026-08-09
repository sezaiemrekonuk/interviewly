import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { messages, renderWithProviders } from '../../test/render';
import type { SessionUser } from '../../lib/use-require-auth';

const nav = vi.hoisted(() => ({ pathname: '/dashboard' }));
// One stable object, as Next's own `useRouter()` returns — a fresh one per call re-fires
// `useRequireAuth`'s effect on every commit, which is a timeout, not a test.
const router = { replace: vi.fn(), push: vi.fn(), prefetch: vi.fn(), refresh: vi.fn() };
vi.mock('next/navigation', async () => ({
  ...(await import('@/test/navigation')).serverNavigation,
  useRouter: () => router,
  usePathname: () => nav.pathname,
}));

import { AppRail } from './app-rail';

// `nav.account` / `nav.accountCurrent` are new and arrive with the i18n merge; read through a
// widened type so a missing key is a failing assertion here rather than a type error in tsc.
const copy = messages.nav as unknown as Record<string, string>;

const USER: SessionUser = {
  id: 'u1',
  email: 'admin@demo.com',
  role: 'admin',
  locale: 'en',
  emailVerifiedAt: 'now',
  onboardingCompletedAt: 'now',
  interviewCount: 3,
};

function railFor(pathname: string, user: SessionUser = USER) {
  nav.pathname = pathname;
  const { container } = renderWithProviders(<AppRail user={user} />);
  const details = container.querySelector('details');
  expect(details).not.toBeNull();
  return { details: details!, summary: container.querySelector('summary')! };
}

/**
 * The defect these cover: at 390×844 the rail wrapped into three stacked rows — wordmark,
 * three nav items, then monogram + address + Profile + Settings + Admin + Sign out — and ate
 * a fifth of the viewport on every signed-in screen before any content. Eight permanently
 * visible destinations is not what "the rail is the navigation" means on a phone.
 *
 * jsdom applies no CSS-module rules, so the 60rem branch is invisible here and the panel's
 * contents are always findable. What is testable — and what a regression would break first —
 * is the structure the branch depends on: everything the account owns inside one disclosure,
 * the toggle named, and the current page still announced when the item carrying it is shut.
 */
describe('AppRail', () => {
  beforeEach(() => {
    nav.pathname = '/dashboard';
  });

  it('keeps the three primary items out of the disclosure and the account inside it', () => {
    const { details } = railFor('/dashboard');

    for (const key of ['today', 'interviews', 'new'] as const) {
      const item = screen.getByRole('link', { name: messages.nav[key] });
      expect(details.contains(item)).toBe(false);
    }
    for (const key of ['profile', 'settings', 'admin'] as const) {
      const item = screen.getByRole('link', { name: messages.nav[key] });
      expect(details.contains(item)).toBe(true);
    }
    expect(details.contains(screen.getByRole('button', { name: messages.nav.signOut }))).toBe(true);
    // On a shared handset "which account am I in" is the first thing the menu has to answer —
    // the local part of the address, since this fixture has no `fullName` (§3.3 card 1). It
    // now appears twice: on the always-visible trigger, and again inside the open panel.
    for (const node of screen.getAllByText('admin')) {
      expect(details.contains(node)).toBe(true);
    }
  });

  it('shows the full name instead of the address when card 1 has one', () => {
    const { details } = railFor('/dashboard', { ...USER, fullName: 'Ada Lovelace' });

    for (const node of screen.getAllByText('Ada Lovelace')) {
      expect(details.contains(node)).toBe(true);
    }
    expect(screen.queryByText('admin')).toBeNull();
  });

  it('starts closed and opens from the monogram alone, with no script of ours', async () => {
    const { details, summary } = railFor('/dashboard');

    expect(details.open).toBe(false);
    await userEvent.click(summary);
    expect(details.open).toBe(true);
    await userEvent.click(summary);
    expect(details.open).toBe(false);
  });

  it('closes on a click outside the panel', async () => {
    const { details, summary } = railFor('/dashboard');

    await userEvent.click(summary);
    expect(details.open).toBe(true);

    await userEvent.click(document.body);
    expect(details.open).toBe(false);
  });

  it('stays open for a click inside the panel, on a nav link', async () => {
    const { details, summary } = railFor('/dashboard');

    await userEvent.click(summary);
    // A real click on the link navigates (jsdom doesn't follow it), which is enough to prove
    // the outside-click handler didn't fire first and close the panel out from under it.
    await userEvent.click(screen.getByRole('link', { name: messages.nav.profile }));
    expect(details.open).toBe(true);
  });

  it('names the disclosure, since the monogram inside it is decorative', () => {
    const { summary } = railFor('/dashboard');

    expect(copy.account).toBeDefined();
    expect(summary).toHaveAttribute('aria-label', copy.account);
    expect(summary.querySelector('[aria-hidden="true"]')?.textContent).toBe('A');
  });

  it('names the current section on the monogram when the disclosure hides it', () => {
    const { summary } = railFor('/settings');

    // `aria-current="page"` on a link behind a closed disclosure announces nothing, so the
    // toggle carries the fact instead — and the link keeps it for when the panel is open.
    expect(copy.accountCurrent).toBeDefined();
    expect(summary.getAttribute('aria-label')).toContain(messages.nav.settings);
    expect(summary.getAttribute('aria-label')).not.toBe(copy.account);
    expect(screen.getByRole('link', { name: messages.nav.settings })).toHaveAttribute(
      'aria-current',
      'page',
    );
  });

  it('leaves the monogram unlabelled by a section on a surface the account does not own', () => {
    const { summary } = railFor('/interviews');

    expect(copy.account).toBeDefined();
    expect(summary).toHaveAttribute('aria-label', copy.account);
    expect(screen.getByRole('link', { name: messages.nav.interviews })).toHaveAttribute(
      'aria-current',
      'page',
    );
  });

  it('keeps the admin console out of a candidate’s disclosure', () => {
    railFor('/dashboard', { ...USER, role: 'user' });

    expect(screen.queryByRole('link', { name: messages.nav.admin })).toBeNull();
  });
});
