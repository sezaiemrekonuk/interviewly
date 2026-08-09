import { act, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { messages, renderWithProviders } from '../../test/render';

const nav = vi.hoisted(() => ({ replace: vi.fn(), push: vi.fn(), search: '' }));
// One stable object, as Next's own `useRouter()` returns. `useRequireAuth` keys its effect on
// router identity, so a fresh object per call re-fires it on every commit — an infinite render
// loop that presents as a five-second timeout with no error.
const router = { ...nav, prefetch: vi.fn(), refresh: vi.fn() };
vi.mock('next/navigation', () => ({
  useRouter: () => router,
  useSearchParams: () => new URLSearchParams(nav.search),
  usePathname: () => '/interviews',
}));
const replace = nav.replace;

import InterviewsPage from './page';

const a = messages.archive;
const q = a.questions;
/**
 * Copy that has not landed in `messages/*.json` yet — the i18n merge owns those files. The cast
 * keeps `tsc` green now; the two cases below stay red until the strings arrive, which is the
 * point of writing them first.
 */
const pending = q as unknown as { starNotApplicable: string; starNote: string };

function question(over: Record<string, unknown> = {}) {
  return {
    questionId: 'q1',
    interviewId: 'i1',
    occupation: 'Backend developer',
    roundType: 'hr',
    text: 'Tell me about a deadline you missed.',
    answeredAt: '2026-08-01T10:00:00.000Z',
    durationMs: 40_000,
    score: 60,
    reason: 'Named the cause but not the fix.',
    starAdherence: 0.6,
    answerScores: null,
    ...over,
  };
}

const RUN = {
  id: 'i1',
  state: 'completed',
  mode: 'text',
  occupation: 'Backend developer',
  endedReason: 'completed',
  createdAt: '2026-08-01T10:00:00.000Z',
  startedAt: '2026-08-01T10:00:00.000Z',
  endedAt: '2026-08-01T10:30:00.000Z',
  overallScore: 4,
  roundScores: { hr: 4, tech: 3 },
};

function stub(options: { runs?: unknown[]; questions?: unknown[] } = {}) {
  const json = (status: number, body: unknown) =>
    new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      if (url === '/api/me')
        return json(200, {
          user: { id: 'u1', email: 'a@b.c', role: 'candidate', emailVerifiedAt: 'now' },
        });
      if (url.startsWith('/api/me/interviews'))
        return json(200, { items: options.runs ?? [RUN], nextCursor: null });
      if (url.startsWith('/api/me/questions'))
        return json(200, { items: options.questions ?? [question()], nextCursor: null });
      return json(404, { error: { code: 'UNKNOWN' } });
    }),
  );
}

/** The view and both filters live in the URL, so a case is "render at this address". */
async function renderAt(search = '', options?: Parameters<typeof stub>[0]) {
  nav.search = search;
  stub(options);
  await act(async () => {
    renderWithProviders(<InterviewsPage />);
  });
}

/** The question itself, row by row, in the order the table put them — not the reason under it. */
function questionTexts() {
  return screen
    .getAllByRole('row')
    .slice(1)
    .map((row) => within(row).getAllByRole('cell')[0].querySelector('p')?.textContent ?? '');
}

