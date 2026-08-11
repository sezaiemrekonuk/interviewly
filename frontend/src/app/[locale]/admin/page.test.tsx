import { act, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { messages, renderWithProviders } from '../../../test/render';

// Hoisted so `useRouter()` hands back the *same* object every render — a fresh one each
// time re-fires `useRequireAuth`'s effect forever and the render never settles.
const nav = vi.hoisted(() => ({
  push: vi.fn(),
  replace: vi.fn(),
  prefetch: vi.fn(),
  refresh: vi.fn(),
}));

vi.mock('next/navigation', async () => ({
  ...(await import('@/test/navigation')).serverNavigation,
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
    userEmail: 'ada@example.com',
    state: 'completed',
    deleted: false,
    occupation: 'Backend engineer',
    occupationCluster: 'software',
    totalTokens: 4210,
    costUsd: '0.041200',
    budgetUsd: '0.500000',
    startedAt: '2026-08-11T09:00:00.000Z',
    createdAt: '2026-08-11T09:00:00.000Z',
    ...over,
  };
}

const CALL = {
  id: 'c1',
  interviewId: 'i1',
  provider: 'openai',
  model: 'gpt-4.1-mini',
  promptUuid: '11111111-2222-3333-4444-555555555555',
  promptVersion: 3,
  attemptNo: 1,
  fellBackFrom: null,
  units: '1200',
  unitKind: 'token',
  inputTokens: 800,
  outputTokens: 400,
  costUsd: '0.000400',
  latencyMs: 950,
  traceId: 'trace_1',
  createdAt: '2026-08-11T09:00:00.000Z',
};

const USER_ROW = {
  id: 'u9',
  email: 'ada@example.com',
  role: 'user',
  locale: 'en',
  emailVerified: true,
  onboarded: true,
  consentVersion: '2026-08-01',
  consentedAt: '2026-08-01T00:00:00.000Z',
  erased: false,
  interviewCount: 3,
  createdAt: '2026-08-01T00:00:00.000Z',
};

const SESSION_ROW = {
  id: 's1',
  userId: 'u9',
  userEmail: 'ada@example.com',
  role: 'user',
  active: true,
  revokedAt: null,
  expiresAt: '2026-09-11T09:00:00.000Z',
  createdAt: '2026-08-11T09:00:00.000Z',
};

const AUDIT_ROW = {
  id: 'a1',
  action: 'security.prompt_injection_suspected',
  actorUserId: 'u9',
  actorEmail: 'ada@example.com',
  actorRole: 'user',
  subjectType: 'interview',
  subjectId: 'i1',
  traceId: 'trace_1',
  metadata: { field: 'jobListing', patternId: 'ignore-previous-instructions' },
  createdAt: '2026-08-11T09:00:00.000Z',
};

const QUEUE = {
  queues: [
    { name: 'report', waiting: 2, active: 1, delayed: 0, failed: 1, completed: 40 },
  ],
  deadLetter: [
    {
      id: 'i7',
      interviewId: 'i7',
      attemptsMade: 3,
      failedReason: 'AI_PROVIDER_UNAVAILABLE',
      failedAt: '2026-08-11T08:00:00.000Z',
    },
  ],
};

const STATS = {
  averageDurationMs: 512000,
  completed: 12,
  cutShort: 3,
  unfinished: 4,
  totalTokens: 84210,
  totalCostUsd: '1.234560',
  perModel: [
    {
      provider: 'openai',
      model: 'gpt-4.1-mini',
      calls: 42,
      tokens: 84210,
      costUsd: '1.234560',
      averageLatencyMs: 950,
    },
  ],
  perOccupation: [{ cluster: 'software', label: 'Backend engineer', count: 9 }],
  weakestQuestions: [
    {
      text: 'Explain the difference between an inner and an outer join.',
      score: 20,
      sampleSize: 7,
    },
    // Same mean, one answer behind it. Issue 196 ships the count rather than filtering these
    // out, so the panel has to distinguish them.
    { text: 'Tell me about a deadline you missed.', score: 20, sampleSize: 1 },
  ],
};

const ZEROED = {
  averageDurationMs: 0,
  completed: 0,
  cutShort: 0,
  unfinished: 0,
  totalTokens: 0,
  totalCostUsd: '0.000000',
  perModel: [],
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
      if (url.startsWith('/api/admin/llm-calls'))
        return json(200, { items: [CALL], facets: [{ provider: 'openai', model: 'gpt-4.1-mini', count: 42 }], nextCursor: null });
      if (url.startsWith('/api/admin/users')) return json(200, { items: [USER_ROW], nextCursor: null });
      if (url.startsWith('/api/admin/sessions')) return json(200, { items: [SESSION_ROW], nextCursor: null });
      if (url.startsWith('/api/admin/audit'))
        return json(200, { items: [AUDIT_ROW], actions: [{ action: AUDIT_ROW.action, count: 1 }], nextCursor: null });
      if (url === '/api/admin/queue') return json(200, QUEUE);
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

    // Issue 196: two rows share a score of 20 and mean opposite things. Without the sample
    // count the panel presents one answer's 20 as the platform's weakest question.
    expect(weakest.getByText('Mean of 7 answers')).toBeInTheDocument();
    expect(weakest.getByText('From a single answer')).toBeInTheDocument();
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

  it('costs prints the platform total the backend computed, not a sum of the loaded rows', async () => {
    stubFetch({
      first: {
        items: [
          row({ costUsd: '0.041200' }),
          row({ id: 'i2', costUsd: '0.100000', occupationCluster: 'data' }),
        ],
        nextCursor: null,
      },
    });
    await renderAdmin();
    await screen.findAllByTestId('admin-interview-row');

    await act(async () => {
      await userEvent.click(screen.getByTestId('admin-nav-costs'));
    });

    // `/admin/stats.totalCostUsd`, printed verbatim. The two rows on screen add up to
    // 0.141200 and that is deliberately NOT the figure: the platform total is the platform's.
    const total = within(screen.getByTestId('admin-platform-spend'));
    expect(total.getByText(STATS.totalCostUsd)).toBeInTheDocument();
    expect(screen.queryByText('0.141200')).not.toBeInTheDocument();
    // Spend by model comes from the same endpoint rather than a hatched placeholder.
    expect(within(screen.getByTestId('admin-by-model')).getByText(/gpt-4\.1-mini/)).toBeInTheDocument();
  });

  it('opens the accounts section against its own endpoint, not an empty placeholder', async () => {
    const calls = stubFetch({});
    await renderAdmin();
    await screen.findAllByTestId('admin-interview-row');

    await act(async () => {
      await userEvent.click(screen.getByTestId('admin-nav-users'));
    });

    const rows = await screen.findAllByTestId('admin-user-row');
    expect(within(rows[0]).getByText(USER_ROW.email)).toBeInTheDocument();
    expect(calls.some((c) => c.url.startsWith('/api/admin/users'))).toBe(true);
  });

  it('fetches only the section on screen, never all eight endpoints at once', async () => {
    const calls = stubFetch({});
    await renderAdmin();
    await screen.findAllByTestId('admin-interview-row');

    // Overview reads the list and the stats. The other five sections are untouched until
    // one of them is opened — the console is not eight requests wide on load.
    for (const path of ['/api/admin/llm-calls', '/api/admin/users', '/api/admin/sessions', '/api/admin/audit', '/api/admin/queue'])
      expect(calls.some((c) => c.url.startsWith(path))).toBe(false);

    await act(async () => {
      await userEvent.click(screen.getByTestId('admin-nav-queue'));
    });
    await screen.findByTestId('admin-queue');
    expect(calls.some((c) => c.url === '/api/admin/queue')).toBe(true);
  });

  it('narrows the interview list through the backend, not in the browser', async () => {
    const calls = stubFetch({});
    await renderAdmin();
    await screen.findAllByTestId('admin-interview-row');

    await act(async () => {
      await userEvent.click(screen.getByTestId('admin-nav-interviews'));
    });
    await act(async () => {
      await userEvent.selectOptions(screen.getByTestId('admin-filter-state'), 'completed');
    });

    await waitFor(() =>
      expect(
        calls.some((c) => c.url.startsWith('/api/admin/interviews?') && c.url.includes('state=completed')),
      ).toBe(true),
    );
  });

  it('surfaces a recorded prompt-injection suspicion in the audit trail (US-29)', async () => {
    stubFetch({});
    await renderAdmin();
    await screen.findAllByTestId('admin-interview-row');

    await act(async () => {
      await userEvent.click(screen.getByTestId('admin-nav-audit'));
    });

    const rows = await screen.findAllByTestId('admin-audit-row');
    expect(
      within(rows[0]).getByText(messages.admin.audit.action.security_prompt_injection_suspected),
    ).toBeInTheDocument();
  });

  it('shows the report queue depth and its dead letter (issue 095)', async () => {
    stubFetch({});
    await renderAdmin();
    await screen.findAllByTestId('admin-interview-row');

    await act(async () => {
      await userEvent.click(screen.getByTestId('admin-nav-queue'));
    });

    const queue = within(await screen.findByTestId('admin-queue'));
    expect(queue.getByText(messages.admin.queue.waiting).nextSibling).toHaveTextContent('2');
    const dead = await screen.findAllByTestId('admin-deadletter-row');
    expect(within(dead[0]).getByText('AI_PROVIDER_UNAVAILABLE')).toBeInTheDocument();
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
