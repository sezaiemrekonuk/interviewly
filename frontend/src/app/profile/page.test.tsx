import { act, screen, waitFor, within, type RenderResult } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { messages, renderWithProviders } from '../../test/render';

// One object, not a fresh one per call: `useRequireAuth` keys its effect on the router
// identity, and a new object every render refetches `/me` forever.
const nav = vi.hoisted(() => ({
  push: vi.fn(),
  replace: vi.fn(),
  prefetch: vi.fn(),
  refresh: vi.fn(),
}));

vi.mock('next/navigation', () => ({
  useRouter: () => nav,
  usePathname: () => '/profile',
}));

import ProfilePage from './page';

const USER = {
  id: 'u1',
  email: 'ada@example.com',
  role: 'user',
  locale: 'en',
  emailVerifiedAt: '2026-08-01T09:00:00.000Z',
  onboardingCompletedAt: '2026-08-01T09:00:00.000Z',
  interviewCount: 1,
};

const STORED = {
  fullName: 'Ada Lovelace',
  jobTitle: 'Analyst',
  education: [
    { school: 'Cambridge', degree: 'BSc', field: 'Mathematics', startYear: 2015, endYear: 2018 },
  ],
  interestsText: 'Analytical engines',
};

interface Call {
  url: string;
  method: string;
  body: unknown;
}

/**
 * Routes by path: `/me` (the auth gate) and `/me/profile` (the cards), plus the PATCH each
 * tab's Save fires. The stored profile is *server state* here — a PATCH merges into it and
 * the next GET answers the merged copy, which is what lets a test prove a value survives
 * the reload rather than just the render that typed it.
 */
function stubFetch(options: { profile?: Record<string, unknown>; patchStatus?: number } = {}) {
  const calls: Call[] = [];
  let stored: Record<string, unknown> = { ...(options.profile ?? STORED) };

  const spy = vi.fn(async (url: string, init?: RequestInit) => {
    const method = init?.method ?? 'GET';
    const raw = init?.body;
    const body = raw && typeof raw === 'string' ? JSON.parse(raw) : null;
    calls.push({ url, method, body });

    const json = (status: number, payload: unknown) =>
      new Response(JSON.stringify(payload), {
        status,
        headers: { 'content-type': 'application/json' },
      });

    if (url === '/api/me') return json(200, { user: USER });

    if (url === '/api/me' && method === 'DELETE') return new Response(null, { status: 204 });

    if (url === '/api/me/profile' && method === 'PATCH') {
      const status = options.patchStatus ?? 200;
      if (status !== 200) return json(status, { error: { code: 'RATE_LIMITED' } });
      // The server's merge, in miniature: the card's fields land on top of what is stored,
      // and nothing else moves.
      stored = { ...stored, ...(body as { fields: Record<string, unknown> }).fields };
      return json(200, { profile: stored });
    }

    if (url === '/api/me/profile') {
      return json(200, { profile: stored, onboardingCompletedAt: 'now', cvUploadId: null, cv: null });
    }

    return json(404, { error: { code: 'NOT_FOUND' } });
  });

  vi.stubGlobal('fetch', spy);
  return { calls, stored: () => stored };
}

async function renderPage(): Promise<RenderResult> {
  let result!: RenderResult;
  await act(async () => {
    result = renderWithProviders(<ProfilePage />);
  });
  return result;
}

