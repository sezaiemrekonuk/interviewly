import { act, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { messages, renderWithProviders } from '../../test/render';

// Hoisted so `useRouter()` hands back the *same* object every render — a fresh one each
// time re-fires `useRequireAuth`'s effect forever and the render never settles.
const nav = vi.hoisted(() => ({
  push: vi.fn(),
  replace: vi.fn(),
  prefetch: vi.fn(),
  refresh: vi.fn(),
}));

vi.mock('next/navigation', () => ({
  useRouter: () => nav,
  usePathname: () => '/admin',
  useParams: () => ({}),
}));

import AdminPage from './page';

const ADMIN = {
  id: 'u1',
  email: 'admin@example.com',
  role: 'admin',
  locale: 'en',
  emailVerifiedAt: 'now',
  onboardingCompletedAt: 'now',
  interviewCount: 0,
};

function row(over: Record<string, unknown> = {}) {
  return {
    id: 'i1',
    userId: 'u9',
    state: 'completed',
    deleted: false,
    occupation: 'Backend engineer',
    occupationCluster: 'software',
    totalTokens: 4210,
    costUsd: '0.041200',
    ...over,
  };
}

const STATS = {
  averageDurationMs: 512000,
  completed: 12,
  cutShort: 3,
  unfinished: 4,
  totalTokens: 84210,
  perOccupation: [{ cluster: 'software', label: 'Backend engineer', count: 9 }],
  weakestQuestions: [
    { questionId: 'q-sql-joins', text: 'Explain the difference between an inner and an outer join.', score: 20 },
  ],
};

const ZEROED = {
  averageDurationMs: 0,
  completed: 0,
  cutShort: 0,
  unfinished: 0,
  totalTokens: 0,
  perOccupation: [],
  weakestQuestions: [],
};

interface Call {
  url: string;
  method: string;
}

function json(status: number, body: unknown) {
  return new Response(status === 204 ? null : JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

/**
 * `/admin/interviews` answers from a cursor map so the load-more assertion can prove the
 * second read carried `?cursor=`, not an offset.
 */
function stubFetch({
  user = ADMIN,
  first = { items: [row()], nextCursor: null as string | null },
  pages = {} as Record<string, unknown>,
  stats = STATS as unknown,
  adminStatus = 200,
}) {
  const calls: Call[] = [];

  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      calls.push({ url, method: init?.method ?? 'GET' });

      if (url === '/api/me') return json(200, { user });
      if (adminStatus !== 200) return json(adminStatus, { error: { code: 'FORBIDDEN' } });
      if (url.startsWith('/api/admin/interviews')) {
        const cursor = new URL(url, 'http://x').searchParams.get('cursor');
        return json(200, cursor ? (pages[cursor] ?? { items: [], nextCursor: null }) : first);
      }
      if (url === '/api/admin/stats') return json(200, stats);
      return json(404, { error: { code: 'NOT_FOUND' } });
    }),
  );

  return calls;
}

async function renderAdmin() {
  await act(async () => {
    renderWithProviders(<AdminPage />);
  });
}

