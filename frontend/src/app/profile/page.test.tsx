import { act, screen, waitFor, type RenderResult } from '@testing-library/react';
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

describe('profile page', () => {
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

  it('renders the stored values of every card', async () => {
    stubFetch();
    await renderPage();

    const user = userEvent.setup();

    expect(await screen.findByLabelText(messages.fields.fullNameLabel)).toHaveValue(
      'Ada Lovelace',
    );
    expect(screen.getByLabelText(messages.fields.jobTitleLabel)).toHaveValue('Analyst');

    // Education reads as saved entries, not as open inputs — the form is behind Edit.
    await user.click(screen.getByRole('tab', { name: new RegExp(messages.profile.tabs.education) }));
    expect(screen.getByText('Cambridge')).toBeInTheDocument();
    expect(screen.getByText('BSc, Mathematics')).toBeInTheDocument();
    expect(screen.getByText('2015 – 2018')).toBeInTheDocument();
    expect(screen.queryByLabelText(messages.fields.schoolLabel)).toBeNull();

    await user.click(screen.getByRole('tab', { name: new RegExp(messages.profile.tabs.interests) }));
    expect(screen.getByLabelText(messages.fields.interestsLabel)).toHaveValue(
      'Analytical engines',
    );
  });

  // The A06 non-negotiable, from the edit surface: card 2's PATCH carries card 2 and nothing
  // else, so saving education cannot take the name or the interests down with it.
  it('saves one card without erasing the others, and the value survives a reload', async () => {
    const stub = stubFetch();
    await renderPage();

    const user = userEvent.setup();
    await user.click(
      await screen.findByRole('tab', { name: new RegExp(messages.profile.tabs.education) }),
    );
    // Confirming an entry is the save — the tab has no Save button of its own.
    await user.click(screen.getByRole('button', { name: /Edit Cambridge/ }));
    await user.clear(screen.getByLabelText(new RegExp(messages.fields.schoolLabel)));
    await user.type(screen.getByLabelText(new RegExp(messages.fields.schoolLabel)), 'Oxford');
    await user.click(screen.getByRole('button', { name: messages.fields.entrySave }));

    await waitFor(() =>
      expect(screen.getByRole('status')).toHaveTextContent(messages.profile.saved),
    );

    const patch = stub.calls.find((call) => call.method === 'PATCH');
    expect(patch?.body).toEqual({
      step: 2,
      fields: {
        education: [
          {
            school: 'Oxford',
            degree: 'BSc',
            field: 'Mathematics',
            startYear: 2015,
            endYear: 2018,
          },
        ],
      },
    });

    // Merge held: the other two cards are still on the server's copy…
    expect(stub.stored()).toMatchObject({
      fullName: 'Ada Lovelace',
      interestsText: 'Analytical engines',
    });
    // …and the profile was refetched, so what is on screen is what a reload would show.
    const gets = stub.calls.filter(
      (call) => call.url === '/api/me/profile' && call.method === 'GET',
    );
    expect(gets.length).toBeGreaterThan(1);
  });

  it('clears a field by saving it empty', async () => {
    const stub = stubFetch();
    await renderPage();

    const user = userEvent.setup();
    await user.clear(await screen.findByLabelText(messages.fields.jobTitleLabel));
    await user.click(screen.getByRole('button', { name: messages.profile.save }));

    await waitFor(() => expect(stub.calls.some((call) => call.method === 'PATCH')).toBe(true));
    const patch = stub.calls.find((call) => call.method === 'PATCH');
    expect((patch?.body as { fields: { jobTitle: string } }).fields.jobTitle).toBe('');
  });

  // School is the only required field, so this is the one entry the form refuses.
  it('refuses an entry with no school and never sends it', async () => {
    const stub = stubFetch();
    await renderPage();

    const user = userEvent.setup();
    await user.click(
      await screen.findByRole('tab', { name: new RegExp(messages.profile.tabs.education) }),
    );
    await user.click(screen.getByRole('button', { name: messages.fields.addEducationRow }));
    await user.type(screen.getByLabelText(messages.fields.degreeLabel), 'MSc');
    await user.click(screen.getByRole('button', { name: messages.fields.entrySave }));

    expect(await screen.findByRole('alert')).toHaveTextContent(
      messages.fields.educationSchoolRequired,
    );
    expect(stub.calls.some((call) => call.method === 'PATCH')).toBe(false);
  });

  it('refuses a start year after the end year', async () => {
    const stub = stubFetch();
    await renderPage();

    const user = userEvent.setup();
    await user.click(
      await screen.findByRole('tab', { name: new RegExp(messages.profile.tabs.education) }),
    );
    await user.click(screen.getByRole('button', { name: messages.fields.addEducationRow }));
    await user.type(screen.getByLabelText(new RegExp(messages.fields.schoolLabel)), 'Somewhere');
    await user.type(screen.getByLabelText(messages.fields.startYearLabel), '2020');
    await user.type(screen.getByLabelText(messages.fields.endYearLabel), '2016');
    await user.click(screen.getByRole('button', { name: messages.fields.entrySave }));

    expect(await screen.findByRole('alert')).toHaveTextContent(messages.fields.educationYearOrder);
    expect(stub.calls.some((call) => call.method === 'PATCH')).toBe(false);
  });

  it('removes an entry in two clicks and saves the shorter list', async () => {
    const stub = stubFetch();
    await renderPage();

    const user = userEvent.setup();
    await user.click(
      await screen.findByRole('tab', { name: new RegExp(messages.profile.tabs.education) }),
    );
    await user.click(screen.getByRole('button', { name: /Remove Cambridge/ }));
    expect(stub.calls.some((call) => call.method === 'PATCH')).toBe(false);

    await user.click(screen.getByRole('button', { name: messages.fields.removeEntryAction }));

    await waitFor(() => expect(stub.calls.some((call) => call.method === 'PATCH')).toBe(true));
    expect(stub.calls.find((call) => call.method === 'PATCH')?.body).toEqual({
      step: 2,
      fields: { education: [] },
    });
  });

  it('keeps the draft and shows the mapped code when a save is refused', async () => {
    stubFetch({ patchStatus: 429 });
    await renderPage();

    const user = userEvent.setup();
    await user.type(await screen.findByLabelText(messages.fields.fullNameLabel), '!');
    await user.click(screen.getByRole('button', { name: messages.profile.save }));

    const banner = await screen.findByRole('alert');
    expect(banner).toHaveTextContent(messages.profile.saveFailed);
    expect(banner).toHaveTextContent(messages.errors.RATE_LIMITED);
    expect(screen.queryByText(/RATE_LIMITED/)).toBeNull();
    expect(screen.getByLabelText(messages.fields.fullNameLabel)).toHaveValue('Ada Lovelace!');
  });

  it('adds and removes a hobby without touching the interests text', async () => {
    const stub = stubFetch();
    await renderPage();

    const user = userEvent.setup();
    await user.click(
      await screen.findByRole('tab', { name: new RegExp(messages.profile.tabs.interests) }),
    );
    await user.type(screen.getByLabelText(messages.fields.hobbiesLabel), 'chess{Enter}');
    await user.click(screen.getByRole('button', { name: messages.profile.save }));

    await waitFor(() => expect(stub.calls.some((call) => call.method === 'PATCH')).toBe(true));
    expect(stub.calls.find((call) => call.method === 'PATCH')?.body).toEqual({
      step: 3,
      fields: { hobbies: ['chess'], interestsText: 'Analytical engines' },
    });
  });

  // Issue 009 (KVKK Art. 7 / GDPR Art. 17). It sits below the tabs, not in one: the rail is
  // arrow-key navigable and every other panel ends in a Save.
  it('erases the account behind a confirm and reloads onto the anonymous landing', async () => {
    const stub = stubFetch();
    const assign = vi.fn();
    vi.stubGlobal('location', { ...window.location, assign });
    await renderPage();

    const user = userEvent.setup();
    await user.click(
      await screen.findByRole('button', { name: messages.profile.deleteAccountAction }),
    );
    // Confirm first: one click never destroys an account.
    expect(stub.calls.every((c) => !(c.method === 'DELETE' && c.url === '/api/me'))).toBe(true);

    await user.click(
      screen.getByRole('button', { name: messages.profile.deleteAccountConfirmAction }),
    );

    await waitFor(() =>
      expect(stub.calls.some((c) => c.method === 'DELETE' && c.url === '/api/me')).toBe(true),
    );
    // A full navigation, not a client-side one: HomeSwitch probes `/me` once, on mount.
    await waitFor(() => expect(assign).toHaveBeenCalledWith('/'));
  });

  it('offers no Save on the CV tab — the upload is the write', async () => {
    stubFetch();
    await renderPage();

    const user = userEvent.setup();
    await user.click(await screen.findByRole('tab', { name: new RegExp(messages.profile.tabs.cv) }));

    expect(screen.getByLabelText(messages.fields.cvLabel)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: messages.profile.save })).toBeNull();
  });
});
