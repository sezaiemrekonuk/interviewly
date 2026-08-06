import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, describe, expect, it, vi } from 'vitest';

import trMessages from '../../messages/tr.json';
import { mascotUrl } from '../components/mascot';
import { messages, renderWithIntl, renderWithProviders } from '../test/render';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), prefetch: vi.fn(), refresh: vi.fn() }),
  usePathname: () => '/',
}));

import styles from './page.module.css';
import Home from './page';

describe('landing (screen 1)', () => {
  it('renders the hero and the value props', () => {
    renderWithIntl(<Home />);
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(messages.landing.hero);
    expect(screen.getByText(messages.landing.subhead)).toBeInTheDocument();
    for (const prop of ['practice', 'feedback', 'progress'] as const) {
      expect(screen.getByText(messages.landing.props[prop].title)).toBeInTheDocument();
    }
  });

  it('shows a conversation preview with both personas, an answer and a scored tag', () => {
    renderWithIntl(<Home />);
    const preview = screen.getByTestId('conversation-preview');
    expect(within(preview).getByText(messages.landing.preview.hrChip)).toBeInTheDocument();
    expect(within(preview).getByText(messages.landing.preview.hrQuestion)).toBeInTheDocument();
    expect(within(preview).getByText(messages.landing.preview.techChip)).toBeInTheDocument();
    expect(within(preview).getByText(messages.landing.preview.techQuestion)).toBeInTheDocument();
    expect(within(preview).getByText(messages.landing.preview.answer)).toBeInTheDocument();
    expect(within(preview).getByText(messages.landing.preview.score)).toBeInTheDocument();
  });

  it('closes with a quiet CTA band that is not a second --primary', () => {
    const { container } = renderWithIntl(<Home />);
    expect(screen.getByText(messages.landing.closing.line)).toBeInTheDocument();
    const closing = container.querySelector(`.${styles.closingCta}`);
    expect(closing).toHaveAttribute('href', '/register');
    expect(closing).not.toHaveClass(styles.cta);
  });

  it('has exactly one --primary CTA and it links to /register', () => {
    const { container } = renderWithIntl(<Home />);
    const ctas = container.querySelectorAll(`.${styles.cta}`);
    expect(ctas).toHaveLength(1);
    expect(ctas[0]).toHaveAttribute('href', '/register');
    expect(ctas[0]).toHaveTextContent(messages.landing.cta);
  });

  it('shows the wave mascot', () => {
    const { container } = renderWithIntl(<Home />);
    const img = container.querySelector('img');
    expect(img).toHaveAttribute('src', mascotUrl('wave'));
  });

  it('resolves its copy in Turkish', () => {
    render(
      <NextIntlClientProvider locale="tr" messages={trMessages}>
        <Home />
      </NextIntlClientProvider>,
    );
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(trMessages.landing.hero);
    expect(screen.getByRole('link', { name: trMessages.landing.cta })).toBeInTheDocument();
    expect(screen.getByText(trMessages.landing.preview.hrChip)).toBeInTheDocument();
  });

  it('links both legal pages from the footer (issue 009)', () => {
    renderWithIntl(<Home />);

    expect(screen.getByRole('link', { name: messages.chrome.privacy })).toHaveAttribute(
      'href',
      '/privacy',
    );
    expect(screen.getByRole('link', { name: messages.chrome.terms })).toHaveAttribute(
      'href',
      '/terms',
    );
  });

  it('pulls no React Query into the landing tree (§8.1 JS budget)', () => {
    const source = readFileSync(join(__dirname, 'page.tsx'), 'utf8');
    expect(source).not.toContain('@tanstack/react-query');
    expect(source).not.toContain('./providers');

    // The switch is the boundary: a plain `/me` probe, and the authed half behind `import()`.
    const gate = readFileSync(
      join(__dirname, '..', 'components', 'home', 'home-switch.tsx'),
      'utf8',
    );
    expect(gate).not.toContain('@tanstack/react-query');
    expect(gate).toContain("import('./authed-home')");
  });
});

// --------------------------------------------------------------------------- W08

const PROFILE = { profile: { fullName: 'Deniz Yılmaz' }, onboardingCompletedAt: 'now', cvUploadId: null };

function row(over: Record<string, unknown> = {}) {
  return {
    id: 'i1',
    state: 'completed',
    mode: 'text',
    occupation: 'Backend developer',
    endedReason: 'completed',
    createdAt: '2026-08-01T10:00:00.000Z',
    startedAt: '2026-08-01T10:00:00.000Z',
    endedAt: '2026-08-01T10:30:00.000Z',
    ...over,
  };
}

interface Call {
  url: string;
  method: string;
}

