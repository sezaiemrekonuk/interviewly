import { act, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Suspense } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { messages, renderWithProviders } from '../../../../test/render';

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
}) {
  const calls: Call[] = [];
  const spy = vi.fn(async (url: string, init?: RequestInit) => {
    const method = init?.method ?? 'GET';
    calls.push({ url, method, body: init?.body ? JSON.parse(init.body as string) : null });

    const json = (status: number, body: unknown) =>
      new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

    if (url === '/api/me') return json(200, { user: USER });
    if (url === '/api/me/profile' && method === 'GET') {
      return json(200, {
        profile: options.profile ?? {},
        onboardingCompletedAt: options.onboardingCompletedAt ?? null,
        cvUploadId: null,
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
async function renderStep(step: '1' | '2' | '3') {
  await act(async () => {
    renderWithProviders(
      <Suspense fallback={null}>
        <OnboardingStepPage params={Promise.resolve({ step })} />
      </Suspense>,
    );
  });
}

describe('onboarding step page', () => {
  beforeEach(() => {
    nav.push.mockReset();
    nav.replace.mockReset();
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
    await user.type(await screen.findByLabelText(messages.onboarding.fullNameLabel), 'Ada');
    await user.type(screen.getByLabelText(messages.onboarding.jobTitleLabel), 'Engineer');
    await user.click(screen.getByRole('button', { name: messages.onboarding.continueButton }));

    await waitFor(() => expect(nav.push).toHaveBeenCalledWith('/onboarding/2'));
    const patch = calls.find((call) => call.method === 'PATCH');
    expect(patch?.body).toEqual({ step: 1, fields: { fullName: 'Ada', jobTitle: 'Engineer' } });
  });

  it('keeps the draft and shows the mapped code when a save is refused', async () => {
    stubFetch({ patchStatus: 400, patchBody: { error: { code: 'VALIDATION_ERROR' } } });
    await renderStep('1');

    const user = userEvent.setup();
    await user.type(await screen.findByLabelText(messages.onboarding.fullNameLabel), 'Ada');
    await user.click(screen.getByRole('button', { name: messages.onboarding.continueButton }));

    expect(await screen.findByText(messages.errors.VALIDATION_ERROR)).toBeInTheDocument();
    expect(screen.queryByText(/VALIDATION_ERROR/)).toBeNull();
    expect(nav.push).not.toHaveBeenCalled();
    expect(screen.getByLabelText(messages.onboarding.fullNameLabel)).toHaveValue('Ada');
  });

  it('completes from step 3 and routes to setup', async () => {
    const calls = stubFetch({
      profile: { fullName: 'Ada', education: [{ school: 'S', degree: 'D', field: 'F', graduationYear: 2020 }] },
    });
    await renderStep('3');

    const user = userEvent.setup();
    await user.type(await screen.findByLabelText(messages.onboarding.interestsLabel), 'Chess');
    await user.click(screen.getByRole('button', { name: messages.onboarding.finish }));

    await waitFor(() => expect(nav.replace).toHaveBeenCalledWith('/interviews/new'));
    expect(calls.some((call) => call.url === '/api/me/profile/complete')).toBe(true);
  });

  it('redirects an already-completed account off step 1', async () => {
    stubFetch({ onboardingCompletedAt: '2026-08-01T09:00:00Z' });
    await renderStep('1');

    await waitFor(() => expect(nav.replace).toHaveBeenCalledWith('/interviews/new'));
    expect(screen.queryByLabelText(messages.onboarding.fullNameLabel)).toBeNull();
  });
});
