import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { FLUSH_GRACE_MS, FLUSH_POLL_MS, markFlushed } from '@/lib/voice/unload-flush';

import { MockEventSource, installEventSourceMock } from '../../../../../test/event-source-mock';
import { messages, renderWithProviders } from '../../../../../test/render';
import { installMediaDevicesMock } from '../../../../../test/media-devices-mock';
import { installAudioMock, type AudioHarness } from '../../../../../test/audio-mock';

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

/** C02 — one utterance. See the twin in `page.test.tsx`; voice reads `id` and `role` hardest. */
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
    createdAt: '2026-08-05T10:00:00.000Z',
  };
}

/**
 * A room joined mid-interview: greeted, answered once, and now asked `q1`. The user turn in the
 * middle is not decoration — the hook writes off everything up to and including the last `user`
 * row on its first render, so this fixture leaves exactly ONE line to be spoken (`m3`), which is
 * what a candidate who refreshes should hear: the prompt they are on, not the interview so far.
 */
const OPENING = [
  turn('m1', 'assistant', "Hi, I'm Ada. Thanks for making the time."),
  turn('m2', 'user', 'Happy to be here.'),
  turn('m3', 'assistant', 'Tell me about yourself.', { action: 'next_question', questionId: 'q1' }),
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
    // S09: the window the room counts down. I16: elapsed comes off `elapsedSeconds` — an hour
    // since the start, 65 s of it in the room — and `startedAt` is only the interview's date.
    startedAt: new Date(Date.now() - 3_600_000).toISOString(),
    elapsedSeconds: 65,
    expiresAt: new Date(Date.now() + 300_000).toISOString(),
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
    messages: OPENING,
    transcriptCursor: 0,
    // T03 — the half-sentence the server is holding for this question, or null.
    pendingTurn: null,
    ...over,
  };
}

interface Call {
  url: string;
  method: string;
  body: unknown;
}

/**
 * Issue #219 — every wait in this file names its own ceiling. The default is 1 000 ms, and the
 * turn loop this file drives is a chain of a state fetch, a TTS fetch and a mutation: on a
 * loaded CI runner that chain misses the default window and red-lights a PR that touched
 * nothing near the room. The number is a timeout, not a delay — a passing run never waits it.
 */
const SETTLE = { timeout: 5_000 };

/** C06 — audio is bought per utterance now, so the speech route is keyed by message id. */
const SPEECH = (id: string) => `/api/interviews/i1/messages/${id}/speech`;
const UPLOAD = '/api/interviews/i1/turns/audio';
const TURNS = '/api/interviews/i1/turns';

function stubFetch(options: { states?: Record<string, unknown>[]; answer?: () => Response } = {}) {
  const calls: Call[] = [];
  const states = options.states ?? [voiceState()];
  let stateHits = 0;

  const json = (status: number, body: unknown) =>
    new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      const raw = init?.body;
      calls.push({
        url,
        method: init?.method ?? 'GET',
        body: typeof raw === 'string' ? JSON.parse(raw) : (raw ?? null),
      });

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
      if (url === UPLOAD) {
        return options.answer ? options.answer() : json(200, { state: 'hr_round', currentIndex: 1 });
      }
      if (url === TURNS) return json(200, { state: 'hr_round', currentIndex: 1 });
      return json(404, { error: { code: 'NOT_FOUND' } });
    }),
  );

  return calls;
}

async function renderRoom() {
  await act(async () => {
    renderWithProviders(<RoomPage />);
  });
  await screen.findByTestId('interview-room', undefined, SETTLE);
}

const stateCalls = (calls: Call[]) => calls.filter((c) => c.url === '/api/interviews/i1/state').length;

