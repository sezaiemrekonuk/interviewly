import { act, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { MockEventSource, installEventSourceMock } from '../../../../test/event-source-mock';
import { messages, renderWithProviders } from '../../../../test/render';
import { MockWebSocket, installMediaDevicesMock, installWebSocketMock } from '../../../../test/websocket-mock';

const nav = vi.hoisted(() => ({
  push: vi.fn(),
  replace: vi.fn(),
  prefetch: vi.fn(),
  refresh: vi.fn(),
}));

vi.mock('next/navigation', () => ({
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

function voiceState(over: Record<string, unknown> = {}) {
  return {
    interviewId: 'i1',
    state: 'hr_round',
    mode: 'voice',
    currentIndex: 1,
    targetQuestionCount: 8,
    endedReason: null,
    language: 'en',
    persona: { id: 'p-hr', role: 'hr', name: 'Ada', avatarState: 'idle' },
    personas: PERSONAS,
    currentQuestion: {
      id: 'q1',
      text: 'Tell me about yourself.',
      kind: 'text',
      widget: null,
      deliveredAt: '2026-08-05T10:00:00.000Z',
    },
    transcript: [],
    transcriptCursor: 0,
    ...over,
  };
}

const MINT = {
  token: 'sess-token',
  wssOrigin: 'wss://voice.example',
  dynamicVars: { interviewId: 'i1', nonce: 'n1' },
  expiresAt: '2026-08-05T10:10:00.000Z',
};

interface Call {
  url: string;
  method: string;
}

function stubFetch(options: { states?: Record<string, unknown>[]; mintOk?: boolean } = {}) {
  const calls: Call[] = [];
  const states = options.states ?? [voiceState()];
  let stateHits = 0;

  const json = (status: number, body: unknown) =>
    new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      calls.push({ url, method: init?.method ?? 'GET' });

      if (url === '/api/me') return json(200, { user: USER });
      if (url === '/api/interviews/i1/state') {
        const body = states[Math.min(stateHits, states.length - 1)];
        stateHits += 1;
        return json(200, body);
      }
      if (url === '/api/interviews/i1/voice/session') {
        return options.mintOk === false
          ? json(503, { error: { code: 'VOICE_UNAVAILABLE' } })
          : json(201, MINT);
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

const stateCalls = (calls: Call[]) => calls.filter((c) => c.url === '/api/interviews/i1/state').length;

describe('interview room, voice mode (W10)', () => {
  let mics: ReturnType<typeof installMediaDevicesMock>;

  beforeEach(() => {
    nav.push.mockReset();
    nav.replace.mockReset();
    installEventSourceMock();
    installWebSocketMock();
    mics = installMediaDevicesMock();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it('renders the same two-tile room with voice controls and no text composer', async () => {
    stubFetch();
    await renderRoom();

    expect(screen.getByTestId('voice-controls')).toBeInTheDocument();
    // The composer is text mode's surface — in voice the candidate speaks.
    expect(screen.queryByTestId('answer-composer')).not.toBeInTheDocument();
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument();

    const hr = screen.getByTestId('persona-tile-hr');
    expect(hr).toHaveAttribute('data-live', 'true');
    expect(screen.getByTestId('persona-tile-tech')).toHaveAttribute('data-live', 'false');
    expect(screen.getAllByText(messages.room.live)).toHaveLength(1);

    // Room mode, not an entry surface: no mascot on this screen.
    expect(screen.queryByTestId('mascot')).not.toBeInTheDocument();
  });

  it('advances only on a state refetch — a turn frame moves the beat, never the index', async () => {
    const calls = stubFetch({
      states: [
        voiceState(),
        voiceState({
          currentIndex: 2,
          currentQuestion: {
            id: 'q2',
            text: 'Explain an index.',
            kind: 'text',
            widget: null,
            deliveredAt: '2026-08-05T10:01:00.000Z',
          },
          transcript: [
            { questionId: 'q1', question: 'Tell me about yourself.', answer: 'I ship.', roundType: 'hr' },
          ],
          transcriptCursor: 1,
        }),
      ],
    });
    await renderRoom();

    expect(screen.getByText(messages.room.progress.replace('{index}', '1').replace('{total}', '8'))).toBeInTheDocument();

    const ws = await waitFor(() => {
      expect(MockWebSocket.last).toBeDefined();
      return MockWebSocket.last!;
    });
    await act(async () => ws.emitOpen());

    // The candidate finishes speaking. The socket says so; the room must not believe it.
    await act(async () => {
      ws.emitMessage({ type: 'user_transcript', text: 'I ship.' });
    });

    expect(
      screen.getByText(messages.room.progress.replace('{index}', '1').replace('{total}', '8')),
    ).toBeInTheDocument();
    expect(screen.getByTestId('question-typed')).toHaveTextContent('Tell me about yourself.');
    // The socket carried an answer; the transcript is server-filled and stays empty until the refetch.
    expect(screen.queryByText('I ship.')).not.toBeInTheDocument();

    const before = stateCalls(calls);
    await act(async () => {
      MockEventSource.instances[0]?.emit('INTERVIEW_STATE_CHANGED', '{}');
    });
    await waitFor(() => expect(stateCalls(calls)).toBeGreaterThan(before));

    await waitFor(() =>
      expect(screen.getByTestId('question-typed')).toHaveTextContent('Explain an index.'),
    );
    expect(
      screen.getByText(messages.room.progress.replace('{index}', '2').replace('{total}', '8')),
    ).toBeInTheDocument();
    expect(await screen.findByText('I ship.')).toBeInTheDocument();
  });

  it('offers a reconnect on a dropped session and re-syncs from a state refetch', async () => {
    const calls = stubFetch();
    await renderRoom();

    const ws = await waitFor(() => {
      expect(MockWebSocket.last).toBeDefined();
      return MockWebSocket.last!;
    });
    await act(async () => ws.emitOpen());
    await waitFor(() =>
      expect(screen.getByTestId('voice-status')).toHaveTextContent(messages.room.voice.status.connected),
    );

    await act(async () => ws.emitClose());

    const banner = await screen.findByTestId('session-lost');
    expect(within(banner).getByText(messages.room.voice.lost)).toBeInTheDocument();

    const before = stateCalls(calls);
    await act(async () => {
      await userEvent.click(within(banner).getByRole('button', { name: messages.room.voice.reconnect }));
    });

    await waitFor(() => expect(MockWebSocket.instances).toHaveLength(2));
    await act(async () => MockWebSocket.last!.emitOpen());

    // V05 reconciles server-side; the client's truth comes back through `/state`, not the socket.
    await waitFor(() => expect(stateCalls(calls)).toBeGreaterThan(before));
    await waitFor(() => expect(screen.queryByTestId('session-lost')).not.toBeInTheDocument());
  });

  it('reads the transcript from state into a polite live region', async () => {
    stubFetch({
      states: [
        voiceState({
          transcript: [
            { questionId: 'q1', question: 'Tell me about yourself.', answer: 'I ship.', roundType: 'hr' },
          ],
          transcriptCursor: 1,
        }),
      ],
    });
    await renderRoom();

    const list = within(screen.getByTestId('transcript')).getByRole('list');
    expect(list).toHaveAttribute('aria-live', 'polite');
    expect(within(list).getByText('I ship.')).toBeInTheDocument();
  });

  it('releases the microphone when the room unmounts', async () => {
    stubFetch();
    let unmount!: () => void;
    await act(async () => {
      ({ unmount } = renderWithProviders(<RoomPage />));
    });
    await screen.findByTestId('interview-room');
    await waitFor(() => expect(mics.tracks).toHaveLength(1));

    act(() => unmount());

    // No hot mic once the candidate leaves the room — the same guarantee pre-join makes.
    expect(mics.tracks[0].stop).toHaveBeenCalled();
  });
});
