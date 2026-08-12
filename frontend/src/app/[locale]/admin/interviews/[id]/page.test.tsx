import { act, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { messages, renderWithProviders } from '../../../../../test/render';

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
  usePathname: () => '/admin/interviews/i1',
  useParams: () => ({ id: 'i1' }),
}));

import AdminInterviewDetailPage from './page';

const ADMIN = {
  id: 'u1',
  email: 'admin@example.com',
  role: 'admin',
  locale: 'en',
  emailVerifiedAt: 'now',
  onboardingCompletedAt: 'now',
  interviewCount: 0,
};

const INTERVIEW = {
  id: 'i1',
  userId: 'u9',
  userEmail: 'candidate@example.com',
  mode: 'voice',
  language: 'en',
  // Distinct on purpose: the state and the ended reason are two different facts, and
  // `completed`/`completed` would let one assertion pass on the other's cell.
  state: 'failed',
  endedReason: 'budget_exhausted',
  deleted: false,
  occupation: 'Backend engineer',
  occupationCluster: 'software',
  occupationLabel: 'Backend engineer',
  targetQuestionCount: 8,
  hrQuestionCount: 3,
  budgetUsd: '0.500000',
  spentUsd: '0.041200',
  elapsedSeconds: 512,
  createdAt: '2026-07-01T10:00:00.000Z',
  startedAt: '2026-07-01T10:01:00.000Z',
  endedAt: '2026-07-01T10:09:32.000Z',
  deletedAt: null,
  report: { status: 'ready', promptUuid: 'a1b2c3d4-5678-4321-9876-aabbccddeeff', promptVersion: 3 },
};

function call(over: Record<string, unknown> = {}) {
  return {
    id: 'c1',
    provider: 'openai',
    model: 'gpt-4o-mini',
    promptUuid: 'deadbeef-0000-4000-8000-000000000000',
    promptVersion: 2,
    attemptNo: 1,
    fellBackFrom: null,
    units: '1204',
    unitKind: 'token',
    inputTokens: 900,
    outputTokens: 304,
    costUsd: '0.012345',
    latencyMs: 812,
    traceId: 'tr-1',
    createdAt: '2026-07-01T10:02:00.000Z',
    ...over,
  };
}

/** A voice turn is billed per second and carries no tokens at all. */
const VOICE_CALL = call({
  id: 'c2',
  provider: 'elevenlabs',
  model: 'eleven-flash',
  units: '37',
  unitKind: 'second',
  inputTokens: null,
  outputTokens: null,
  costUsd: '0.004500',
});

function event(over: Record<string, unknown> = {}) {
  return {
    id: 'e1',
    action: 'security.prompt_injection_suspected',
    actorUserId: 'u9',
    traceId: 'tr-9',
    metadata: { questionIndex: 4, phrase: 'ignore your instructions' },
    createdAt: '2026-07-01T10:05:00.000Z',
    ...over,
  };
}

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

function stubFetch({
  user = ADMIN,
  detail = {
    interview: INTERVIEW,
    calls: [call()],
    callsTruncated: false,
    events: [event()],
  } as unknown,
  detailStatus = 200,
  detailCode = 'FORBIDDEN',
}) {
  const calls: Call[] = [];

  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      calls.push({ url, method: init?.method ?? 'GET' });

      if (url === '/api/me') return json(200, { user });
      if (url.startsWith('/api/admin/interviews/')) {
        return detailStatus === 200
          ? json(200, detail)
          : json(detailStatus, { error: { code: detailCode } });
      }
      return json(404, { error: { code: 'NOT_FOUND' } });
    }),
  );

  return calls;
}

async function renderDetail() {
  await act(async () => {
    renderWithProviders(<AdminInterviewDetailPage />);
  });
}

