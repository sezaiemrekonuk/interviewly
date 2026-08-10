import { act, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { messages, renderWithProviders } from '../../../../test/render';

// One hoisted object, never a fresh one per call — `useRequireAuth` keys an effect on the
// router identity, and a new object every render refetches `/me` forever (STATE: W04 trap).
const nav = vi.hoisted(() => ({
  push: vi.fn(),
  replace: vi.fn(),
  prefetch: vi.fn(),
  refresh: vi.fn(),
  search: '',
}));

vi.mock('next/navigation', async () => ({
  ...(await import('@/test/navigation')).serverNavigation,
  useRouter: () => nav,
  usePathname: () => '/interviews/new',
  useSearchParams: () => new URLSearchParams(nav.search),
}));

import InterviewSetupPage, { VOICE_MAX_INTERVIEW_SECONDS } from './page';

const USER = { id: 'u1', email: 'someone@example.com', onboardingCompletedAt: 'now', interviewCount: 0 };

interface Call {
  url: string;
  method: string;
  body: unknown;
}

/** `/me` gates the page; `/interviews` is the one create under test. */
function stubFetch(
  options: {
    createStatus?: number;
    createBody?: unknown;
    profileStatus?: number;
    uploadBody?: unknown;
  } = {},
) {
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
    // I11 answers a listing with the text it parsed out of the PDF.
    if (url === '/api/uploads') {
      return json(201, options.uploadBody ?? { uploadId: 'up1', text: 'Backend engineer, Go' });
    }
    if (url === '/api/interviews') {
      return json(
        options.createStatus ?? 201,
        options.createBody ?? { interviewId: 'i1', hrCount: 4, techCount: 6 },
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

const listingPdf = () => new File(['%PDF-1.4'], 'listing.pdf', { type: 'application/pdf' });

/** Claims to be over the server's 10 MB cap without allocating eleven megabytes to say so. */
const oversizedPdf = () => {
  const file = new File(['%PDF-1.4'], 'huge.pdf', { type: 'application/pdf' });
  Object.defineProperty(file, 'size', { value: 11 * 1024 * 1024 });
  return file;
};

describe('interview setup page (W05)', () => {
  beforeEach(() => {
    nav.push.mockReset();
    nav.replace.mockReset();
    nav.search = '';
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('submits once and navigates to pre-join — voice is the default mode', async () => {
    const calls = stubFetch();
    const user = userEvent.setup();
    await renderSetup();

    await user.type(screen.getByLabelText(messages.setup.listingPaste), 'Senior developer wanted');
    await user.click(screen.getByRole('button', { name: messages.setup.start }));

    await waitFor(() => expect(nav.push).toHaveBeenCalledWith('/interviews/i1/pre-join'));

    const creates = calls.filter((c) => c.url === '/api/interviews');
    expect(creates).toHaveLength(1);
    expect(creates[0].body).toMatchObject({
      mode: 'voice',
      jobText: 'Senior developer wanted',
      targetQuestionCount: 10,
    });
    // A preset never sizes the HR half itself — the server owns the split.
    expect(creates[0].body).not.toHaveProperty('hrQuestionCount');
  });

  it('fires the profile transition between create and navigation (issue 53)', async () => {
    const calls = stubFetch();
    const user = userEvent.setup();
    await renderSetup();

    await user.type(screen.getByLabelText(messages.setup.listingPaste), 'Senior developer wanted');
    await user.click(screen.getByRole('button', { name: messages.setup.start }));

    await waitFor(() => expect(nav.push).toHaveBeenCalled());

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

  it('routes a text interview to the room, not pre-join', async () => {
    stubFetch();
    const user = userEvent.setup();
    await renderSetup();

    await user.type(screen.getByLabelText(messages.setup.listingPaste), 'Senior developer wanted');
    await user.click(screen.getByRole('radio', { name: new RegExp(messages.setup.modeText) }));
    await user.click(screen.getByRole('button', { name: messages.setup.start }));

    await waitFor(() => expect(nav.push).toHaveBeenCalledWith('/interviews/i1/room'));
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

  // Issue 99: a session that lapsed while the listing was being pasted used to render
  // "Sign in to continue." on a screen with no sign-in control, and Start kept failing.
  it('sends an expired session to sign-in instead of a dead Start button', async () => {
    stubFetch({ createStatus: 401, createBody: { error: { code: 'UNAUTHENTICATED' } } });
    const user = userEvent.setup();
    await renderSetup();

    await user.type(screen.getByLabelText(messages.setup.listingPaste), 'Senior developer wanted');
    await user.click(screen.getByRole('button', { name: messages.setup.start }));

    await waitFor(() =>
      expect(nav.replace).toHaveBeenCalledWith('/sign-in?returnPath=%2Finterviews%2Fnew'),
    );
    expect(screen.queryByRole('alert')).toBeNull();
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

  it('fills the listing from the text the upload parsed out of the PDF', async () => {
    const calls = stubFetch();
    const user = userEvent.setup();
    await renderSetup();

    await user.upload(screen.getByLabelText(messages.setup.listingUpload), listingPdf());

    const listing = await screen.findByLabelText(messages.setup.listingPaste);
    await waitFor(() => expect(listing).toHaveValue('Backend engineer, Go'));

    // No paste needed: the PDF alone is now a complete listing.
    await user.click(screen.getByRole('button', { name: messages.setup.start }));
    await waitFor(() => expect(nav.push).toHaveBeenCalled());
    expect(calls.find((c) => c.url === '/api/interviews')?.body).toMatchObject({
      uploadId: 'up1',
      jobText: 'Backend engineer, Go',
    });
  });

  // Issue 140: the server refuses this file anyway, but only after the browser has streamed
  // all of it. The point of the guard is the request that never leaves.
  it('refuses an over-sized PDF at pick time, with no request to /uploads', async () => {
    const calls = stubFetch();
    const user = userEvent.setup();
    await renderSetup();

    await user.upload(screen.getByLabelText(messages.setup.listingUpload), oversizedPdf());

    expect(await screen.findByRole('alert')).toHaveTextContent(messages.errors.UPLOAD_TOO_LARGE);
    expect(calls.filter((c) => c.url === '/api/uploads')).toHaveLength(0);
  });

  it('still needs pasted text when the PDF carried no readable text', async () => {
    // The id comes back without a `text` — nothing lands in the textarea and the guard fires
    // here rather than spending a round trip on a VALIDATION_ERROR.
    const calls = stubFetch({ uploadBody: { uploadId: 'up1' } });
    const user = userEvent.setup();
    await renderSetup();

    await user.upload(screen.getByLabelText(messages.setup.listingUpload), listingPdf());
    await user.click(screen.getByRole('button', { name: messages.setup.start }));

    expect(await screen.findByRole('alert')).toHaveTextContent(messages.errors.LISTING_REQUIRED);
    expect(calls.filter((c) => c.url === '/api/interviews')).toHaveLength(0);
  });

  it('renders the round split for the selected preset length', async () => {
    stubFetch();
    const user = userEvent.setup();
    await renderSetup();

    // Medium (10) → hrCount = max(2, round(4)) = 4, techCount = 6 (I03 split).
    expect(screen.getByText('4 HR + 6 technical questions')).toBeInTheDocument();

    await user.click(screen.getByRole('radio', { name: new RegExp(messages.setup.lengthFast) }));
    // Fast (6) → hrCount = max(2, round(2.4)) = 2, techCount = 4.
    expect(screen.getByText('2 HR + 4 technical questions')).toBeInTheDocument();
  });

  it('sends the custom shape as targetQuestionCount + hrQuestionCount', async () => {
    const calls = stubFetch();
    const user = userEvent.setup();
    await renderSetup();

    await user.type(screen.getByLabelText(messages.setup.listingPaste), 'Senior developer wanted');
    await user.click(screen.getByRole('radio', { name: messages.setup.lengthCustom }));

    const hr = screen.getByLabelText(messages.setup.customHr);
    const tech = screen.getByLabelText(messages.setup.customTech);
    await user.clear(hr);
    await user.type(hr, '3');
    await user.clear(tech);
    await user.type(tech, '9');

    await user.click(screen.getByRole('button', { name: messages.setup.start }));

    await waitFor(() => expect(nav.push).toHaveBeenCalled());
    expect(calls.find((c) => c.url === '/api/interviews')?.body).toMatchObject({
      targetQuestionCount: 12,
      hrQuestionCount: 3,
    });
  });

  it('refuses a custom shape over the ceiling without a round trip', async () => {
    const calls = stubFetch();
    const user = userEvent.setup();
    await renderSetup();

    await user.type(screen.getByLabelText(messages.setup.listingPaste), 'Senior developer wanted');
    await user.click(screen.getByRole('radio', { name: messages.setup.lengthCustom }));

    const tech = screen.getByLabelText(messages.setup.customTech);
    await user.clear(tech);
    await user.type(tech, '19');

    await user.click(screen.getByRole('button', { name: messages.setup.start }));

    await screen.findByRole('alert');
    expect(calls.filter((c) => c.url === '/api/interviews')).toHaveLength(0);
    expect(nav.push).not.toHaveBeenCalled();
  });

  // S08 / speech AC-11. The ceiling is the server's; this control only asks for less of it.
  describe('the voice duration control', () => {
    async function createWith(pick?: (user: ReturnType<typeof userEvent.setup>) => Promise<void>) {
      const calls = stubFetch();
      const user = userEvent.setup();
      await renderSetup();

      await user.type(screen.getByLabelText(messages.setup.listingPaste), 'Senior developer wanted');
      await pick?.(user);
      await user.click(screen.getByRole('button', { name: messages.setup.start }));
      await waitFor(() => expect(nav.push).toHaveBeenCalled());

      return calls.find((c) => c.url === '/api/interviews')?.body as Record<string, unknown>;
    }

    it('sends no duration by default, so the server ceiling is what applies', async () => {
      const body = await createWith();
      expect(body).not.toHaveProperty('durationSeconds');
    });

    it('sends the picked duration in seconds', async () => {
      const body = await createWith(async (user) => {
        await user.click(screen.getByRole('radio', { name: new RegExp(messages.setup.duration15) }));
      });
      expect(body).toMatchObject({ durationSeconds: 900 });
    });

    it('offers nothing above the platform ceiling — every option is a request for less', async () => {
      stubFetch();
      await renderSetup();

      const seconds = screen
        .getAllByRole('radio', { name: /min$/ })
        .map((radio) => Number((radio as HTMLInputElement).value));

      expect(seconds.length).toBeGreaterThan(0);
      expect(Math.max(...seconds)).toBeLessThanOrEqual(VOICE_MAX_INTERVIEW_SECONDS);
    });

    it('is not offered for a text interview, and sends no duration for one', async () => {
      const body = await createWith(async (user) => {
        await user.click(screen.getByRole('radio', { name: new RegExp(messages.setup.duration15) }));
        await user.click(screen.getByRole('radio', { name: new RegExp(messages.setup.modeText) }));
      });

      expect(screen.queryByText(messages.setup.duration)).not.toBeInTheDocument();
      expect(body).not.toHaveProperty('durationSeconds');
    });
  });

  it('prefills the listing from ?prefill=, with the escapes turned back into line breaks', async () => {
    nav.search = `prefill=${encodeURIComponent('Backend engineer\\n\\nGo, Postgres')}`;
    stubFetch();
    await renderSetup();

    expect(screen.getByLabelText(messages.setup.listingPaste)).toHaveValue(
      'Backend engineer\n\nGo, Postgres',
    );
  });
});
