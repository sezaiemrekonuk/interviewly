import { act, screen, waitFor, type RenderResult } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Suspense } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { messages, renderWithProviders } from '../../../../test/render';

import { passedSteps } from './session-steps';

// One object, not a fresh one per call: `useRequireAuth` and the page both key effects on
// the router identity, and a new object every render refetches `/me` forever.
const nav = vi.hoisted(() => ({
  push: vi.fn(),
  replace: vi.fn(),
  prefetch: vi.fn(),
  refresh: vi.fn(),
}));

vi.mock('next/navigation', () => ({
  useRouter: () => nav,
  usePathname: () => '/onboarding/1',
}));

import OnboardingStepPage from './page';

const USER = { id: 'u1', email: 'someone@example.com', onboardingCompletedAt: null, interviewCount: 0 };

interface Call {
  url: string;
  method: string;
  body: unknown;
}

/**
 * Routes by path, because the page fans out: `/me` (the auth gate), `/me/profile` (the
 * card), then the card's own PATCH and the completion POST.
 */
function stubFetch(options: {
  profile?: Record<string, unknown>;
  onboardingCompletedAt?: string | null;
  patchStatus?: number;
  patchBody?: unknown;
  uploadStatus?: number;
  uploadBody?: unknown;
}) {
  const calls: Call[] = [];
  // The server's copy of the attachment. `POST /uploads` writes it there, so the stub does
  // too — a stub that answered `cvUploadId: null` forever could not tell a page reading the
  // profile apart from one echoing its own upload back at itself.
  let cvUploadId: string | null = null;

  const spy = vi.fn(async (url: string, init?: RequestInit) => {
    const method = init?.method ?? 'GET';
    const body = init?.body;
    calls.push({
      url,
      method,
      body: body && typeof body === 'string' ? JSON.parse(body) : null,
    });

    const json = (status: number, body: unknown) =>
      new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

    if (url === '/api/me') return json(200, { user: USER });
    if (url === '/api/uploads') {
      const status = options.uploadStatus ?? 201;
      if (status === 201) cvUploadId = 'up_1';
      return json(status, options.uploadBody ?? { uploadId: 'up_1' });
    }
    if (url === '/api/me/profile' && method === 'GET') {
      return json(200, {
        profile: options.profile ?? {},
        onboardingCompletedAt: options.onboardingCompletedAt ?? null,
        cvUploadId,
        cv: cvUploadId
          ? {
              id: cvUploadId,
              mime: 'application/pdf',
              sizeBytes: 12_800,
              uploadedAt: '2026-08-01T09:00:00.000Z',
            }
          : null,
      });
    }
    if (url === '/api/me/profile') {
      return json(options.patchStatus ?? 200, options.patchBody ?? { profile: {} });
    }
    if (url === '/api/me/profile/complete') return json(200, { onboardingCompletedAt: 'now' });
    return json(404, { error: { code: 'NOT_FOUND' } });
  });
  vi.stubGlobal('fetch', spy);
  return calls;
}

// `params` is a promise the page unwraps with `use()`, so the first render suspends —
// the act() wrapper is what lets React resume before any assertion runs.
async function renderStep(step: '1' | '2' | '3'): Promise<RenderResult> {
  let result!: RenderResult;
  await act(async () => {
    result = renderWithProviders(
      <Suspense fallback={null}>
        <OnboardingStepPage params={Promise.resolve({ step })} />
      </Suspense>,
    );
  });
  return result;
}