describe('/profile — what the interviewer knows about you', () => {
  beforeEach(() => {
    nav.push.mockReset();
    nav.replace.mockReset();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('sends an anonymous visitor to sign-in, keeping where they were headed', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        new Response(JSON.stringify({ error: { code: 'UNAUTHENTICATED' } }), {
          status: 401,
          headers: { 'content-type': 'application/json' },
        }),
      ),
    );

    await renderPage();

    await waitFor(() =>
      expect(nav.replace).toHaveBeenCalledWith('/sign-in?returnPath=%2Fprofile'),
    );
  });

  // Four tabs replaced by four sections: the whole answer to "what have I filled in" is on
  // screen at once instead of two thirds of it being one arrow key away.
  it('shows every section at once, each naming what it changes', async () => {
    stubFetch();
    await renderPage();

    for (const section of ['identity', 'cv', 'education', 'interests'] as const) {
      expect(
        await screen.findByRole('heading', { name: messages.profile[section].title }),
      ).toBeInTheDocument();
      expect(screen.getByText(messages.profile[section].effect)).toBeInTheDocument();
    }
    expect(screen.queryByRole('tablist')).toBeNull();
  });

  it('renders the stored values without needing a tab opened first', async () => {
    stubFetch();
    await renderPage();

    expect(await screen.findByDisplayValue('Ada Lovelace')).toBeInTheDocument();
    expect(screen.getByDisplayValue('Analyst')).toBeInTheDocument();
    expect(screen.getByText('Cambridge')).toBeInTheDocument();
    expect(screen.getByDisplayValue('Analytical engines')).toBeInTheDocument();
  });

  it('saves the identity card and reports the outcome', async () => {
    const { calls } = stubFetch();
    await renderPage();

    const jobTitle = await screen.findByDisplayValue('Analyst');
    await act(async () => {
      await userEvent.clear(jobTitle);
      await userEvent.type(jobTitle, 'Data lead');
    });

    const saves = screen.getAllByRole('button', { name: messages.profile.save });
    await act(async () => {
      await userEvent.click(saves[0]);
    });

    await waitFor(() =>
      expect(
        calls.some(
          (c) =>
            c.method === 'PATCH' &&
            (c.body as { step: number; fields: { jobTitle: string } }).step === 1 &&
            (c.body as { fields: { jobTitle: string } }).fields.jobTitle === 'Data lead',
        ),
      ).toBe(true),
    );
    expect(await screen.findByText(messages.profile.saved)).toBeInTheDocument();
  });

  // The complaint that started this: erasure rendered outside the tabpanel, so it was on all
  // four cards at once, at the foot of a screen about CVs and hobbies.
  it('offers no account erasure anywhere on the profile', async () => {
    stubFetch();
    await renderPage();

    await screen.findByDisplayValue('Ada Lovelace');
    expect(screen.queryByTestId('delete-account')).toBeNull();
  });

  // Account state belongs with the account. Verification used to sit in the dark nav rail on
  // a different material, forty pixels from the address it describes; both are on /settings
  // now, on one row. The rail still names who is signed in — that is wayfinding, not a field.
  it('carries no verification state on the working surface', async () => {
    stubFetch();
    await renderPage();

    await screen.findByDisplayValue('Ada Lovelace');
    const work = screen.getByRole('main');
    expect(within(work).queryByText('ada@example.com')).toBeNull();
    expect(screen.queryByRole('link', { name: /verify/i })).toBeNull();
  });

  // The old meter ran on hardcoded weights and printed a percentage — editorial opinion in the
  // costume of a measurement. A count is a fact; the ranking is a sentence we can defend.
  it('counts the filled inputs instead of inventing a percentage', async () => {
    // Name, role, education and interests are stored; the CV is not.
    stubFetch();
    await renderPage();

    expect(await screen.findByText('4 of 5 inputs filled in.')).toBeInTheDocument();
    expect(screen.getByText(/CV changes the questions more/)).toBeInTheDocument();
    expect(screen.queryByText(/%/)).toBeNull();
    // No bar either — the widest orange element in the product was this progress track.
    expect(screen.queryByRole('progressbar', { hidden: true })).toBeNull();
  });

  it('reaches settings and sign-out from the rail', async () => {
    stubFetch();
    await renderPage();

    expect(await screen.findByRole('link', { name: messages.nav.settings })).toHaveAttribute(
      'href',
      '/settings',
    );
    expect(screen.getByRole('button', { name: messages.nav.signOut })).toBeInTheDocument();
  });
});
