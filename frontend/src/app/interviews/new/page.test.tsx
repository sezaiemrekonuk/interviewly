import { act, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { messages, renderWithProviders } from '../../../test/render';

// One hoisted object, never a fresh one per call — `useRequireAuth` keys an effect on the
// router identity, and a new object every render refetches `/me` forever (STATE: W04 trap).
const nav = vi.hoisted(() => ({
  push: vi.fn(),
  replace: vi.fn(),
  prefetch: vi.fn(),
  refresh: vi.fn(),
}));

vi.mock('next/navigation', () => ({
  useRouter: () => nav,
  usePathname: () => '/interviews/new',
}));

import InterviewSetupPage from './page';

const USER = { id: 'u1', email: 'someone@example.com', onboardingCompletedAt: 'now', interviewCount: 0 };

interface Call {
  url: string;
  method: string;
  body: unknown;
}

/** `/me` gates the page; `/interviews` is the one create under test. */
function stubFetch(options: { createStatus?: number; createBody?: unknown; profileStatus?: number } = {}) {
  const calls: Call[] = [];
  const spy = vi.fn(async (url: string, init?: RequestInit) => {
    const method = init?.method ?? 'GET';
    const raw = init?.body;
    calls.push({
      url,
      method,
      body: typeof raw === 'string' ? JSON.parse(raw) : (raw ?? null),
    });

    const json = (status: number, body: unknown) =>
      new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

    if (url === '/api/me') return json(200, { user: USER });
    if (url === '/api/uploads') return json(201, { uploadId: 'up1' });
    if (url === '/api/interviews') {
      return json(
        options.createStatus ?? 201,
        options.createBody ?? { interviewId: 'i1', hrCount: 3, techCount: 5 },
      );
    }
    // The profiling → hr_round transition setup fires between create and navigation (issue 53).
    if (/^\/api\/interviews\/[^/]+\/profile$/.test(url)) {
      return json(options.profileStatus ?? 200, { state: 'hr_round' });
    }
    return json(404, { error: { code: 'NOT_FOUND' } });
  });
  vi.stubGlobal('fetch', spy);
  return calls;
}

async function renderSetup() {
  await act(async () => {
    renderWithProviders(<InterviewSetupPage />);
  });
  // The auth gate renders null until `/me` resolves.
  await screen.findByRole('button', { name: messages.setup.start });
}

describe('interview setup page (W05)', () => {
  beforeEach(() => {
    nav.push.mockReset();
    nav.replace.mockReset();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('submits once and navigates to the room on success', async () => {
    const calls = stubFetch();
    const user = userEvent.setup();
    await renderSetup();

    await user.type(screen.getByLabelText(messages.setup.listingPaste), 'Senior developer wanted');
    await user.click(screen.getByRole('button', { name: messages.setup.start }));

    await waitFor(() => expect(nav.push).toHaveBeenCalledWith('/interviews/i1/room'));

    const creates = calls.filter((c) => c.url === '/api/interviews');
    expect(creates).toHaveLength(1);
    expect(creates[0].body).toMatchObject({
      mode: 'text',
      jobText: 'Senior developer wanted',
      targetQuestionCount: 8,
    });
  });

  it('fires the profile transition between create and navigation (issue 53)', async () => {
    const calls = stubFetch();
    const user = userEvent.setup();
    await renderSetup();

    await user.type(screen.getByLabelText(messages.setup.listingPaste), 'Senior developer wanted');
    await user.click(screen.getByRole('button', { name: messages.setup.start }));

    await waitFor(() => expect(nav.push).toHaveBeenCalledWith('/interviews/i1/room'));

    const profile = calls.find((c) => c.url === '/api/interviews/i1/profile');
    expect(profile).toBeDefined();
    expect(profile?.method).toBe('POST');
    expect(profile?.body).toEqual({ skip: true });

    // Ordering: create, then profile, then the push — the room is never entered on `profiling`.
    const createIndex = calls.findIndex((c) => c.url === '/api/interviews');
    const profileIndex = calls.findIndex((c) => c.url === '/api/interviews/i1/profile');
    expect(createIndex).toBeLessThan(profileIndex);
    expect(nav.push).toHaveBeenCalledTimes(1);
  });

  it('does not navigate when the profile transition is refused', async () => {
    stubFetch({ profileStatus: 409 });
    const user = userEvent.setup();
    await renderSetup();

    await user.type(screen.getByLabelText(messages.setup.listingPaste), 'Senior developer wanted');
    await user.click(screen.getByRole('button', { name: messages.setup.start }));

    await screen.findByRole('alert');
    expect(nav.push).not.toHaveBeenCalled();
  });

  it('routes a voice interview to pre-join, not the room', async () => {
    stubFetch();
    const user = userEvent.setup();
    await renderSetup();

    await user.type(screen.getByLabelText(messages.setup.listingPaste), 'Senior developer wanted');
    await user.selectOptions(screen.getByLabelText(messages.setup.mode), 'voice');
    await user.click(screen.getByRole('button', { name: messages.setup.start }));

    await waitFor(() => expect(nav.push).toHaveBeenCalledWith('/interviews/i1/pre-join'));
  });

  it('shows DAILY_INTERVIEW_LIMIT inline without navigating', async () => {
    stubFetch({
      createStatus: 429,
      createBody: { error: { code: 'DAILY_INTERVIEW_LIMIT' } },
    });
    const user = userEvent.setup();
    await renderSetup();

    await user.type(screen.getByLabelText(messages.setup.listingPaste), 'Senior developer wanted');
    await user.click(screen.getByRole('button', { name: messages.setup.start }));

    expect(await screen.findByRole('alert')).toHaveTextContent(messages.errors.DAILY_INTERVIEW_LIMIT);
    expect(nav.push).not.toHaveBeenCalled();
    // The form comes back, it does not stay locked behind a pending CTA.
    expect(screen.getByRole('button', { name: messages.setup.start })).toBeEnabled();
  });

  it('keeps the typed listing after a refused create', async () => {
    stubFetch({ createStatus: 429, createBody: { error: { code: 'DAILY_INTERVIEW_LIMIT' } } });
    const user = userEvent.setup();
    await renderSetup();

    const listing = screen.getByLabelText(messages.setup.listingPaste);
    await user.type(listing, 'Senior developer wanted');
    await user.click(screen.getByRole('button', { name: messages.setup.start }));

    await screen.findByRole('alert');
    expect(listing).toHaveValue('Senior developer wanted');
  });

  it('never sends a create without a listing — no round trip to learn a known verdict', async () => {
    const calls = stubFetch();
    const user = userEvent.setup();
    await renderSetup();

    await user.click(screen.getByRole('button', { name: messages.setup.start }));

    expect(await screen.findByRole('alert')).toHaveTextContent(messages.errors.LISTING_REQUIRED);
    expect(calls.filter((c) => c.url === '/api/interviews')).toHaveLength(0);
    expect(nav.push).not.toHaveBeenCalled();
  });

  it('requires pasted text even when a listing PDF uploaded cleanly', async () => {
    // I03 rejects `uploadId` with no `jobText` as VALIDATION_ERROR — extracted-text handoff
    // is still I11's unbuilt contract. Sending it anyway spends a round trip to earn a
    // confusing "the request is invalid" on a form the user filled in as designed.
    const calls = stubFetch();
    const user = userEvent.setup();
    await renderSetup();

    await user.upload(
      screen.getByLabelText(messages.setup.listingUpload),
      new File(['%PDF-1.4'], 'listing.pdf', { type: 'application/pdf' }),
    );
    await user.click(screen.getByRole('button', { name: messages.setup.start }));

    expect(await screen.findByRole('alert')).toHaveTextContent(messages.errors.LISTING_REQUIRED);
    expect(calls.filter((c) => c.url === '/api/interviews')).toHaveLength(0);
    expect(nav.push).not.toHaveBeenCalled();
  });

  it('sends the uploadId alongside the pasted text', async () => {
    const calls = stubFetch();
    const user = userEvent.setup();
    await renderSetup();

    await user.upload(
      screen.getByLabelText(messages.setup.listingUpload),
      new File(['%PDF-1.4'], 'listing.pdf', { type: 'application/pdf' }),
    );
    await user.type(screen.getByLabelText(messages.setup.listingPaste), 'Senior developer wanted');
    await user.click(screen.getByRole('button', { name: messages.setup.start }));

    await waitFor(() => expect(nav.push).toHaveBeenCalledWith('/interviews/i1/room'));
    expect(calls.find((c) => c.url === '/api/interviews')?.body).toMatchObject({
      uploadId: 'up1',
      jobText: 'Senior developer wanted',
    });
  });

  it('renders the round split from hrCount/techCount', async () => {
    stubFetch();
    await renderSetup();

    // Default target 8 → hrCount = max(2, round(3.2)) = 3, techCount = 5 (I03 split).
    expect(screen.getByText('3 HR + 5 technical questions')).toBeInTheDocument();
  });

  it('claims no detected summary at all — the response carries none', async () => {
    stubFetch();
    const user = userEvent.setup();
    await renderSetup();

    // I03 returns `{ interviewId, hrCount, techCount }` and nothing else, so the screen shows
    // no detected-summary affordance — not even a placeholder for one. The occupation the
    // user types is never echoed back as a *detected* value either.
    await user.type(screen.getByLabelText(messages.setup.occupation), 'Data Scientist');
    expect(screen.queryAllByText(/detected/i)).toHaveLength(0);
  });
});
