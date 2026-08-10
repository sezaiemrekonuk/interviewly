import { act, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { messages, renderWithProviders } from '../../../test/render';

const nav = vi.hoisted(() => ({
  replace: vi.fn(),
  push: vi.fn(),
}));
// One stable object, as Next's own `useRouter()` returns. A fresh object per render makes
// `useRequireAuth`'s effect re-fire on every commit, which is an infinite loop, not a test.
const router = { ...nav, prefetch: vi.fn(), refresh: vi.fn() };
vi.mock('next/navigation', async () => ({
  ...(await import('@/test/navigation')).serverNavigation,
  useRouter: () => router,
  usePathname: () => '/dashboard',
}));
const replace = nav.replace;

import Dashboard from './page';

const d = messages.dashboard;

/** ICU placeholder fill, so an assertion names a key rather than hard-coding polished copy. */
const copy = (template: string, vars: Record<string, string | number>) =>
  template.replace(/\{(\w+)\}/g, (_, key: string) => String(vars[key]));

const PROFILE = {
  profile: { fullName: 'Deniz Yılmaz', jobTitle: 'Backend developer' },
  onboardingCompletedAt: 'now',
  cvUploadId: 'u1',
  cv: { id: 'u1', filename: 'cv.pdf', mime: 'application/pdf', sizeBytes: 10, uploadedAt: 'now' },
};

/** A day, in ms — used to age fixtures so "latest" and "best" are different runs. */
const DAY = 86_400_000;

function run(over: Record<string, unknown> = {}) {
  return {
    id: 'i1',
    state: 'completed',
    mode: 'text',
    occupation: 'Backend developer',
    endedReason: 'completed',
    createdAt: new Date(Date.now() - DAY).toISOString(),
    startedAt: new Date(Date.now() - DAY).toISOString(),
    endedAt: new Date(Date.now() - DAY).toISOString(),
    overallScore: 80,
    roundScores: { hr: 80, tech: 40 },
    ...over,
  };
}

function question(over: Record<string, unknown> = {}) {
  return {
    questionId: 'q1',
    interviewId: 'i1',
    occupation: 'Backend developer',
    roundType: 'tech',
    text: 'Where do you look first when a query gets slow?',
    answeredAt: '2026-08-01T10:00:00.000Z',
    durationMs: 40_000,
    score: 40,
    reason: 'Named an index without measuring first.',
    starAdherence: 0.3,
    answerScores: null,
    ...over,
  };
}

interface Call {
  url: string;
  method: string;
}

function stub(options: { runs?: unknown[]; questions?: unknown[]; profile?: unknown } = {}) {
  const calls: Call[] = [];
  const json = (status: number, body: unknown) =>
    new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      calls.push({ url, method: init?.method ?? 'GET' });
      if (url === '/api/me')
        return json(200, {
          user: { id: 'u1', email: 'a@b.c', role: 'candidate', emailVerifiedAt: 'now' },
        });
      if (url === '/api/me/profile') return json(200, options.profile ?? PROFILE);
      // Ahead of the list branch, which `startsWith` would otherwise answer for it — the
      // practice grid reads its own aggregate and `month-heatmap.test.tsx` owns what it does
      // with it. Here it only has to not be a 404 dressed as a card-wide error.
      if (url.startsWith('/api/me/interviews/activity'))
        return json(200, { month: '2026-08', days: [], max: 0, earliest: null });
      if (url.startsWith('/api/me/interviews'))
        return json(200, { items: options.runs ?? [run()], nextCursor: null });
      if (url.startsWith('/api/me/questions'))
        return json(200, { items: options.questions ?? [question()], nextCursor: null });
      if ((init?.method ?? 'GET') === 'DELETE') return new Response(null, { status: 204 });
      return json(404, { error: { code: 'UNKNOWN' } });
    }),
  );

  return calls;
}

async function render() {
  await act(async () => {
    renderWithProviders(<Dashboard />);
  });
}

