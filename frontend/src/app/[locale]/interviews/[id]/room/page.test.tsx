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

/**
 * C02 — one utterance. The conversation is the interview's state now, so a fixture without one
 * is a room that never said anything: `askedCurrent` would be null, the avatar would sit on
 * `speaking` forever and the main column would render the empty-conversation copy.
 */
function turn(
  id: string,
  role: 'user' | 'assistant' | 'system',
  content: string,
  over: { action?: string | null; questionId?: string | null } = {},
) {
  return {
    id,
    role,
    content,
    action: over.action ?? (role === 'assistant' ? 'continue' : null),
    questionId: over.questionId ?? null,
    createdAt: '2026-08-04T10:00:00.000Z',
  };
}

/**
 * The room as the candidate meets it mid-interview: greeted, one exchange, and asked `q1` —
 * the shape a pair-based transcript cannot hold, which is the whole reason C01 stores it.
 */
const OPENING = [
  turn('m1', 'assistant', "Hi, I'm Ada. Thanks for making the time."),
  turn('m2', 'user', 'Happy to be here.'),
  turn('m3', 'assistant', 'Tell me about yourself.', { action: 'next_question', questionId: 'q1' }),
];

/** The same room one turn on: the candidate answered and the interviewer moved to `q2`. */
const NEXT_QUESTION = [
  ...OPENING,
  turn('m4', 'user', 'I ship things.', { questionId: 'q1' }),
  turn('m5', 'assistant', 'Explain an index.', { action: 'next_question', questionId: 'q2' }),
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
    // S09: text carries the window too, and the server reports no ceiling for it. I16: elapsed
    // is the server's active-time figure, so `startedAt` no longer feeds the rail — an hour-old
    // start with 65 s of room time reads 01:05, which is the whole point of the change.
    startedAt: new Date(Date.now() - 3_600_000).toISOString(),
    elapsedSeconds: 65,
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
    // Both, and they are not the same view: `transcript` is the answered pairs the report reads
    // (still served, still `Transcript`'s shape), `messages` is what was actually said (C01).
    transcript: [],
    messages: OPENING,
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
function stubFetch(
  options: {
    states?: Record<string, unknown>[];
    /** `POST /turns` (C02), which replaced `/answers` as the room's write. */
    turn?: { status: number; body: unknown };
    /** Left to the 404 fallback where the scenario is about the repair failing. */
    resume?: { status: number; body: unknown };
    /** `POST /abandon` (issue 104) — the room's Leave, once confirmed. */
    abandon?: { status: number; body: unknown };
  } = {},
) {
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
      if (url === '/api/interviews/i1/turns') {
        return json(options.turn?.status ?? 200, options.turn?.body ?? { state: 'hr_round', currentIndex: 1 });
      }
      if (url === '/api/interviews/i1/resume' && options.resume) {
        return json(options.resume.status, options.resume.body);
      }
      if (url === '/api/interviews/i1/abandon') {
        return json(options.abandon?.status ?? 200, options.abandon?.body ?? { state: 'abandoned' });
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
    expect(screen.queryByText(messages.room.live)).not.toBeInTheDocument();
    // The inactive tile is a roster row, not a second speaker: it never animates. The room has
    // no cameras, so the resolved avatar state now drives that persona's waveform, not an image.
    expect(within(tech).getByTestId('wave')).toHaveAttribute('data-avatar-state', 'idle');
  });

  // S09 — the ceiling bounds voice only, so a written interview gets no countdown and no
  // invented pressure. I16 — elapsed is the server's active-time figure: this interview started
  // an hour ago and has 65 s of room time, and 01:05 is what the candidate is owed.
  it('shows no countdown, and an elapsed clock read from the server active time', async () => {
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
          // A handover writes two assistant lines in one turn — the outgoing interviewer's
          // closing sentence and the incoming one's question. Only `messages` can hold that.
          messages: [
            ...OPENING,
            turn('m4', 'user', 'I ship things.', { questionId: 'q1' }),
            turn('m5', 'assistant', "That's HR done — over to Turing.", { action: 'handover' }),
            turn('m6', 'assistant', 'Explain an index.', {
              action: 'next_question',
              questionId: 'q2',
            }),
          ],
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

  // C02 — the composer posts a *turn*, and a turn names no question on purpose. Sending one
  // would be the client asserting "this closes q1, advance", which is the conductor's call and
  // not the room's (K11). A body that grew a `questionId` back would compile and pass every
  // type in the repo, so this is the only place that catches it.
  it('posts one turn, names no question, and clears the composer', async () => {
    const calls = stubFetch();
    const user = userEvent.setup();
    await renderRoom();

    const input = screen.getByLabelText(messages.room.answerLabel);
    await user.type(input, 'I ship things.');
    await user.click(screen.getByRole('button', { name: messages.room.submit }));

    await waitFor(() => expect(input).toHaveValue(''));
    const turns = calls.filter((c) => c.url === '/api/interviews/i1/turns');
    expect(turns).toHaveLength(1);
    expect(turns[0].body).toEqual({ text: 'I ship things.', inputMode: 'text' });
    // The one-answer-one-advance route still exists and is still the acceptance suite's (C06);
    // the room is simply no longer one of its callers.
    expect(calls.some((c) => c.url === '/api/interviews/i1/answers')).toBe(false);
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
      messages: NEXT_QUESTION,
    });
    const calls = stubFetch({
      states: [roomState(), second],
      turn: { status: 409, body: { error: { code: 'QUESTION_NOT_CURRENT' } } },
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
    expect(calls.filter((c) => c.url === '/api/interviews/i1/turns')).toHaveLength(1);
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
          messages: NEXT_QUESTION,
        }),
      ],
      turn: { status: 409, body: { error: { code: 'QUESTION_NOT_CURRENT' } } },
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

  // The waiting *panel* was text mode's answer to `currentQuestion: null`, and C02 took the
  // panel away — the main column is the conversation now. What must not come back is the
  // composer: a Send with no question behind it posts a turn into a round that has nothing to
  // put it against, and the conversation must stay on screen so the room is not a blank page
  // for the 30 seconds before the stall notice.
  it('keeps the conversation and drops the composer when a live round has no question', async () => {
    stubFetch({ states: [roomState({ currentQuestion: null })] });
    await renderRoom();

    expect(screen.queryByTestId('answer-composer')).not.toBeInTheDocument();
    const conversation = screen.getByTestId('conversation');
    expect(within(conversation).getByText('Tell me about yourself.')).toBeInTheDocument();
    // Nothing is warmed: the tiles draw the speaker as bars, so an avatar preload could only
    // ever expire unused (issue 126).
    expect(document.querySelectorAll('link[rel="preload"][as="image"]').length).toBe(0);
  });

  // C02 — text mode IS the conversation: the interviewer's lines and the candidate's, in order,
  // including the greeting that belongs to no question. The side transcript panel next to it
  // would be the same content twice, so the room does not render one; `Transcript` still exists
  // and the report page (W07) is still its only caller.
  it('renders the conversation from state, and no second transcript panel beside it', async () => {
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

    const conversation = screen.getByTestId('conversation');
    expect(within(conversation).getByText("Hi, I'm Ada. Thanks for making the time.")).toBeInTheDocument();
    expect(within(conversation).getByText('Happy to be here.')).toBeInTheDocument();
    expect(within(conversation).getByText('Tell me about yourself.')).toBeInTheDocument();
    expect(screen.queryByTestId('transcript')).not.toBeInTheDocument();
    // `transcript` is still served and still a different view — pairs, for the report. Rendering
    // it here would show 'Warm up?', a question this conversation never contains.
    expect(screen.queryByText('Warm up?')).not.toBeInTheDocument();
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

  // Issue 89: a room that has not started, a round whose batch never landed and a genuine
  // handover used to render the same optimistic placeholder — which is why three different
  // backend failures were one indistinguishable screen. `created` had no branch at all.
  it.each(['created', 'profiling'])('names a room parked in %s while it starts it', async (state) => {
    const calls = stubFetch({
      states: [roomState({ state, currentIndex: 0, currentQuestion: null, persona: null })],
      resume: { status: 200, body: { state: 'hr_round' } },
    });
    await renderRoom();

    await waitFor(() =>
      expect(
        calls.filter((c) => c.url === '/api/interviews/i1/resume' && c.method === 'POST'),
      ).toHaveLength(1),
    );
    expect(screen.getByTestId('room-starting')).toHaveTextContent(messages.room.starting);
    // Not "Preparing the next question…": there is no next question in a room with no first one.
    expect(screen.queryByTestId('question-waiting')).not.toBeInTheDocument();
    // Nor "Question 0 of 8", a count no healthy interview ever reaches.
    expect(screen.getByText(messages.room.notStarted)).toBeInTheDocument();
    expect(screen.queryByText(/Question 0 of/)).not.toBeInTheDocument();
  });

  // The technical round is stranded by the same failure one round over — a pause that could not
  // be written — and the wait budget used to watch only the HR round.
  it('stalls a technical round with no question, the same as an HR round', async () => {
    vi.useFakeTimers();
    const calls = stubFetch({
      states: [
        roomState({
          state: 'tech_round',
          currentIndex: 5,
          currentQuestion: null,
          messages: [...OPENING, turn('m4', 'assistant', 'Over to Turing.', { action: 'handover' })],
        }),
      ],
    });
    await act(async () => {
      renderWithProviders(<RoomPage />);
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });

    // A batch can genuinely still be generating, so the wait holds for the budget first: the
    // handover line is on screen and nothing has been called broken yet.
    expect(screen.queryByTestId('room-stalled')).not.toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(30_000);
    });

    expect(screen.getByTestId('room-stalled')).toBeInTheDocument();
    await act(async () => {
      screen.getByRole('button', { name: messages.room.retry }).click();
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(calls.some((c) => c.url === '/api/interviews/i1/resume' && c.method === 'POST')).toBe(
      true,
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

  it('turns a quiet wait into a rebuild once nothing is generating', async () => {
    vi.useFakeTimers();
    const calls = stubFetch({ states: [roomState({ currentQuestion: null })] });
    await act(async () => {
      renderWithProviders(<RoomPage />);
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });

    // A batch can genuinely still be generating here — the state change is published when the
    // transition is claimed, not when the questions land — so the room waits it out first, with
    // the conversation on screen and nothing red on it.
    expect(screen.getByTestId('conversation')).toBeInTheDocument();
    expect(screen.queryByTestId('room-stalled')).not.toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(30_000);
    });

    expect(screen.getByTestId('room-stalled')).toBeInTheDocument();
    expect(screen.getByRole('alert')).toHaveTextContent(messages.room.stalled);

    await act(async () => {
      screen.getByRole('button', { name: messages.room.retry }).click();
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(calls.some((c) => c.url === '/api/interviews/i1/resume' && c.method === 'POST')).toBe(true);
  });

  // 'types the question at 40 chars/sec' lived here and was deleted with C02. The room mounts
  // no `QuestionPanel` in text mode at all now — the question arrives inside the conversation —
  // and the voice caption is mounted `instant`, so neither mode has a typewriter left to assert
  // from. `question-panel.tsx` still owns the animation for whoever mounts it non-instant; it
  // has no test file of its own and this room test was never the place to be its unit test.
});

/**
 * Issue 104. Leave used to be `router.push(DEFAULT_LANDING_PATH)` — it walked the candidate out
 * of a room that carried on running, and the interview stayed "in progress" on the home list
 * until the worker's sweep noticed it a day later. It ends the interview now, which is why it
 * grew a confirm: an interview cannot be un-ended.
 */
describe('leaving the room (issue 104)', () => {
  beforeEach(() => {
    nav.push.mockReset();
    nav.replace.mockReset();
    installEventSourceMock();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it('asks before ending, and sends nothing until it is confirmed', async () => {
    const calls = stubFetch();
    await renderRoom();

    await userEvent.click(screen.getByRole('button', { name: messages.room.leave }));

    expect(screen.getByTestId('room-leave-confirm')).toBeInTheDocument();
    expect(calls.some((c) => c.url === '/api/interviews/i1/abandon')).toBe(false);
  });

  it('puts the candidate back in the room on cancel, still having sent nothing', async () => {
    const calls = stubFetch();
    await renderRoom();

    await userEvent.click(screen.getByRole('button', { name: messages.room.leave }));
    await userEvent.click(screen.getByRole('button', { name: messages.room.leaveCancel }));

    expect(screen.queryByTestId('room-leave-confirm')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: messages.room.leave })).toBeInTheDocument();
    expect(calls.some((c) => c.url === '/api/interviews/i1/abandon')).toBe(false);
  });

  it('ends the interview and leaves for its page once confirmed', async () => {
    const calls = stubFetch({ abandon: { status: 200, body: { state: 'evaluating' } } });
    await renderRoom();

    await userEvent.click(screen.getByRole('button', { name: messages.room.leave }));
    await userEvent.click(screen.getByRole('button', { name: messages.room.leaveConfirmAction }));

    await waitFor(() => {
      expect(calls.some((c) => c.url === '/api/interviews/i1/abandon' && c.method === 'POST')).toBe(
        true,
      );
    });
    // The interview's own page, not the dashboard: `evaluating` waits there for the report and
    // `abandoned` reads back the transcript. `replace`, so Back does not return to a dead room.
    await waitFor(() => expect(nav.replace).toHaveBeenCalledWith('/interviews/i1'));
  });

  // The confirm names the ending the server will actually pick — it branches on the same fact,
  // the answered turns — so the candidate is choosing an outcome, not agreeing to a warning.
  it('promises a report only when something has been answered', async () => {
    stubFetch({ states: [roomState({ transcript: [] })] });
    await renderRoom();

    await userEvent.click(screen.getByRole('button', { name: messages.room.leave }));

    expect(screen.getByTestId('room-leave-confirm')).toHaveTextContent(
      messages.room.leaveConfirmEmpty,
    );
  });

  it('promises a report on what was covered when turns have been answered', async () => {
    stubFetch({
      states: [
        roomState({
          transcript: [
            { questionId: 'q1', question: 'Tell me about yourself.', answer: 'I ship things.', roundType: 'hr' },
          ],
        }),
      ],
    });
    await renderRoom();

    await userEvent.click(screen.getByRole('button', { name: messages.room.leave }));

    expect(screen.getByTestId('room-leave-confirm')).toHaveTextContent(
      messages.room.leaveConfirmScored,
    );
  });

  // A refused leave must not strand the candidate between the two: the room is still live and
  // still answerable, so the error goes inline and the navigation does not happen.
  it('keeps the candidate in the room when the call is refused', async () => {
    stubFetch({
      abandon: { status: 409, body: { error: { code: 'INVALID_STATE_TRANSITION' } } },
    });
    await renderRoom();

    await userEvent.click(screen.getByRole('button', { name: messages.room.leave }));
    await userEvent.click(screen.getByRole('button', { name: messages.room.leaveConfirmAction }));

    await waitFor(() => {
      expect(within(screen.getByTestId('room-leave-confirm')).getByRole('alert')).toBeInTheDocument();
    });
    expect(nav.replace).not.toHaveBeenCalledWith('/interviews/i1');
    expect(screen.getByTestId('interview-room')).toBeInTheDocument();
  });
});