describe('onboarding step page', () => {
  beforeEach(() => {
    nav.push.mockReset();
    nav.replace.mockReset();
    // The session ledger is module state (it has to survive the remount a step change
    // causes), so each test starts as a cold page load would.
    passedSteps.clear();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  // A06's merge-not-replace contract: a card PATCHes its own fields and nothing else, so a
  // half-finished profile survives a mid-flow drop.
  it('saves only step 1 fields and advances', async () => {
    const calls = stubFetch({});
    await renderStep('1');

    const user = userEvent.setup();
    await user.type(await screen.findByLabelText(messages.fields.fullNameLabel), 'Ada');
    await user.type(screen.getByLabelText(messages.fields.jobTitleLabel), 'Engineer');
    await user.click(screen.getByRole('button', { name: messages.onboarding.continueButton }));

    await waitFor(() => expect(nav.push).toHaveBeenCalledWith('/onboarding/2'));
    const patch = calls.find((call) => call.method === 'PATCH');
    expect(patch?.body).toEqual({ step: 1, fields: { fullName: 'Ada', jobTitle: 'Engineer' } });
  });

  it('keeps the draft and shows the mapped code when a save is refused', async () => {
    stubFetch({ patchStatus: 400, patchBody: { error: { code: 'VALIDATION_ERROR' } } });
    await renderStep('1');

    const user = userEvent.setup();
    await user.type(await screen.findByLabelText(messages.fields.fullNameLabel), 'Ada');
    await user.click(screen.getByRole('button', { name: messages.onboarding.continueButton }));

    const banner = await screen.findByRole('alert');
    expect(banner).toHaveTextContent(messages.onboarding.saveFailed);
    expect(banner).toHaveTextContent(messages.errors.VALIDATION_ERROR);
    expect(screen.queryByText(/VALIDATION_ERROR/)).toBeNull();
    expect(nav.push).not.toHaveBeenCalled();
    expect(screen.getByLabelText(messages.fields.fullNameLabel)).toHaveValue('Ada');
  });

  it('completes from step 3 and routes to setup', async () => {
    const calls = stubFetch({
      profile: { fullName: 'Ada', education: [{ school: 'S', degree: 'D', field: 'F', graduationYear: 2020 }] },
    });
    await renderStep('3');

    const user = userEvent.setup();
    await user.type(await screen.findByLabelText(messages.fields.interestsLabel), 'Chess');
    await user.click(screen.getByRole('button', { name: messages.onboarding.finish }));

    await waitFor(() => expect(nav.replace).toHaveBeenCalledWith('/interviews/new'));
    expect(calls.some((call) => call.url === '/api/me/profile/complete')).toBe(true);
  });

  // The bug this covers: `firstUnfilledStep` answers 2 for as long as education is empty,
  // so re-deriving it on arrival at step 3 used to replace the user straight back to 2 —
  // Skip could never advance, and step 2 was a dead end for anyone without a degree.
  it('skips step 2 with an empty education card and stays on step 3', async () => {
    stubFetch({ profile: { fullName: 'Ada' } });
    const onStepTwo = await renderStep('2');

    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: messages.onboarding.skipForNow }));
    expect(nav.push).toHaveBeenCalledWith('/onboarding/3');

    // What the push does in the browser: the segment remounts on the new param.
    onStepTwo.unmount();
    await renderStep('3');

    expect(await screen.findByLabelText(messages.fields.interestsLabel)).toBeInTheDocument();
    expect(nav.replace).not.toHaveBeenCalled();
  });

  // Continue on an untouched card is a Skip: `{ education: [] }` merges nothing, so it is
  // never sent, and the visitor advances instead of bouncing.
  it('treats Continue on an empty education card as a skip', async () => {
    const calls = stubFetch({ profile: { fullName: 'Ada' } });
    await renderStep('2');

    const user = userEvent.setup();
    await user.click(
      await screen.findByRole('button', { name: messages.onboarding.continueButton }),
    );

    await waitFor(() => expect(nav.push).toHaveBeenCalledWith('/onboarding/3'));
    expect(calls.some((call) => call.method === 'PATCH')).toBe(false);
  });

  // Issue 62: the confirmation used to be a local echo of the upload's own answer, so it
  // said "CV received" whether or not anything had been attached and vanished on reload.
  // It is now the profile's own CV record, which is why the refetch has to happen.
  it('shows the CV confirmation from the refetched profile, not from the upload answer', async () => {
    const calls = stubFetch({ profile: { fullName: 'Ada' } });
    await renderStep('2');

    const user = userEvent.setup();
    const input = await screen.findByLabelText(messages.fields.cvLabel);
    await user.upload(input, new File(['%PDF-1.4 cv'], 'cv.pdf', { type: 'application/pdf' }));

    await waitFor(() =>
      expect(screen.getByTestId('cv-state')).not.toHaveTextContent(messages.fields.cvNone),
    );
    expect(calls.some((call) => call.url === '/api/uploads' && call.method === 'POST')).toBe(true);
    const profileGets = calls.filter(
      (call) => call.url === '/api/me/profile' && call.method === 'GET',
    );
    expect(profileGets.length).toBeGreaterThan(1);
  });

  it('keeps the CV hint off and shows the mapped code when the upload is refused', async () => {
    stubFetch({
      profile: { fullName: 'Ada' },
      uploadStatus: 422,
      uploadBody: { error: { code: 'PDF_TEXT_TOO_SHORT' } },
    });
    await renderStep('2');

    const user = userEvent.setup();
    const input = await screen.findByLabelText(messages.fields.cvLabel);
    await user.upload(input, new File(['not a pdf'], 'cv.pdf', { type: 'application/pdf' }));

    expect(await screen.findByText(new RegExp(messages.fields.cvFailed))).toBeInTheDocument();
    expect(screen.getByTestId('cv-state')).toHaveTextContent(messages.fields.cvNone);
  });

  it('resumes a cold deep-link to step 3 back to the first unfilled card', async () => {
    stubFetch({ profile: { fullName: 'Ada' } });
    await renderStep('3');

    await waitFor(() => expect(nav.replace).toHaveBeenCalledWith('/onboarding/2'));
    expect(screen.queryByLabelText(messages.fields.interestsLabel)).toBeNull();
  });

  it('redirects an already-completed account off step 1', async () => {
    stubFetch({ onboardingCompletedAt: '2026-08-01T09:00:00Z' });
    await renderStep('1');

    await waitFor(() => expect(nav.replace).toHaveBeenCalledWith('/interviews/new'));
    expect(screen.queryByLabelText(messages.fields.fullNameLabel)).toBeNull();
  });
});
