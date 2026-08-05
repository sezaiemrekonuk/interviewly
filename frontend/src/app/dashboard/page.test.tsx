import { act, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { messages, renderWithProviders } from '../../test/render';

const nav = vi.hoisted(() => ({
  push: vi.fn(),
  replace: vi.fn(),
  prefetch: vi.fn(),
  refresh: vi.fn(),
}));

vi.mock('next/navigation', () => ({
  useRouter: () => nav,
  usePathname: () => '/dashboard',
  useParams: () => ({}),
}));

import DashboardPage from './page';

const USER = {
  id: 'u1',
  email: 'someone@example.com',
  role: 'candidate',
  locale: 'en',
  emailVerifiedAt: 'now',
  onboardingCompletedAt: 'now',
  interviewCount: 2,
};

function row(over: Record<string, unknown> = {}) {
  return {
    id: 'i1',
    state: 'completed',
    mode: 'text',
    occupation: 'Backend engineer',
    endedReason: 'completed',
    createdAt: '2026-07-01T10:00:00.000Z',
    startedAt: '2026-07-01T10:00:00.000Z',
    endedAt: '2026-07-01T10:30:00.000Z',
    ...over,
  };
}

interface Call {
  url: string;
  method: string;
}

/**
 * `/me/interviews` answers from a queue: one entry per read, the last one repeating. That
 * is what lets a test assert the *refetch* after a delete rather than the first page.
 */
function stubFetch(pages: unknown[]) {
  const calls: Call[] = [];
  const byCursor = new Map<string, unknown>();
  let hits = 0;

  const json = (status: number, body: unknown) =>
    new Response(body === null ? null : JSON.stringify(body), {
      status,
      headers: { 'content-type': 'application/json' },
    });

  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      calls.push({ url, method: init?.method ?? 'GET' });

      if (url === '/api/me') return json(200, { user: USER });
      if (url.startsWith('/api/me/interviews')) {
        const cursor = new URL(url, 'http://x').searchParams.get('cursor');
        if (cursor) return json(200, byCursor.get(cursor) ?? { items: [], nextCursor: null });
        const body = pages[Math.min(hits, pages.length - 1)];
        hits += 1;
        return json(200, body);
      }
      if (url === '/api/interviews/i1' && init?.method === 'DELETE') return json(204, null);
      return json(404, { error: { code: 'NOT_FOUND' } });
    }),
  );

  return { calls, page2: (cursor: string, body: unknown) => byCursor.set(cursor, body) };
}

async function renderDashboard() {
  await act(async () => {
    renderWithProviders(<DashboardPage />);
  });
}