describe('/interviews — the archive', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    // `router` is one object shared by every case, so its spies are too.
    replace.mockClear();
    nav.search = '';
  });

  it('opens on sessions and switches to questions by writing the URL', async () => {
    await renderAt();

    await screen.findByText(RUN.occupation);
    expect(screen.queryByRole('table')).toBeNull();

    await act(async () => {
      await userEvent.click(screen.getByRole('button', { name: a.views.questions }));
    });
    expect(replace).toHaveBeenCalledWith('/interviews?view=questions');
  });

  // The toggle navigates. It is not a tab pattern, and claiming one promises `aria-controls`,
  // a tabpanel, roving tabindex and arrow keys that a `router.replace` cannot honour — while
  // the Round and Sort chips forty pixels below are the same control as `aria-pressed`.
  it('states the current view as a pressed button, not a tab', async () => {
    await renderAt('view=questions');

    const group = screen.getByRole('group', { name: a.viewLabel });
    expect(within(group).getByRole('button', { name: a.views.questions })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    expect(within(group).getByRole('button', { name: a.views.sessions })).toHaveAttribute(
      'aria-pressed',
      'false',
    );
    expect(screen.queryByRole('tab')).toBeNull();
    expect(screen.queryByRole('tablist')).toBeNull();
  });

  it('renders the question view at ?view=questions', async () => {
    await renderAt('view=questions');

    expect(await screen.findByRole('table')).toBeInTheDocument();
    expect(screen.getByText(question().text)).toBeInTheDocument();
    expect(screen.getByText(question().reason)).toBeInTheDocument();
  });

  it('filters to one round and keeps the view in the URL', async () => {
    await renderAt('view=questions', {
      questions: [question(), question({ questionId: 'q2', roundType: 'tech', text: 'Idempotent worker?' })],
    });

    await screen.findByRole('table');
    expect(questionTexts()).toHaveLength(2);

    await act(async () => {
      await userEvent.click(screen.getByRole('button', { name: messages.dashboard.rounds.tech }));
    });
    expect(replace).toHaveBeenCalledWith('/interviews?view=questions&round=tech');
  });

  it('shows only the filtered round at ?round=tech', async () => {
    await renderAt('view=questions&round=tech', {
      questions: [question(), question({ questionId: 'q2', roundType: 'tech', text: 'Idempotent worker?' })],
    });

    await screen.findByRole('table');
    expect(questionTexts()).toEqual(['Idempotent worker?']);
  });

  it('writes the sort to the URL', async () => {
    await renderAt('view=questions');

    await screen.findByRole('table');
    await act(async () => {
      await userEvent.click(screen.getByRole('button', { name: q.sorts.worst }));
    });
    expect(replace).toHaveBeenCalledWith('/interviews?view=questions&sort=worst');
  });

  // A question with no report is not a weakness, so "worst first" must not hand the least
  // informative rows the best seats.
  it('sorts worst first and puts unscored rows last', async () => {
    await renderAt('view=questions&sort=worst', {
      questions: [
        question({ questionId: 'q1', score: 80, text: 'Eighty' }),
        question({ questionId: 'q2', score: null, starAdherence: null, text: 'Unscored' }),
        question({ questionId: 'q3', score: 20, text: 'Twenty' }),
      ],
    });

    await screen.findByRole('table');
    expect(questionTexts()).toEqual(['Twenty', 'Eighty', 'Unscored']);
  });

  // STAR is a behavioural-story rubric. The backend scores it 0 on a technical question because
  // it never applied, and "0%" beside an 80 reads as broken scoring or an unnamed disaster.
  it('shows no STAR percentage on a technical row, and says why', async () => {
    await renderAt('view=questions', {
      questions: [
        question({ questionId: 'q2', roundType: 'tech', score: 80, starAdherence: 0, text: 'Idempotent worker?' }),
      ],
    });

    const row = (await screen.findAllByRole('row'))[1];
    expect(within(row).queryByText('0%')).toBeNull();
    expect(within(row).getByText(pending.starNotApplicable)).toBeInTheDocument();
    expect(screen.getByText(pending.starNote)).toBeInTheDocument();
  });

  it('keeps the STAR percentage on an HR row', async () => {
    await renderAt('view=questions');

    const row = (await screen.findAllByRole('row'))[1];
    expect(within(row).getByText('60%')).toBeInTheDocument();
    expect(within(row).queryByText(pending.starNotApplicable)).toBeNull();
    // Nothing to explain when no technical row is on screen.
    expect(screen.queryByText(pending.starNote)).toBeNull();
  });

  it('offers the empty state, not a blank surface, before the first interview', async () => {
    await renderAt('', { runs: [] });

    await waitFor(() => expect(screen.getByText(a.empty.sessions.title)).toBeInTheDocument());
    expect(screen.getByRole('link', { name: a.empty.sessions.cta })).toHaveAttribute(
      'href',
      '/interviews/new',
    );
  });
});
