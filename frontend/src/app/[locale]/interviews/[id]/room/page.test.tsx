import { act, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { MockEventSource, installEventSourceMock } from '../../../../../test/event-source-mock';
import { messages, renderWithProviders } from '../../../../../test/render';

// One hoisted router object — `useRequireAuth` keys an effect on its identity (W04 trap).
const nav = vi.hoisted(() => ({
  push: vi.fn(),
  replace: vi.fn(),
  prefetch: vi.fn(),
  refresh: vi.fn(),
}));

vi.mock('next/navigation', async () => ({
  ...(await import('@/test/navigation')).serverNavigation,
  useRouter: () => nav,
  usePathname: () => '/interviews/i1/room',
  useParams: () => ({ id: 'i1' }),
}));

import RoomPage from './page';

const USER = { id: 'u1', email: 'someone@example.com', onboardingCompletedAt: 'now', interviewCount: 1 };

const PERSONAS = [
  {
    id: 'p-hr',
    role: 'hr',
    name: 'Ada',
    roundType: 'hr' as const,
    avatarSet: { idle: 'personas/p-hr/idle-a.webp', speaking: 'personas/p-hr/speaking-a.webp' },
  },
  {
    id: 'p-tech',
    role: 'tech',
    name: 'Turing',
    roundType: 'tech' as const,
    avatarSet: { idle: 'personas/p-tech/idle-a.webp' },
  },
];

function roomState(over: Record<string, unknown> = {}) {
  return {
    interviewId: 'i1',
    state: 'hr_round',
    mode: 'text',
    currentIndex: 1,
    targetQuestionCount: 8,
    endedReason: null,
    language: 'en',
    // S09: text carries the window too, and the server reports no ceiling for it.
    startedAt: new Date(Date.now() - 65_500).toISOString(),
    expiresAt: null,
    persona: { id: 'p-hr', role: 'hr', name: 'Ada', avatarState: 'idle' },
    personas: PERSONAS,
    currentQuestion: {
      id: 'q1',
      text: 'Tell me about yourself.',
      kind: 'text',
      widget: null,
      deliveredAt: '2026-08-04T10:00:00.000Z',
    },
    transcript: [],
    transcriptCursor: 0,
    ...over,
  };
}

interface Call {
  url: string;
  method: string;
  body: unknown;
}

/** `/me` gates the page; the state key is what every assertion here is really about. */
function stubFetch(options: { states?: Record<string, unknown>[]; answer?: { status: number; body: unknown } } = {}) {
  const calls: Call[] = [];
  const states = options.states ?? [roomState()];
  let stateHits = 0;

  const json = (status: number, body: unknown) =>
    new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      const method = init?.method ?? 'GET';
      const raw = init?.body;
      calls.push({ url, method, body: typeof raw === 'string' ? JSON.parse(raw) : (raw ?? null) });

      if (url === '/api/me') return json(200, { user: USER });
      if (url === '/api/interviews/i1/state') {
        const body = states[Math.min(stateHits, states.length - 1)];
        stateHits += 1;
        return json(200, body);
      }
      if (url === '/api/interviews/i1/answers') {
        return json(options.answer?.status ?? 200, options.answer?.body ?? { state: 'hr_round', nextIndex: 2 });
      }
      return json(404, { error: { code: 'NOT_FOUND' } });
    }),
  );

  return calls;
}

async function renderRoom() {
  await act(async () => {
    renderWithProviders(<RoomPage />);
  });
  await screen.findByTestId('interview-room');
}