describe('/dashboard — the briefing', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    // `router` is one object shared by every case, so its spies are too.
    replace.mockClear();
  });

  it('greets by first name and offers the archive and a new interview', async () => {
    stub();
    await render();

    await waitFor(() =>
      expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Deniz'),
    );
    expect(screen.getByRole('link', { name: messages.nav.new })).toHaveAttribute(
      'href',
      '/interviews/new',
    );
  });

  // The defect this whole surface exists to fix: the product scored both rounds separately
  // from the first interview and never once told anyone which was weaker. The second half is
  // newer — naming a weakness and offering nothing to do about it is the original complaint.
  it('names the weaker round in a sentence and links it to those questions', async () => {
    stub({ runs: [run({ id: 'i2' }), run({ id: 'i1' })] });
    await render();

    const split = await screen.findByTestId('round-split');
    expect(within(split).getByText('80')).toBeInTheDocument();
    expect(within(split).getByText('40')).toBeInTheDocument();
    expect(within(split).getByText(/Technical round is 40 lower/i)).toBeInTheDocument();
    expect(
      within(split).getByRole('link', {
        name: copy(d.rounds.weakerLink, { round: d.rounds.tech }),
      }),
    ).toHaveAttribute('href', '/interviews?view=questions&round=tech&sort=worst');
  });

  // One interview and a forty-point gap on a single sitting is not a property of the candidate.
  // The same card family refuses to draw a trend from two points for the same reason.
  it('states the two round scores without prescribing anything from a sample of one', async () => {
    stub();
    await render();

    const split = await screen.findByTestId('round-split');
    expect(within(split).getByText(copy(d.rounds.gapOne, { hr: 80, tech: 40 }))).toBeInTheDocument();
    expect(within(split).queryByText(/one to practise/i)).toBeNull();
    // Navigation is not advice: the round's worst answers exist at n = 1 too.
    expect(
      within(split).getByRole('link', {
        name: copy(d.rounds.weakerLink, { round: d.rounds.tech }),
      }),
    ).toHaveAttribute('href', '/interviews?view=questions&round=tech&sort=worst');
  });

  it('shows the latest score with no delta until there is something to compare it to', async () => {
    stub();
    await render();

    expect(await screen.findByTestId('standing-latest')).toHaveTextContent('80');
    expect(screen.queryByText(/on your last/i)).toBeNull();
  });

  it('reports the change against the previous interview once there are two', async () => {
    stub({
      runs: [
        run({ id: 'i2', overallScore: 100, createdAt: new Date().toISOString() }),
        run({ id: 'i1', overallScore: 60 }),
      ],
    });
    await render();

    expect(await screen.findByTestId('standing-latest')).toHaveTextContent('100');
    expect(screen.getByText(d.standing.delta.up.replace('{n}', '40'))).toBeInTheDocument();
  });

  // Duolingo's rule: a module that is not ready says what it is waiting for. A trend that
  // silently appears on the third visit is a surprise; a count is a reason to come back.
  it('locks the trend line below three scored interviews and says how many are missing', async () => {
    stub();
    await render();

    expect(await screen.findByTestId('trend-locked')).toHaveTextContent('2 more');
    expect(screen.queryByTestId('trend')).toBeNull();
  });

  it('draws the trend once three scored interviews exist', async () => {
    stub({
      runs: [run({ id: 'i3', overallScore: 100 }), run({ id: 'i2' }), run({ id: 'i1', overallScore: 40 })],
    });
    await render();

    const trend = await screen.findByTestId('trend');
    // Oldest → newest, as the caption promises: 40, 80, 100 across a 240×44 box.
    expect(trend.querySelector('polyline')).toHaveAttribute(
      'points',
      '0.0,26.4 120.0,8.8 240.0,0.0',
    );
  });

  it('lists the weakest answers with the reason each was marked down', async () => {
    stub({
      questions: [
        question({ questionId: 'q1', score: 60, reason: 'Stopped at the situation.' }),
        question({ questionId: 'q2', score: 20, reason: 'Never answered the question asked.' }),
      ],
    });
    await render();

    const focus = await screen.findByTestId('focus');
    const items = within(focus).getAllByRole('listitem');
    // Lowest first — this list is a work queue, not a history.
    expect(items[0]).toHaveTextContent('Never answered the question asked.');
    expect(within(items[0]).getByRole('link', { name: d.focus.open })).toHaveAttribute(
      'href',
      '/interviews/i1',
    );
  });

  // "Work on this" took the bottom three unconditionally, so an account whose floor is an 80 was
  // shown its best answers under a remediation heading, with the commendation that earned the
  // mark printed as "the reason it was marked down".
  it('says the floor is solid rather than dressing an 80 up as a weakness', async () => {
    stub({
      questions: [
        question({ questionId: 'q1', score: 80, reason: 'Clear situation and result, with a metric.' }),
        question({ questionId: 'q2', score: 100, reason: 'Specific and attributable to you.' }),
      ],
    });
    await render();

    const focus = await screen.findByTestId('focus');
    expect(within(focus).queryByText(/Clear situation and result/)).toBeNull();
    expect(within(focus).getByTestId('focus-clear')).toHaveTextContent(
      copy(d.focus.clear, { ceiling: 60 }),
    );
    // A designed state, not a dead card: the archive is still reachable from it.
    expect(within(focus).getByRole('link', { name: d.focus.seeAll })).toHaveAttribute(
      'href',
      '/interviews?view=questions&sort=worst',
    );
  });

  it('offers to carry on an interview that is still open', async () => {
    stub({ runs: [run({ id: 'i7', state: 'paused', overallScore: null })] });
    await render();

    const card = await screen.findByTestId('carry-on');
    expect(within(card).getByRole('link', { name: d.carryOn.cta })).toHaveAttribute(
      'href',
      '/interviews/i7/room',
    );
  });

  // PRODUCT.md and the landing FAQ both promise a device check before a voice room opens, and
  // both resume links went straight to `/room` whatever the mode.
  it('resumes a voice interview through the device check, not straight into the room', async () => {
    stub({ runs: [run({ id: 'i7', state: 'paused', mode: 'voice', overallScore: null })] });
    await render();

    const card = await screen.findByTestId('carry-on');
    expect(within(card).getByRole('link', { name: d.carryOn.cta })).toHaveAttribute(
      'href',
      '/interviews/i7/pre-join',
    );
    // The row under it is the same link twice; SessionCard is also the archive's row.
    expect(
      within(screen.getByTestId('session-card')).getByRole('link', { name: d.session.continue }),
    ).toHaveAttribute('href', '/interviews/i7/pre-join');
  });

  // `abandoned` and `failed` rows used to offer Delete and nothing else, even though the
  // report route renders their transcript.
  it('lets an unfinished interview be read rather than only destroyed', async () => {
    stub({ runs: [run({ id: 'i9', state: 'abandoned', overallScore: null })] });
    await render();

    const card = await screen.findByTestId('session-card');
    expect(within(card).getByRole('link', { name: d.session.viewTranscript })).toHaveAttribute(
      'href',
      '/interviews/i9',
    );
  });

  it('confirms before deleting, then drops the row on the refetch', async () => {
    const calls = stub();
    await render();

    await screen.findByTestId('session-card');
    await act(async () => {
      await userEvent.click(
        screen.getByRole('button', { name: 'Delete the Backend developer interview' }),
      );
    });
    expect(calls.every((c) => c.method !== 'DELETE')).toBe(true);

    await act(async () => {
      await userEvent.click(screen.getByRole('button', { name: d.session.deleteConfirmAction }));
    });

    await waitFor(() =>
      expect(calls.some((c) => c.method === 'DELETE' && c.url === '/api/interviews/i1')).toBe(true),
    );
  });

  it('shows the runway, not an empty state, on day one', async () => {
    stub({ runs: [], questions: [] });
    await render();

    const runway = await screen.findByTestId('runway');
    expect(within(runway).getByText(d.runway.steps.cv.title)).toBeInTheDocument();
    // Profile and CV are already filled in this fixture, so only the interview step is open.
    expect(within(runway).getAllByText(d.runway.done)).toHaveLength(2);
    expect(within(runway).getByRole('link', { name: d.runway.steps.first.cta })).toHaveAttribute(
      'href',
      '/interviews/new',
    );
    expect(screen.queryByTestId('standing')).toBeNull();
  });

  it('carries sign-out on the rail, which the product never had anywhere', async () => {
    const calls = stub();
    await render();

    await act(async () => {
      await userEvent.click(screen.getByRole('button', { name: messages.nav.signOut }));
    });

    await waitFor(() =>
      expect(calls.some((c) => c.method === 'POST' && c.url === '/api/auth/logout')).toBe(true),
    );
    expect(replace).toHaveBeenCalledWith('/');
  });

  it('reaches profile and settings from the rail on every signed-in surface', async () => {
    stub();
    await render();

    expect(screen.getByRole('link', { name: messages.nav.profile })).toHaveAttribute(
      'href',
      '/profile',
    );
    expect(screen.getByRole('link', { name: messages.nav.settings })).toHaveAttribute(
      'href',
      '/settings',
    );
  });

  it('keeps the admin console out of a candidate’s rail', async () => {
    stub();
    await render();
    expect(screen.queryByRole('link', { name: messages.nav.admin })).toBeNull();
  });
});