describe('interview room, voice mode (W10)', () => {
  let mics: ReturnType<typeof installMediaDevicesMock>;
  let audio: AudioHarness;

  beforeEach(() => {
    nav.push.mockReset();
    nav.replace.mockReset();
    // The flush marker is per tab and jsdom keeps one tab for the whole file.
    sessionStorage.clear();
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
    // Still the rule for an ordinary question: the candidate speaks. A keyboard appears only
    // where the interviewer asked for one (the next test) — a composer under every question
    // would make the room a chat with audio bolted on.
    expect(screen.queryByTestId('answer-composer')).not.toBeInTheDocument();
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument();

    const hr = screen.getByTestId('persona-tile-hr');
    expect(hr).toHaveAttribute('data-live', 'true');
    expect(screen.getByTestId('persona-tile-tech')).toHaveAttribute('data-live', 'false');
    // Who has the floor is the tile's own ring now (`data-live`), not a badge on their face.
    expect(screen.queryByText(messages.room.live)).not.toBeInTheDocument();

    // Room mode, not an entry surface: no mascot on this screen.
    expect(screen.queryByTestId('mascot')).not.toBeInTheDocument();
  });

  // The candidate's own tile, the only one in the room that may carry a camera. Off on arrival
  // and turned on from the control bar (voice spec §3.2) — the picture is bound to a local
  // `<video>` and never uploaded, so nothing about this reaches the server.
  it('turns the self-camera on from the control bar, and off again', async () => {
    stubFetch();
    await renderRoom();

    const you = screen.getByTestId('persona-tile-you');
    expect(within(you).queryByTestId('camera-view')).not.toBeInTheDocument();

    const toggle = screen.getByTestId('camera-toggle');
    expect(toggle).toHaveAttribute('aria-pressed', 'false');
    await userEvent.click(toggle);

    await waitFor(() =>
      expect(within(you).getByTestId('camera-view')).toHaveAttribute('data-camera', 'live'),
    );
    const camera = mics.tracks.at(-1)!;

    await userEvent.click(toggle);

    expect(within(you).queryByTestId('camera-view')).not.toBeInTheDocument();
    // Off means the device is released, not that the picture is hidden.
    expect(camera.stop).toHaveBeenCalled();
  });

  // ADR-C04 — the other half of the rule above, and the point of `show_widget`: some answers are
  // a list, a snippet or a precise value, and dictating those is worse than typing them. Voice
  // mode had no way to type at all, so a widget the interviewer put on screen was unanswerable.
  // The `inputMode` is the second half: sent as 'text', a typed widget answer is indistinguishable
  // in the report from one the candidate spoke, and `InputMode.widget` goes back to being a
  // column nothing writes.
  it('renders a composer in voice mode when the interviewer put a widget on screen', async () => {
    const calls = stubFetch({
      states: [
        voiceState({
          currentQuestion: {
            id: 'q1',
            text: 'Which stack did you use?',
            kind: 'text',
            widget: { kind: 'textbox', label: 'Name the stack' },
            deliveredAt: '2026-08-05T10:00:00.000Z',
          },
        }),
      ],
    });
    const user = userEvent.setup();
    await renderRoom();

    expect(screen.getByTestId('answer-composer')).toBeInTheDocument();
    // The widget's own label, not the generic one: it is the question the box is asking.
    const input = screen.getByLabelText('Name the stack');
    // The stage does not become the text room around it — voice is still how the round runs.
    expect(screen.getByTestId('voice-controls')).toBeInTheDocument();

    await user.type(input, 'Postgres and Redis.');
    await user.click(screen.getByRole('button', { name: messages.room.submit }));

    await waitFor(() => expect(calls.filter((c) => c.url === TURNS)).toHaveLength(1), SETTLE);
    expect(calls.find((c) => c.url === TURNS)?.body).toEqual({
      text: 'Postgres and Redis.',
      inputMode: 'widget',
    });
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
          messages: [
            ...OPENING,
            turn('m4', 'user', 'I ship.', { questionId: 'q1' }),
            turn('m5', 'assistant', 'Explain an index.', {
              action: 'next_question',
              questionId: 'q2',
            }),
          ],
          transcript: [
            { questionId: 'q1', question: 'Tell me about yourself.', answer: 'I ship.', roundType: 'hr' },
          ],
          transcriptCursor: 1,
        }),
      ],
    });
    await renderRoom();

    expect(screen.getByText(messages.room.progress.replace('{index}', '1').replace('{total}', '8'))).toBeInTheDocument();
    // C02 — the caption is the interviewer's last *line*, which here is the question it just
    // asked. It is not read off `currentQuestion` any more, so a follow-up that belongs to no
    // question is captioned too.
    expect(screen.getByTestId('question-typed')).toHaveTextContent('Tell me about yourself.');
    // K11: the conversation is server-filled. Nothing in the room appends the candidate's own
    // utterance locally, so it is absent until the refetch — S05 removed the socket that used
    // to be the tempting shortcut, and the voice hook is forbidden the same shortcut.
    expect(screen.queryByText('I ship.')).not.toBeInTheDocument();

    const before = stateCalls(calls);
    await act(async () => {
      MockEventSource.instances[0]?.emit('INTERVIEW_STATE_CHANGED', '{}');
    });
    await waitFor(() => expect(stateCalls(calls)).toBeGreaterThan(before), SETTLE);

    await waitFor(
      () => expect(screen.getByTestId('question-typed')).toHaveTextContent('Explain an index.'),
      SETTLE,
    );
    expect(
      screen.getByText(messages.room.progress.replace('{index}', '2').replace('{total}', '8')),
    ).toBeInTheDocument();
    expect(await screen.findByText('I ship.', undefined, SETTLE)).toBeInTheDocument();
  });

  // S05 deleted 'offers a reconnect on a dropped session' with the socket it dropped. The lost
  // banner is still rendered off `status === 'lost'`, which the mic now produces; S07 owns the
  // mic-denied path and re-covers it there.

  // The conversation is the live region now (C02), and in voice it is not a nicety: everything
  // the interviewer says is audio, so this panel is the only place a screen-reader user meets
  // the interview at all. Rendered without `live` it would be a silent panel behind a toggle.
  it('reads the conversation from state into a polite live region', async () => {
    stubFetch();
    await renderRoom();

    const list = within(screen.getByTestId('conversation')).getByRole('list');
    expect(list).toHaveAttribute('aria-live', 'polite');
    expect(within(list).getByText("Hi, I'm Ada. Thanks for making the time.")).toBeInTheDocument();
    expect(within(list).getByText('Happy to be here.')).toBeInTheDocument();
    expect(within(list).getByText('Tell me about yourself.')).toBeInTheDocument();
  });

  // S06 — the turn loop, from the room's side: the hook's own tests own the state machine,
  // these own the wiring the candidate can see and touch.
  it("speaks the interviewer's last line, then offers a stop that uploads the recorded turn", async () => {
    const calls = stubFetch();
    await renderRoom();

    await waitFor(() => expect(audio.players).toHaveLength(1), SETTLE);
    // C06 — by message id, not by question index: the greeting, a follow-up and the handover
    // line are all things to say and none of them is a question with an index.
    expect(calls.some((c) => c.url === SPEECH('m3'))).toBe(true);
    // And ONLY the trailing line. A candidate who refreshes mid-interview must not have the
    // whole conversation read back at them from the greeting, so everything up to the last
    // thing they said is written off as already heard.
    expect(calls.some((c) => c.url === SPEECH('m1'))).toBe(false);
    // Nothing to stop while the interviewer is speaking.
    expect(screen.queryByTestId('voice-stop')).not.toBeInTheDocument();

    await act(async () => audio.players[0].end());

    const stop = await screen.findByTestId('voice-stop', undefined, SETTLE);
    await act(async () => {
      fireEvent.click(stop);
    });

    // A turn, not an answer: the upload names no question, because whether the utterance
    // answered anything is the conductor's call and not this room's.
    await waitFor(() => expect(calls.filter((c) => c.url === UPLOAD)).toHaveLength(1), SETTLE);
    expect(calls.some((c) => c.url === '/api/interviews/i1/answers/audio')).toBe(false);
  });

  // S09 — the room shows the ceiling it is actually held to. I16 — and elapsed off the server's
  // active-time figure instead of counting from either arrival or the interview's start.
  it('renders the countdown and an elapsed clock taken from the server window', async () => {
    stubFetch();
    await renderRoom();

    expect(screen.getByTestId('time-remaining')).toBeInTheDocument();
    expect(screen.getByTestId('room-elapsed')).toHaveTextContent('01:05');
  });

  it('renders no countdown for a voice interview the server gave no deadline', async () => {
    stubFetch({ states: [voiceState({ expiresAt: null })] });
    await renderRoom();

    expect(screen.queryByTestId('time-remaining')).not.toBeInTheDocument();
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

    await waitFor(() => expect(audio.players).toHaveLength(1), SETTLE);
    await act(async () => audio.players[0].end());
    await act(async () => {
      fireEvent.click(await screen.findByTestId('voice-stop', undefined, SETTLE));
    });

    // S10: the room's own copy per code, not the generic `errors` string.
    expect(
      await screen.findByText(messages.room.voice.failure.SPEECH_AUDIO_INVALID, undefined, SETTLE),
    ).toBeInTheDocument();

    await act(async () => {
      fireEvent.click(screen.getByTestId('voice-retry'));
    });

    // Retry re-records the same turn rather than re-buying the line's audio: the upload is the
    // half that failed, and re-speaking `m3` would charge TTS twice for one question.
    await waitFor(() => expect(screen.getByTestId('voice-stop')).toBeInTheDocument(), SETTLE);
    expect(audio.players).toHaveLength(1);
  });

  // T04 / ADR-T05 — the reload case. The notice means "this is what survived", not "this is
  // what the server holds now": it is read once on mount and frozen, so the probes that extend
  // the held text while the candidate keeps talking cannot rewrite it under them.
  it('shows the held partial once after a reload, frozen, and drops it once conducted', async () => {
    const calls = stubFetch({
      states: [
        voiceState({ pendingTurn: 'I was in the middle of saying' }),
        voiceState({ pendingTurn: 'I was in the middle of saying that the migration' }),
        voiceState({ pendingTurn: null }),
      ],
    });
    await renderRoom();

    const notice = await screen.findByTestId('turn-resumed', undefined, SETTLE);
    expect(notice).toHaveTextContent('I was in the middle of saying');
    // Outside the conversation list, which is the only place a screen-reader user meets the
    // interviewer at all — a partial that regrew inside it would talk over them (AC-13) — and
    // outside the conversation PANEL, which voice mode keeps closed and therefore clipped. The
    // first version of this satisfied AC-13 and was invisible to the candidate it is for.
    const panel = screen.getByTestId('conversation');
    expect(panel.contains(notice)).toBe(false);
    expect(panel.getAttribute('data-open')).toBe('false');
    expect(screen.getByTestId('voice-controls').parentElement!.contains(notice)).toBe(true);

    const before = stateCalls(calls);
    await act(async () => {
      MockEventSource.instances[0]?.emit('INTERVIEW_STATE_CHANGED', '{}');
    });
    await waitFor(() => expect(stateCalls(calls)).toBeGreaterThan(before), SETTLE);

    expect(screen.getByTestId('turn-resumed')).not.toHaveTextContent('the migration');

    await act(async () => {
      MockEventSource.instances[0]?.emit('INTERVIEW_STATE_CHANGED', '{}');
    });
    await waitFor(() => expect(screen.queryByTestId('turn-resumed')).not.toBeInTheDocument(), SETTLE);
  });

  // T07 — the half of the flush the candidate can see, and the reason the first live run of it
  // read as "it didn't save". A beacon sent at `pagehide` is still being transcribed and gated
  // when the reloaded room asks `GET /state`: measured at ~2 s early on 2026-08-12, against a
  // fragment that reached Redis one second after the room had already latched null and frozen.
  // The marker the dying page leaves is what buys those seconds back.
  it('waits for a flush that is still in flight before deciding nothing survived', async () => {
    markFlushed('i1');
    stubFetch({
      states: [
        // The reloaded room asks before the gate has written: an honest null, and the wrong
        // answer to freeze.
        voiceState({ pendingTurn: null }),
        voiceState({ pendingTurn: 'Oh my God. You slipped?' }),
      ],
    });
    await renderRoom();

    const notice = await screen.findByTestId('turn-resumed', undefined, SETTLE);
    expect(notice).toHaveTextContent('Oh my God. You slipped?');
  });

  // ...and the wait is bought by the marker alone. A room nobody flushed from latches the first
  // answer and stays frozen on it (ADR-T05) — no polling, and no notice that appears a beat
  // after the candidate has started their next sentence.
  it('does not wait, or re-read, when no flush left this tab', async () => {
    const calls = stubFetch({
      states: [voiceState({ pendingTurn: null }), voiceState({ pendingTurn: 'too late' })],
    });
    await renderRoom();
    const reads = stateCalls(calls);

    await new Promise((resolve) => setTimeout(resolve, 1_200));

    expect(screen.queryByTestId('turn-resumed')).not.toBeInTheDocument();
    expect(stateCalls(calls)).toBe(reads);
  });

  // The candidate who flushed and whose fragment the server did not keep — the gate conducted it,
  // or the beacon never arrived. The wait is bounded: the room stops asking and says nothing,
  // rather than polling `/state` for the rest of the interview.
  it(
    'gives up on a flush that never lands, and stops asking',
    async () => {
      markFlushed('i1');
      const calls = stubFetch({ states: [voiceState({ pendingTurn: null })] });
      await renderRoom();

      await new Promise((resolve) => setTimeout(resolve, FLUSH_GRACE_MS + 400));
      const afterGrace = stateCalls(calls);
      await new Promise((resolve) => setTimeout(resolve, FLUSH_POLL_MS * 2));

      expect(screen.queryByTestId('turn-resumed')).not.toBeInTheDocument();
      expect(stateCalls(calls)).toBe(afterGrace);
    },
    FLUSH_GRACE_MS + FLUSH_POLL_MS * 2 + 5_000,
  );

  it('releases the microphone when the room unmounts', async () => {
    stubFetch();
    let unmount!: () => void;
    await act(async () => {
      ({ unmount } = renderWithProviders(<RoomPage />));
    });
    await screen.findByTestId('interview-room', undefined, SETTLE);
    await waitFor(() => expect(mics.tracks).toHaveLength(1), SETTLE);

    act(() => unmount());

    // No hot mic once the candidate leaves the room — the same guarantee pre-join makes.
    expect(mics.tracks[0].stop).toHaveBeenCalled();
  });
});
