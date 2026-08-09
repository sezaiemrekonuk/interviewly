import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { MockEventSource, installEventSourceMock } from '../../../../test/event-source-mock';
import { messages, renderWithProviders } from '../../../../test/render';
import { installMediaDevicesMock } from '../../../../test/media-devices-mock';
import { installAudioMock, type AudioHarness } from '../../../../test/audio-mock';

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

interface Call {
  url: string;
  method: string;
}

function stubFetch(options: { states?: Record<string, unknown>[]; answer?: () => Response } = {}) {
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
      // Bytes, not a `Blob`: undici's `Response` refuses jsdom's `Blob` as a body.
      if (url.endsWith('/speech')) {
        return new Response(new Uint8Array([1, 2, 3]), {
          status: 200,
          headers: { 'content-type': 'audio/mpeg' },
        });
      }
      if (url === '/api/interviews/i1/answers/audio') {
        return options.answer ? options.answer() : json(200, { state: 'hr_round', nextIndex: 2 });
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
  let audio: AudioHarness;

  beforeEach(() => {
    nav.push.mockReset();
    nav.replace.mockReset();
    installEventSourceMock();
    mics = installMediaDevicesMock();
    audio = installAudioMock();
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

  it('advances only on a state refetch — nothing client-side moves the index', async () => {
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
    expect(screen.getByTestId('question-typed')).toHaveTextContent('Tell me about yourself.');
    // K11: the transcript is server-filled. Nothing in the room derives it locally, so it stays
    // empty until the refetch — S05 removed the socket that used to be the tempting shortcut.
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

  // S05 deleted 'offers a reconnect on a dropped session' with the socket it dropped. The lost
  // banner is still rendered off `status === 'lost'`, which the mic now produces; S07 owns the
  // mic-denied path and re-covers it there.

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

  // S06 — the turn loop, from the room's side: the hook's own tests own the state machine,
  // these own the wiring the candidate can see and touch.
  it('speaks the question, then offers a stop that sends the recorded answer', async () => {
    const calls = stubFetch();
    await renderRoom();

    await waitFor(() => expect(audio.players).toHaveLength(1));
    expect(calls.some((c) => c.url === '/api/interviews/i1/questions/1/speech')).toBe(true);
    // Nothing to stop while the interviewer is speaking.
    expect(screen.queryByTestId('voice-stop')).not.toBeInTheDocument();

    await act(async () => audio.players[0].end());

    const stop = await screen.findByTestId('voice-stop');
    await act(async () => {
      fireEvent.click(stop);
    });

    await waitFor(() =>
      expect(calls.filter((c) => c.url === '/api/interviews/i1/answers/audio')).toHaveLength(1),
    );
  });

  it('lights the tile the round names, not the one the payload happens to carry', async () => {
    stubFetch({ states: [voiceState({ state: 'tech_round', persona: null })] });
    await renderRoom();

    // K2: the state machine decides who speaks. `resolveActiveSpeaker` is that rule.
    expect(screen.getByTestId('persona-tile-tech')).toHaveAttribute('data-live', 'true');
    expect(screen.getByTestId('persona-tile-hr')).toHaveAttribute('data-live', 'false');
  });

  it('leaves a failed answer with copy and a retry, never a spinning room', async () => {
    stubFetch({
      answer: () =>
        new Response(JSON.stringify({ error: { code: 'SPEECH_AUDIO_INVALID' } }), {
          status: 400,
          headers: { 'content-type': 'application/json' },
        }),
    });
    await renderRoom();

    await waitFor(() => expect(audio.players).toHaveLength(1));
    await act(async () => audio.players[0].end());
    await act(async () => {
      fireEvent.click(await screen.findByTestId('voice-stop'));
    });

    expect(await screen.findByText(messages.errors.SPEECH_AUDIO_INVALID)).toBeInTheDocument();

    await act(async () => {
      fireEvent.click(screen.getByTestId('voice-retry'));
    });

    // Retry re-records the same question rather than re-buying its audio.
    await waitFor(() => expect(screen.getByTestId('voice-stop')).toBeInTheDocument());
    expect(audio.players).toHaveLength(1);
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