describe('interview room, text mode (W06)', () => {
  beforeEach(() => {
    nav.push.mockReset();
    nav.replace.mockReset();
    installEventSourceMock();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it('renders both tiles with --live on the active speaker only', async () => {
    stubFetch();
    await renderRoom();

    const hr = screen.getByTestId('persona-tile-hr');
    const tech = screen.getByTestId('persona-tile-tech');
    expect(hr).toHaveAttribute('data-live', 'true');
    expect(tech).toHaveAttribute('data-live', 'false');
    expect(within(hr).getByText(messages.room.live)).toBeInTheDocument();
    expect(screen.getAllByText(messages.room.live)).toHaveLength(1);
    // The inactive tile is a roster row, not a second speaker: it never animates. The room has
    // no cameras, so the resolved avatar state now drives that persona's waveform, not an image.
    expect(within(tech).getByTestId('wave')).toHaveAttribute('data-avatar-state', 'idle');
  });

  // S09 — the ceiling bounds voice only, so a written interview gets no countdown and no
  // invented pressure. Elapsed is still the server's, so a reload does not restart it.
  it('shows no countdown, and an elapsed clock read from the server start', async () => {
    stubFetch();
    await renderRoom();

    expect(screen.queryByTestId('time-remaining')).not.toBeInTheDocument();
    expect(screen.getByTestId('room-elapsed')).toHaveTextContent('01:05');
  });

  it('re-renders from the refetched state after an SSE event, never from the event body', async () => {
    const calls = stubFetch({
      states: [
        roomState(),
        roomState({
          currentIndex: 2,
          persona: { id: 'p-tech', role: 'tech', name: 'Turing', avatarState: 'idle' },
          state: 'tech_round',
          currentQuestion: {
            id: 'q2',
            text: 'Explain an index.',
            kind: 'text',
            widget: null,
            deliveredAt: '2026-08-04T10:05:00.000Z',
          },
        }),
      ],
    });
    await renderRoom();
    expect(screen.getByTestId('persona-tile-hr')).toHaveAttribute('data-live', 'true');

    // A payload that contradicts the server: if the room read it, the tile would flip to a
    // persona the state endpoint never named.
    await act(async () => {
      MockEventSource.instances[0].emit(
        'INTERVIEW_STATE_CHANGED',
        JSON.stringify({ type: 'INTERVIEW_STATE_CHANGED', persona: { id: 'p-ghost', name: 'Ghost' } }),
      );
    });

    await waitFor(() =>
      expect(screen.getByTestId('persona-tile-tech')).toHaveAttribute('data-live', 'true'),
    );
    expect(screen.getByTestId('persona-tile-hr')).toHaveAttribute('data-live', 'false');
    expect(screen.queryByText('Ghost')).not.toBeInTheDocument();
    expect(calls.filter((c) => c.url === '/api/interviews/i1/state')).toHaveLength(2);
  });

  it('posts one text answer and clears the composer', async () => {
    const calls = stubFetch();
    const user = userEvent.setup();
    await renderRoom();

    const input = screen.getByLabelText(messages.room.answerLabel);
    await user.type(input, 'I ship things.');
    await user.click(screen.getByRole('button', { name: messages.room.submit }));

    await waitFor(() => expect(input).toHaveValue(''));
    const answers = calls.filter((c) => c.url === '/api/interviews/i1/answers');
    expect(answers).toHaveLength(1);
    expect(answers[0].body).toEqual({
      questionId: 'q1',
      transcript: 'I ship things.',
      inputMode: 'text',
    });
  });

  it('refetches silently on 409 QUESTION_NOT_CURRENT — no alert, no client-side advance', async () => {
    const second = roomState({
      currentIndex: 2,
      currentQuestion: {
        id: 'q2',
        text: 'Explain an index.',
        kind: 'text',
        widget: null,
        deliveredAt: '2026-08-04T10:05:00.000Z',
      },
    });
    const calls = stubFetch({
      states: [roomState(), second],
      answer: { status: 409, body: { error: { code: 'QUESTION_NOT_CURRENT' } } },
    });
    const user = userEvent.setup();
    await renderRoom();

    await user.type(screen.getByLabelText(messages.room.answerLabel), 'Late answer.');
    await user.click(screen.getByRole('button', { name: messages.room.submit }));

    await waitFor(() =>
      expect(calls.filter((c) => c.url === '/api/interviews/i1/state')).toHaveLength(2),
    );
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(screen.queryByText(/QUESTION_NOT_CURRENT/)).not.toBeInTheDocument();
    expect(nav.replace).not.toHaveBeenCalled();
    expect(calls.filter((c) => c.url === '/api/interviews/i1/answers')).toHaveLength(1);
  });

  // Issue 90: a refused answer keeps its text, deliberately — but it used to keep it across
  // the arrival of the *next* question, where pressing Send recorded it against a question
  // the candidate never read.
  it('empties the composer when the next question arrives', async () => {
    const calls = stubFetch({
      states: [
        roomState(),
        roomState({
          currentIndex: 2,
          currentQuestion: {
            id: 'q2',
            text: 'Explain an index.',
            kind: 'text',
            widget: null,
            deliveredAt: '2026-08-04T10:05:00.000Z',
          },
        }),
      ],
      answer: { status: 409, body: { error: { code: 'QUESTION_NOT_CURRENT' } } },
    });
    const user = userEvent.setup();
    await renderRoom();

    await user.type(screen.getByLabelText(messages.room.answerLabel), 'Late answer.');
    await user.click(screen.getByRole('button', { name: messages.room.submit }));

    await waitFor(() =>
      expect(calls.filter((c) => c.url === '/api/interviews/i1/state')).toHaveLength(2),
    );
    expect(screen.getByLabelText(messages.room.answerLabel)).toHaveValue('');
  });

  it('shows the waiting beat instead of a blank panel when a live round has no question', async () => {
    stubFetch({ states: [roomState({ currentQuestion: null })] });
    await renderRoom();

    expect(screen.getByTestId('question-waiting')).toHaveTextContent(messages.room.waiting);
    expect(screen.queryByTestId('answer-composer')).not.toBeInTheDocument();
    // Nothing is warmed: the tiles draw the speaker as bars, so an avatar preload could only
    // ever expire unused (issue 126).
    expect(document.querySelectorAll('link[rel="preload"][as="image"]').length).toBe(0);
  });

  it('renders the answered turns from state and leaves the report to W07', async () => {
    stubFetch({
      states: [
        roomState({
          transcript: [
            { questionId: 'q0', question: 'Warm up?', answer: 'Sure.', roundType: 'hr' },
          ],
          transcriptCursor: 1,
        }),
      ],
    });
    await renderRoom();

    const transcript = screen.getByTestId('transcript');
    expect(within(transcript).getByText('Warm up?')).toBeInTheDocument();
    expect(within(transcript).getByText('Sure.')).toBeInTheDocument();
  });

  it('routes to the report surface once the interview leaves the room', async () => {
    stubFetch({ states: [roomState({ state: 'evaluating', currentQuestion: null, persona: null })] });
    await act(async () => {
      renderWithProviders(<RoomPage />);
    });

    await waitFor(() => expect(nav.replace).toHaveBeenCalledWith('/interviews/i1'));
  });

  it('offers resume while paused and never a composer', async () => {
    const calls = stubFetch({ states: [roomState({ state: 'paused' })] });
    const user = userEvent.setup();
    await renderRoom();

    expect(screen.queryByTestId('answer-composer')).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: messages.room.resume }));
    await waitFor(() =>
      expect(calls.some((c) => c.url === '/api/interviews/i1/resume' && c.method === 'POST')).toBe(true),
    );
  });

  it('starts a room still parked in profiling instead of waiting on a batch nobody asked for', async () => {
    const calls = stubFetch({
      states: [roomState({ state: 'profiling', currentIndex: 0, currentQuestion: null, persona: null })],
    });
    await renderRoom();

    await waitFor(() =>
      expect(
        calls.filter((c) => c.url === '/api/interviews/i1/resume' && c.method === 'POST'),
      ).toHaveLength(1),
    );
  });

  // Issue #54's third acceptance criterion: a failed generation must reach the candidate as an
  // error, not as the waiting panel. The repair is the only thing that could fill this room, so
  // once it comes back red there is nothing left to wait out.
  it('surfaces the stall panel at once when the parked repair fails, not in 30 seconds', async () => {
    // The stub answers `/resume` with its 404 fallback — which failure it is does not matter.
    stubFetch({
      states: [roomState({ state: 'profiling', currentIndex: 0, currentQuestion: null, persona: null })],
    });
    await renderRoom();

    await waitFor(() => expect(screen.getByTestId('room-stalled')).toBeInTheDocument());
    expect(screen.getByRole('alert')).toHaveTextContent(messages.room.stalled);
    expect(screen.getByRole('button', { name: messages.room.retry })).toBeInTheDocument();
  });

  it('turns the waiting beat into a rebuild once nothing is generating', async () => {
    vi.useFakeTimers();
    const calls = stubFetch({ states: [roomState({ currentQuestion: null })] });
    await act(async () => {
      renderWithProviders(<RoomPage />);
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });

    // A batch can genuinely still be generating here — the state change is published when the
    // transition is claimed, not when the questions land — so the beat holds first.
    expect(screen.getByTestId('question-waiting')).toBeInTheDocument();
    expect(screen.queryByTestId('room-stalled')).not.toBeInTheDocument();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(30_000);
    });

    expect(screen.queryByTestId('question-waiting')).not.toBeInTheDocument();
    expect(screen.getByRole('alert')).toHaveTextContent(messages.room.stalled);

    await act(async () => {
      screen.getByRole('button', { name: messages.room.retry }).click();
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(calls.some((c) => c.url === '/api/interviews/i1/resume' && c.method === 'POST')).toBe(true);
  });

  it('types the question at 40 chars/sec', async () => {
    // The shared setup answers `prefers-reduced-motion: reduce`, which resolves every authored
    // motion in the app instantly — correct for tests about content, wrong for this one, which
    // is about the motion itself.
    vi.stubGlobal('matchMedia', ((query: string) => ({
      matches: false,
      media: query,
      addEventListener() {},
      removeEventListener() {},
      addListener() {},
      removeListener() {},
      dispatchEvent: () => false,
    })) as unknown as typeof window.matchMedia);
    vi.useFakeTimers();
    stubFetch();
    await act(async () => {
      renderWithProviders(<RoomPage />);
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });

    const typed = screen.getByTestId('question-typed');
    expect(typed).toHaveTextContent('');
    await act(async () => {
      await vi.advanceTimersByTimeAsync(250); // 10 chars at 40/sec
    });
    expect(typed.textContent).toBe('Tell me ab');
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000);
    });
    expect(typed.textContent).toBe('Tell me about yourself.');
  });
});