describe('admin per-call cost detail (US-26/28/29)', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('renders the interview, its calls and its events for an admin', async () => {
    stubFetch({
      detail: {
        interview: INTERVIEW,
        calls: [call()],
        callsTruncated: false,
        events: [event()],
      },
    });
    await renderDetail();

    const summary = within(await screen.findByTestId('admin-detail-summary'));
    expect(summary.getByText(INTERVIEW.userEmail)).toBeInTheDocument();
    expect(summary.getByText(messages.admin.detail.mode_voice)).toBeInTheDocument();
    expect(summary.getByText(messages.admin.state.failed)).toBeInTheDocument();
    expect(summary.getByText(messages.admin.endedReason.budget_exhausted)).toBeInTheDocument();
    // `stats.duration` over elapsedSeconds, and the HR/technical split off the counts.
    expect(summary.getByText('8m 32s')).toBeInTheDocument();
    expect(summary.getByText('3 HR, 5 technical')).toBeInTheDocument();
    // The tokens figure is the sum over the calls, not a field of its own.
    expect(summary.getByText('1,204')).toBeInTheDocument();

    // US-28's rollback handle: the whole prompt uuid, not a truncation.
    expect(await screen.findByTestId('admin-detail-report')).toHaveTextContent(
      `Prompt ${INTERVIEW.report.promptUuid} v3`,
    );

    const rows = screen.getAllByTestId('admin-detail-call');
    expect(rows).toHaveLength(1);
    expect(within(rows[0]).getByText('openai')).toBeInTheDocument();
    expect(within(rows[0]).getByText('gpt-4o-mini')).toBeInTheDocument();
    expect(within(rows[0]).getByText('812 ms')).toBeInTheDocument();

    const events = screen.getAllByTestId('admin-detail-event');
    expect(events).toHaveLength(1);
    // The wire writes dots, the message key carries underscores.
    expect(
      within(events[0]).getByText(messages.admin.audit.action.security_prompt_injection_suspected),
    ).toBeInTheDocument();
    // Metadata as readable pairs — never a JSON blob in the cell.
    expect(events[0]).toHaveTextContent('questionIndex');
    expect(events[0]).toHaveTextContent('ignore your instructions');
    expect(events[0].textContent).not.toContain('{"');
  });

  it('keeps a per-second voice call as its own row instead of folding it into tokens', async () => {
    stubFetch({
      detail: {
        interview: INTERVIEW,
        calls: [call(), VOICE_CALL],
        callsTruncated: false,
        events: [],
      },
    });
    await renderDetail();

    const rows = await screen.findAllByTestId('admin-detail-call');
    expect(rows).toHaveLength(2);
    expect(within(rows[1]).getByText(`37 ${messages.admin.calls.unit.second}`)).toBeInTheDocument();
    // No token count invented for a call that reported none.
    expect(within(rows[1]).getByText('—')).toBeInTheDocument();
    expect(screen.getByTestId('admin-detail-summary')).toHaveTextContent('1,204');
  });

  it('prints the six-decimal cost strings exactly as the backend returned them', async () => {
    stubFetch({
      detail: {
        interview: INTERVIEW,
        calls: [call(), VOICE_CALL],
        callsTruncated: false,
        events: [],
      },
    });
    await renderDetail();

    const rows = await screen.findAllByTestId('admin-detail-call');
    expect(within(rows[0]).getByText('0.012345')).toBeInTheDocument();
    expect(within(rows[1]).getByText('0.004500')).toBeInTheDocument();
    const summary = within(screen.getByTestId('admin-detail-summary'));
    expect(summary.getByText('0.041200')).toBeInTheDocument();
    expect(summary.getByText('0.500000')).toBeInTheDocument();
  });

  it('says so when the call list was truncated, and when there is nothing to show', async () => {
    stubFetch({
      detail: { interview: INTERVIEW, calls: [call()], callsTruncated: true, events: [] },
    });
    await renderDetail();

    expect(await screen.findByText('Only the first 1 calls are shown.')).toBeInTheDocument();
    expect(screen.getByText(messages.admin.detail.eventsEmpty)).toBeInTheDocument();
    expect(screen.queryByTestId('admin-detail-event')).not.toBeInTheDocument();
  });

  it('a non-admin sees the not-authorized card and asks for no admin data', async () => {
    const calls = stubFetch({ user: { ...ADMIN, role: 'candidate' } });
    await renderDetail();

    expect(await screen.findByTestId('admin-forbidden')).toHaveTextContent(
      messages.admin.forbidden.title,
    );
    expect(screen.queryByTestId('admin-detail-call')).not.toBeInTheDocument();
    expect(calls.some((c) => c.url.startsWith('/api/admin'))).toBe(false);
    expect(nav.replace).not.toHaveBeenCalled();
  });

  it('the backend is the gate — a FORBIDDEN answer refuses a client-side admin too', async () => {
    stubFetch({ detailStatus: 403 });
    await renderDetail();

    expect(await screen.findByTestId('admin-forbidden')).toHaveTextContent(
      messages.admin.forbidden.body,
    );
  });

  it('an unknown interview renders the not-found line, not an empty summary', async () => {
    stubFetch({ detailStatus: 404, detailCode: 'INTERVIEW_NOT_FOUND' });
    await renderDetail();

    expect(await screen.findByTestId('admin-detail-notfound')).toHaveTextContent(
      messages.admin.detail.notFound,
    );
    expect(screen.queryByTestId('admin-detail-summary')).not.toBeInTheDocument();
    expect(screen.queryByTestId('admin-loading')).not.toBeInTheDocument();
  });
});