describe('admin list + stats (W11)', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('renders a row per interview with the backend cost and token figures', async () => {
    stubFetch({
      first: {
        items: [row(), row({ id: 'i2', occupation: null, state: 'abandoned', totalTokens: 12 })],
        nextCursor: null,
      },
    });
    await renderAdmin();

    const rows = await screen.findAllByTestId('admin-interview-row');
    expect(rows).toHaveLength(2);
    expect(within(rows[0]).getByText('Backend engineer')).toBeInTheDocument();
    expect(within(rows[0]).getByText(messages.admin.state.completed)).toBeInTheDocument();
    // The six-decimal string is printed as returned — never re-rounded client-side.
    expect(within(rows[0]).getByText('0.041200')).toBeInTheDocument();
    expect(within(rows[0]).getByText('4,210')).toBeInTheDocument();
    expect(within(rows[1]).getByText(messages.admin.interviews.noOccupation)).toBeInTheDocument();
    expect(within(rows[1]).getByText(messages.admin.state.abandoned)).toBeInTheDocument();
  });

  it('flags a soft-deleted interview instead of hiding it', async () => {
    stubFetch({ first: { items: [row({ deleted: true })], nextCursor: null } });
    await renderAdmin();

    const first = (await screen.findAllByTestId('admin-interview-row'))[0];
    expect(
      within(first).getByText(messages.admin.interviews.deletedPill),
    ).toBeInTheDocument();
  });

  /**
   * `cost_usd` is NOT NULL and stores 0 when the model has no price row, which is
   * indistinguishable from free. Tokens burned with nothing charged is the unpriced case;
   * nothing burned at all is genuinely nothing spent, and 0.000000 is the truth there.
   */
  it('reads an unpriced cost as unknown, but still prints a real zero', async () => {
    stubFetch({
      first: {
        items: [
          row({ costUsd: '0.000000', totalTokens: 900 }),
          row({ id: 'i2', costUsd: '0.000000', totalTokens: 0 }),
        ],
        nextCursor: null,
      },
    });
    await renderAdmin();

    const rows = await screen.findAllByTestId('admin-interview-row');
    expect(within(rows[0]).queryByText('0.000000')).not.toBeInTheDocument();
    expect(rows[0].querySelector('[data-cost="unknown"]')).not.toBeNull();
    expect(within(rows[1]).getByText('0.000000')).toBeInTheDocument();
  });

  it('flags only the interview sitting at its budget ceiling', async () => {
    stubFetch({
      first: { items: [row(), row({ id: 'i2', costUsd: '0.500000' })], nextCursor: null },
    });
    await renderAdmin();

    const rows = await screen.findAllByTestId('admin-interview-row');
    expect(rows[0]).not.toHaveAttribute('data-budget');
    expect(rows[1]).toHaveAttribute('data-budget', 'ceiling');
  });

  it('renders the stats exactly as the endpoint returned them', async () => {
    stubFetch({});
    await renderAdmin();

    expect(await screen.findByTestId('admin-total-tokens')).toHaveTextContent('84,210');
    expect(screen.getByTestId('admin-avg-duration')).toHaveTextContent('8m 32s');

    const split = screen.getByTestId('admin-split');
    expect(within(split).getByText(messages.admin.stats.completed).nextSibling).toHaveTextContent('12');
    expect(within(split).getByText(messages.admin.stats.cutShort).nextSibling).toHaveTextContent('3');
    expect(within(split).getByText(messages.admin.stats.unfinished).nextSibling).toHaveTextContent('4');

    expect(within(screen.getByTestId('admin-occupations')).getByText('9')).toBeInTheDocument();
    // The question text, never the cuid: an id tells the operator nothing (issue 143).
    const weakest = within(screen.getByTestId('admin-weakest'));
    expect(weakest.getByText(STATS.weakestQuestions[0].text)).toBeInTheDocument();
    expect(weakest.queryByText('q-sql-joins')).not.toBeInTheDocument();
  });

  it('loads the next page from nextCursor, never an offset', async () => {
    const calls = stubFetch({
      first: { items: [row()], nextCursor: 'cur2' },
      pages: { cur2: { items: [row({ id: 'i2', occupation: 'Data analyst' })], nextCursor: null } },
    });
    await renderAdmin();
    await screen.findAllByTestId('admin-interview-row');

    await act(async () => {
      await userEvent.click(
        screen.getByRole('button', { name: messages.admin.interviews.loadMore }),
      );
    });

    await waitFor(() => expect(screen.getAllByTestId('admin-interview-row')).toHaveLength(2));
    const listCalls = calls.filter((c) => c.url.startsWith('/api/admin/interviews'));
    expect(listCalls[1].url).toBe('/api/admin/interviews?cursor=cur2');
    expect(listCalls.some((c) => /offset|page=/.test(c.url))).toBe(false);
    expect(
      screen.queryByRole('button', { name: messages.admin.interviews.loadMore }),
    ).not.toBeInTheDocument();
  });

  it('an empty platform shows the empty line and zeroed figures, not a spinner', async () => {
    stubFetch({ first: { items: [], nextCursor: null }, stats: ZEROED });
    await renderAdmin();

    expect(await screen.findByTestId('admin-table-empty')).toHaveTextContent(
      messages.admin.interviews.empty,
    );
    expect(screen.queryByTestId('admin-loading')).not.toBeInTheDocument();
    expect(screen.getByTestId('admin-total-tokens')).toHaveTextContent('0');
    expect(screen.getByTestId('admin-avg-duration')).toHaveTextContent('0m 0s');
    const split = screen.getByTestId('admin-split');
    expect(within(split).getByText(messages.admin.stats.completed).nextSibling).toHaveTextContent('0');
    // Per-occupation and weakest-questions both say it — a line, never a spinner.
    expect(screen.getAllByText(messages.admin.stats.empty)).toHaveLength(2);
    // Named, not just counted: the weakest list is the one issue 143 rebuilt, and its empty
    // branch has to stay a line rather than an empty <ul>.
    expect(screen.queryByTestId('admin-weakest')).not.toBeInTheDocument();
  });

  it('costs totals the priced rows on screen and leaves the unpriced one out', async () => {
    stubFetch({
      first: {
        items: [
          row({ costUsd: '0.041200' }),
          row({ id: 'i2', costUsd: '0.100000', occupationCluster: 'data' }),
          row({ id: 'i3', costUsd: '0.000000', totalTokens: 900 }),
        ],
        nextCursor: null,
      },
    });
    await renderAdmin();
    await screen.findAllByTestId('admin-interview-row');

    await act(async () => {
      await userEvent.click(screen.getByTestId('admin-nav-costs'));
    });

    // Summed as integer micro-dollars, and the unpriced row is excluded rather than
    // counted as free — 0.041200 + 0.100000, not 0.141200 out of three rows.
    expect(screen.getByText('0.141200')).toBeInTheDocument();
  });

  it('a section with no endpoint renders its Spec placeholder, not an empty table', async () => {
    stubFetch({});
    await renderAdmin();
    await screen.findAllByTestId('admin-interview-row');

    await act(async () => {
      await userEvent.click(screen.getByTestId('admin-nav-users'));
    });

    expect(screen.queryByRole('table')).not.toBeInTheDocument();
    expect(screen.queryByTestId('admin-interview-row')).not.toBeInTheDocument();
  });

  it('a non-admin sees the not-authorized card and no table, and asks for no admin data', async () => {
    const calls = stubFetch({ user: { ...ADMIN, role: 'candidate' } });
    await renderAdmin();

    expect(await screen.findByTestId('admin-forbidden')).toHaveTextContent(
      messages.admin.forbidden.title,
    );
    expect(screen.queryByTestId('admin-interview-row')).not.toBeInTheDocument();
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
    expect(calls.some((c) => c.url.startsWith('/api/admin'))).toBe(false);
  });

  it('the backend is the gate — a FORBIDDEN answer refuses a client-side admin too', async () => {
    stubFetch({ adminStatus: 403 });
    await renderAdmin();

    expect(await screen.findByTestId('admin-forbidden')).toHaveTextContent(
      messages.admin.forbidden.body,
    );
    expect(screen.queryByTestId('admin-interview-row')).not.toBeInTheDocument();
  });
});
