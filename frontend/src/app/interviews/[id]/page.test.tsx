import { act, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { MockEventSource, installEventSourceMock } from '../../../test/event-source-mock';
import { messages, renderWithProviders } from '../../../test/render';

const nav = vi.hoisted(() => ({
  push: vi.fn(),
  replace: vi.fn(),
  prefetch: vi.fn(),
  refresh: vi.fn(),
}));

vi.mock('next/navigation', () => ({
  useRouter: () => nav,
  usePathname: () => '/interviews/i1',
  useParams: () => ({ id: 'i1' }),
}));

import ReportPage from './page';

const USER = { id: 'u1', email: 'someone@example.com', onboardingCompletedAt: 'now', interviewCount: 1 };

const TRANSCRIPT = [
  { questionId: 'q1', question: 'Tell me about yourself.', answer: 'I ship things.', roundType: 'hr' as const },
];

function payload(over: Record<string, unknown> = {}) {
  return {
    overall_impression: 'Solid, structured answers.',
    overall_score: 4,
    strengths: ['Clear structure', 'Concrete examples'],
    improvements: ['More depth on trade-offs', 'Quantify impact'],
    rounds: [{ type: 'hr', score: 4, summary: 'Communicated well.' }],
    questions: [{ question_id: 'q1', score: 4, reason: 'Named a real outcome.', star_adherence: 0.8 }],
    language: 'en',
    ...over,
  };
}

function interviewState(over: Record<string, unknown> = {}) {
  return {
    interviewId: 'i1',
    state: 'completed',
    mode: 'text',
    currentIndex: 8,
    targetQuestionCount: 8,
    endedReason: null,
    language: 'en',
    persona: null,
    personas: [],
    currentQuestion: null,
    transcript: TRANSCRIPT,
    transcriptCursor: 1,
    ...over,
  };
}

interface Call {
  url: string;
  method: string;
}

/**
 * Two reads back this screen: `/interviews/:id` (the report) and `/interviews/:id/state`
 * (transcript + endedReason — the report read stays thin, ADR-W07).
 */
function stubFetch(options: { reports?: unknown[]; states?: unknown[] } = {}) {
  const calls: Call[] = [];
  const reports = options.reports ?? [{ interviewId: 'i1', state: 'completed', report: { status: 'ready', payload: payload() } }];
  const states = options.states ?? [interviewState()];
  let reportHits = 0;
  let stateHits = 0;

  const json = (status: number, body: unknown) =>
    new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      calls.push({ url, method: init?.method ?? 'GET' });

      if (url === '/api/me') return json(200, { user: USER });
      if (url === '/api/interviews/i1') {
        const body = reports[Math.min(reportHits, reports.length - 1)];
        reportHits += 1;
        return json(200, body);
      }
      if (url === '/api/interviews/i1/state') {
        const body = states[Math.min(stateHits, states.length - 1)];
        stateHits += 1;
        return json(200, body);
      }
      return json(404, { error: { code: 'NOT_FOUND' } });
    }),
  );

  return calls;
}

async function renderReport() {
  await act(async () => {
    renderWithProviders(<ReportPage />);
  });
  await screen.findByTestId('interview-report');
}

describe('report + transcript (W07)', () => {
  beforeEach(() => {
    nav.push.mockReset();
    nav.replace.mockReset();
    installEventSourceMock();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it('renders the ready report and the reused read-only transcript', async () => {
    stubFetch();
    await renderReport();

    expect(screen.getByTestId('report-score')).toHaveTextContent('4');
    expect(screen.getByText('Solid, structured answers.')).toBeInTheDocument();
    expect(screen.getByText('Clear structure')).toBeInTheDocument();
    expect(screen.getByText('More depth on trade-offs')).toBeInTheDocument();
    expect(screen.getByText('Communicated well.')).toBeInTheDocument();

    const transcript = screen.getByTestId('transcript');
    expect(within(transcript).getByText('Tell me about yourself.')).toBeInTheDocument();
    expect(within(transcript).getByText('I ship things.')).toBeInTheDocument();

    expect(screen.queryByTestId('report-wait')).not.toBeInTheDocument();
    expect(screen.queryByTestId('report-early-end')).not.toBeInTheDocument();
  });

  it('shows the generating beat while evaluating and resolves on an SSE nudge, never from the event body', async () => {
    const calls = stubFetch({
      reports: [
        { interviewId: 'i1', state: 'evaluating', report: null },
        { interviewId: 'i1', state: 'completed', report: { status: 'ready', payload: payload() } },
      ],
      states: [interviewState({ state: 'evaluating' }), interviewState()],
    });
    await renderReport();

    expect(screen.getByTestId('report-wait')).toHaveTextContent(messages.report.waitGenerating);
    expect(screen.queryByTestId('report-view')).not.toBeInTheDocument();

    // A payload that contradicts the server: if the screen read it, this score would render.
    await act(async () => {
      MockEventSource.instances[0].emit(
        'INTERVIEW_STATE_CHANGED',
        JSON.stringify({ type: 'INTERVIEW_STATE_CHANGED', report: { payload: payload({ overall_score: 1 }) } }),
      );
    });

    await waitFor(() => expect(screen.getByTestId('report-view')).toBeInTheDocument());
    expect(screen.getByTestId('report-score')).toHaveTextContent('4');
    expect(calls.filter((c) => c.url === '/api/interviews/i1')).toHaveLength(2);
  });

  it('polls as the fallback when the stream stays silent, and stops at the 60s ceiling', async () => {
    vi.useFakeTimers();
    const calls = stubFetch({
      reports: [{ interviewId: 'i1', state: 'evaluating', report: null }],
      states: [interviewState({ state: 'evaluating' })],
    });
    await act(async () => {
      renderWithProviders(<ReportPage />);
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(screen.getByTestId('report-wait')).toBeInTheDocument();

    const before = calls.filter((c) => c.url === '/api/interviews/i1').length;
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10_000);
    });
    const polled = calls.filter((c) => c.url === '/api/interviews/i1').length;
    expect(polled).toBeGreaterThan(before);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(60_000);
    });
    expect(screen.getByTestId('report-wait-timeout')).toHaveTextContent(messages.report.waitTimedOut);

    const atCeiling = calls.filter((c) => c.url === '/api/interviews/i1').length;
    await act(async () => {
      await vi.advanceTimersByTimeAsync(30_000);
    });
    expect(calls.filter((c) => c.url === '/api/interviews/i1')).toHaveLength(atCeiling);
  });

  it('states the interview ended early on a cut-short endedReason', async () => {
    stubFetch({ states: [interviewState({ endedReason: 'budget_exhausted' })] });
    await renderReport();

    expect(screen.getByTestId('report-early-end')).toHaveTextContent(messages.report.earlyEnd);
    expect(screen.getByTestId('report-view')).toBeInTheDocument();
  });

  it('renders the report shell for a completed interview with an empty transcript', async () => {
    stubFetch({ states: [interviewState({ transcript: [], transcriptCursor: 0 })] });
    await renderReport();

    expect(screen.getByTestId('report-view')).toBeInTheDocument();
    expect(screen.getByTestId('transcript')).toHaveTextContent(messages.room.transcriptEmpty);
  });
});