describe('dashboard / history (W08)', () => {
  beforeEach(() => {
    nav.push.mockReset();
    nav.replace.mockReset();
  });

  afterEach(() => vi.unstubAllGlobals());

  it('renders a row per interview, linking to its report', async () => {
    stubFetch([
      {
        items: [row(), row({ id: 'i2', occupation: 'Data analyst', endedReason: 'cut_short' })],
        nextCursor: null,
      },
    ]);
    await renderDashboard();

    const rows = await screen.findAllByTestId('interview-row');
    expect(rows).toHaveLength(2);
    expect(within(rows[0]).getByRole('link')).toHaveAttribute('href', '/interviews/i1');
    expect(within(rows[0]).getByText(/Backend engineer/)).toBeInTheDocument();
    expect(within(rows[0]).getByText(new RegExp(messages.dashboard.outcome.completed))).toBeInTheDocument();
    expect(within(rows[1]).getByRole('link')).toHaveAttribute('href', '/interviews/i2');
    expect(within(rows[1]).getByText(new RegExp(messages.dashboard.outcome.cut_short))).toBeInTheDocument();
  });

  it('an interview still being evaluated links to the report anyway, with its own word', async () => {
    stubFetch([
      { items: [row({ state: 'evaluating', endedReason: null })], nextCursor: null },
    ]);
    await renderDashboard();

    const first = (await screen.findAllByTestId('interview-row'))[0];
    expect(within(first).getByRole('link')).toHaveAttribute('href', '/interviews/i1');
    expect(within(first).getByText(new RegExp(messages.dashboard.outcome.evaluating))).toBeInTheDocument();
  });

  it('loads the next page from nextCursor, never an offset', async () => {
    const stub = stubFetch([{ items: [row()], nextCursor: 'cur2' }]);
    stub.page2('cur2', { items: [row({ id: 'i2', occupation: 'Data analyst' })], nextCursor: null });
    await renderDashboard();
    await screen.findAllByTestId('interview-row');

    await act(async () => {
      await userEvent.click(screen.getByRole('button', { name: messages.dashboard.loadMore }));
    });

    await waitFor(() => expect(screen.getAllByTestId('interview-row')).toHaveLength(2));
    const listCalls = stub.calls.filter((c) => c.url.startsWith('/api/me/interviews'));
    expect(listCalls[1].url).toBe('/api/me/interviews?cursor=cur2');
    expect(listCalls.some((c) => /offset|page=/.test(c.url))).toBe(false);
    expect(screen.queryByRole('button', { name: messages.dashboard.loadMore })).not.toBeInTheDocument();
  });

  it('an empty list is the designed shrug empty state, not a bare "no results"', async () => {
    stubFetch([{ items: [], nextCursor: null }]);
    await renderDashboard();

    const empty = await screen.findByTestId('dashboard-empty');
    expect(within(empty).getByText(messages.dashboard.empty.title)).toBeInTheDocument();
    expect(within(empty).getByRole('link', { name: messages.dashboard.empty.cta })).toHaveAttribute(
      'href',
      '/interviews/new',
    );
    expect(within(empty).getByRole('img')).toHaveAttribute(
      'src',
      expect.stringContaining('mascot/shrug-'),
    );
  });

  it('delete calls DELETE and drops the row on the refetch, not before it', async () => {
    const stub = stubFetch([
      { items: [row(), row({ id: 'i2', occupation: 'Data analyst' })], nextCursor: null },
      { items: [row({ id: 'i2', occupation: 'Data analyst' })], nextCursor: null },
    ]);
    await renderDashboard();
    expect(await screen.findAllByTestId('interview-row')).toHaveLength(2);

    await act(async () => {
      await userEvent.click(screen.getAllByRole('button', { name: messages.dashboard.deleteLabel })[0]);
    });

    await waitFor(() => expect(screen.getAllByTestId('interview-row')).toHaveLength(1));
    const del = stub.calls.filter((c) => c.method === 'DELETE');
    expect(del).toEqual([{ url: '/api/interviews/i1', method: 'DELETE' }]);
    expect(screen.getByText(/Data analyst/)).toBeInTheDocument();
  });

  it('a refused delete leaves the row in place — no optimistic removal', async () => {
    const stub = stubFetch([{ items: [row()], nextCursor: null }]);
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init?: RequestInit) => {
        stub.calls.push({ url, method: init?.method ?? 'GET' });
        const json = (status: number, body: unknown) =>
          new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
        if (url === '/api/me') return json(200, { user: USER });
        if (url.startsWith('/api/me/interviews')) return json(200, { items: [row()], nextCursor: null });
        return json(403, { error: { code: 'FORBIDDEN' } });
      }),
    );
    await renderDashboard();
    await screen.findAllByTestId('interview-row');

    await act(async () => {
      await userEvent.click(screen.getByRole('button', { name: messages.dashboard.deleteLabel }));
    });

    expect(screen.getAllByTestId('interview-row')).toHaveLength(1);
    expect(stub.calls.filter((c) => c.method === 'DELETE')).toHaveLength(1);
  });

  it('renders the error code from the registry, never a raw code', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        const json = (status: number, body: unknown) =>
          new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
        if (url === '/api/me') return json(200, { user: USER });
        return json(429, { error: { code: 'RATE_LIMITED' } });
      }),
    );
    await renderDashboard();

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(messages.errors.RATE_LIMITED);
  });
});