/** `/me` 200 is what flips `/` to the signed-in home; the rest backs W08's list. */
function stubSignedIn(options: { pages?: unknown[]; profile?: unknown } = {}) {
  const calls: Call[] = [];
  const pages = options.pages ?? [{ items: [row()], nextCursor: null }];
  let listHits = 0;

  const json = (status: number, body: unknown) =>
    new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      const method = init?.method ?? 'GET';
      calls.push({ url, method });

      if (url === '/api/me') return json(200, { user: { id: 'u1', email: 'a@b.c' } });
      if (url === '/api/me/profile') return json(200, options.profile ?? PROFILE);
      if (url.startsWith('/api/me/interviews')) {
        const body = pages[Math.min(listHits, pages.length - 1)];
        listHits += 1;
        return json(200, body);
      }
      if (method === 'DELETE') return new Response(null, { status: 204 });
      return json(404, { error: { code: 'INTERVIEW_NOT_FOUND' } });
    }),
  );

  return calls;
}

async function renderSignedIn() {
  await act(async () => {
    renderWithProviders(<Home />);
  });
  await screen.findByTestId('authed-home');
}

describe('signed-in home — history (W08)', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('greets by first name and offers the one primary CTA to /interviews/new', async () => {
    stubSignedIn();
    await renderSignedIn();

    // The greeting resolves on `/me/profile`, one tick behind the list.
    await waitFor(() =>
      expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Deniz'),
    );
    expect(screen.queryByText(messages.landing.hero)).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: messages.home.newInterview })).toHaveAttribute(
      'href',
      '/interviews/new',
    );
  });

  it('falls back to the plain welcome when the profile carries no name', async () => {
    stubSignedIn({ profile: { profile: {}, onboardingCompletedAt: null, cvUploadId: null } });
    await renderSignedIn();

    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(messages.home.greetingPlain);
  });

  it('renders a completed row with a human state label and a report link', async () => {
    stubSignedIn();
    await renderSignedIn();

    const listRow = screen.getByTestId('interview-row');
    expect(within(listRow).getByText('Backend developer')).toBeInTheDocument();
    expect(within(listRow).getByText(messages.home.state.completed)).toBeInTheDocument();
    expect(within(listRow).getByRole('link', { name: messages.home.viewReport })).toHaveAttribute(
      'href',
      '/interviews/i1',
    );
    expect(listRow.textContent).not.toContain('completed');
  });

  it('offers Continue into the room for a resumable state', async () => {
    stubSignedIn({ pages: [{ items: [row({ id: 'i2', state: 'paused' })], nextCursor: null }] });
    await renderSignedIn();

    expect(screen.getByRole('link', { name: messages.home.continue })).toHaveAttribute(
      'href',
      '/interviews/i2/room',
    );
    expect(screen.queryByRole('link', { name: messages.home.viewReport })).not.toBeInTheDocument();
  });

  it('loads the next cursor page and never asks for an offset', async () => {
    const calls = stubSignedIn({
      pages: [
        { items: [row()], nextCursor: 'c2' },
        { items: [row({ id: 'i9', occupation: 'Data analyst' })], nextCursor: null },
      ],
    });
    await renderSignedIn();

    await act(async () => {
      await userEvent.click(screen.getByRole('button', { name: messages.home.loadMore }));
    });

    await screen.findByText('Data analyst');
    expect(calls.some((c) => c.url === '/api/me/interviews?cursor=c2')).toBe(true);
    expect(calls.every((c) => !c.url.includes('offset'))).toBe(true);
  });

  it('shows the designed shrug empty state with the setup CTA', async () => {
    stubSignedIn({ pages: [{ items: [], nextCursor: null }] });
    await renderSignedIn();

    const empty = await screen.findByTestId('history-empty');
    expect(within(empty).getByText(messages.home.empty.title)).toBeInTheDocument();
    expect(within(empty).getByText(messages.home.empty.body)).toBeInTheDocument();
    expect(within(empty).getByRole('link', { name: messages.home.empty.cta })).toHaveAttribute(
      'href',
      '/interviews/new',
    );
    expect(empty.querySelector('img')).toHaveAttribute('src', mascotUrl('shrug'));
  });

  it('confirms, DELETEs, and drops the row on the refetch', async () => {
    const calls = stubSignedIn({
      pages: [{ items: [row()], nextCursor: null }, { items: [], nextCursor: null }],
    });
    await renderSignedIn();

    await act(async () => {
      await userEvent.click(
        screen.getByRole('button', { name: 'Delete the Backend developer interview' }),
      );
    });
    // Confirm first: one click never destroys a row.
    expect(calls.every((c) => c.method !== 'DELETE')).toBe(true);

    await act(async () => {
      await userEvent.click(
        screen.getByRole('button', { name: messages.home.deleteConfirmAction }),
      );
    });

    await waitFor(() =>
      expect(calls.some((c) => c.method === 'DELETE' && c.url === '/api/interviews/i1')).toBe(true),
    );
    await waitFor(() => expect(screen.queryByTestId('interview-row')).not.toBeInTheDocument());
    expect(screen.getByTestId('history-empty')).toBeInTheDocument();
  });

  // Erasure moved to `/profile`, where the rest of the account lives — the signed-in home is
  // a place to start an interview. Covered by `app/profile/page.test.tsx`.
  it('does not offer account erasure on the signed-in home', async () => {
    stubSignedIn();
    await renderSignedIn();

    expect(screen.queryByTestId('delete-account')).toBeNull();
  });
});
