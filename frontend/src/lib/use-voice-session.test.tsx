import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { RoomMessage } from './query';
import { useVoiceSession, VAD_SILENCE_MS, VAD_THRESHOLD } from './use-voice-session';
import { installAudioMock, type AudioHarness } from '../test/audio-mock';
import { installMediaDevicesMock } from '../test/media-devices-mock';

/** `state.messages` rows are only ever read for `id` and `role` here — the rest is shape. */
function msg(id: string, role: RoomMessage['role']): RoomMessage {
  return {
    id,
    role,
    content: id,
    action: role === 'assistant' ? 'continue' : null,
    questionId: 'q1',
    roundType: 'hr',
    createdAt: '2026-01-01T00:00:00.000Z',
  };
}

/** The opening state of a fresh room: the interviewer has said one thing and nobody has replied. */
const MESSAGES = [msg('m1', 'assistant')];

// Short enough that the silence window is a real wait no test has to sit through, and still
// the same code path the 2 s default takes.
const VAD = { silenceMs: 20 };

const SPEECH = (id: string) => `/api/interviews/i1/messages/${id}/speech`;
const UPLOAD = '/api/interviews/i1/turns/audio';

interface Call {
  url: string;
  method: string;
  body: unknown;
}

function stubApi(routes: Record<string, () => Response> = {}) {
  const calls: Call[] = [];

  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      calls.push({ url, method: init?.method ?? 'GET', body: init?.body });
      const route = routes[url];
      if (route) return route();
      // Bytes, not a `Blob`: undici's `Response` refuses jsdom's `Blob` as a body.
      if (url.endsWith('/speech')) {
        return new Response(new Uint8Array([1, 2, 3]), {
          status: 200,
          headers: { 'content-type': 'audio/mpeg' },
        });
      }
      return new Response(JSON.stringify({ state: 'hr_round', currentIndex: 1 }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }),
  );

  return calls;
}

function jsonError(status: number, code: string) {
  return () =>
    new Response(JSON.stringify({ error: { code } }), {
      status,
      headers: { 'content-type': 'application/json' },
    });
}

const hits = (calls: Call[], url: string) => calls.filter((call) => call.url === url).length;

function wrapper(client: QueryClient) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  };
}

describe('useVoiceSession — the turn loop (C02)', () => {
  let audio: AudioHarness;
  let mics: ReturnType<typeof installMediaDevicesMock>;
  let client: QueryClient;

  beforeEach(() => {
    mics = installMediaDevicesMock();
    audio = installAudioMock();
    client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function mount(messages: RoomMessage[] = MESSAGES) {
    return renderHook(
      (props: { messages: RoomMessage[] }) =>
        useVoiceSession('i1', {
          enabled: true,
          messages: props.messages,
          speakable: true,
          vad: VAD,
        }),
      { wrapper: wrapper(client), initialProps: { messages } },
    );
  }

  /** Line spoken, playback finished, recorder running — the state every turn starts from. */
  async function recording(hook: ReturnType<typeof mount>) {
    await waitFor(() => expect(audio.players).toHaveLength(1));
    await act(async () => audio.players[0].end());
    await waitFor(() => expect(audio.recorders).toHaveLength(1));
    return hook;
  }

  // The meter re-renders this hook on every animation frame. If a render during the in-flight
  // TTS fetch tears the speak effect down, its `cancelled` flag drops the audio that arrives —
  // and the message is already marked spoken, so the re-run does not fetch it again. The turn
  // then sits in `speaking` forever: nothing plays, the recorder never opens, and talking does
  // nothing.
  it('still speaks the line when the meter re-renders during the fetch', async () => {
    stubApi();
    const hook = mount();

    // Frames the browser would deliver while the audio is downloading.
    await act(async () => audio.level(0.002, 3));
    await act(async () => audio.level(0.003, 3));

    await waitFor(() => expect(audio.players).toHaveLength(1));
    expect(audio.players[0].playCalls).toBe(1);
    await act(async () => audio.players[0].end());
    await waitFor(() => expect(audio.recorders).toHaveLength(1));
    expect(hook.result.current.recording).toBe(true);
  });

  it('speaks the unspoken assistant message before it records anything', async () => {
    const calls = stubApi();
    const hook = mount();

    await waitFor(() => expect(audio.players).toHaveLength(1));
    expect(hits(calls, SPEECH('m1'))).toBe(1);
    expect(audio.players[0].playCalls).toBe(1);
    expect(hook.result.current.beat).toBe('speaking');
    // The mic is not open while the interviewer talks — a recorder started here captures it.
    expect(audio.recorders).toHaveLength(0);
  });

  // A handover writes two assistant lines in one turn: the outgoing interviewer's closing
  // sentence and the incoming one's greeting. Opening the mic after the first would record the
  // candidate over the second, and the second is the question.
  it('speaks every pending line in order and only then opens the mic', async () => {
    const calls = stubApi();
    mount([msg('m1', 'assistant'), msg('m2', 'assistant')]);

    await waitFor(() => expect(audio.players).toHaveLength(1));
    expect(hits(calls, SPEECH('m1'))).toBe(1);
    expect(audio.recorders).toHaveLength(0);

    await act(async () => audio.players[0].end());

    await waitFor(() => expect(audio.players).toHaveLength(2));
    expect(hits(calls, SPEECH('m2'))).toBe(1);
    expect(audio.recorders).toHaveLength(0);

    await act(async () => audio.players[1].end());
    await waitFor(() => expect(audio.recorders).toHaveLength(1));
  });

  // §3.8: a refresh REBUILDS the room from `messages`, it does not re-run them. Everything up to
  // the candidate's last utterance is history — replaying it would read the interview back from
  // the greeting — and the assistant lines after it are the prompt they must still hear.
  it('never replays the backlog on a refresh, only what came after the last utterance', async () => {
    const calls = stubApi();
    mount([
      msg('m1', 'assistant'),
      msg('u1', 'user'),
      msg('m2', 'assistant'),
      msg('u2', 'user'),
      msg('m3', 'assistant'),
    ]);

    await waitFor(() => expect(audio.players).toHaveLength(1));
    expect(hits(calls, SPEECH('m3'))).toBe(1);
    expect(hits(calls, SPEECH('m1'))).toBe(0);
    expect(hits(calls, SPEECH('m2'))).toBe(0);
  });

  it('says nothing when the candidate has spoken and the interviewer has not replied yet', async () => {
    const calls = stubApi();
    mount([msg('m1', 'assistant'), msg('u1', 'user')]);

    await Promise.resolve();
    expect(audio.players).toHaveLength(0);
    expect(hits(calls, SPEECH('m1'))).toBe(0);
    expect(audio.recorders).toHaveLength(0);
  });

  it('records the answer once the line has finished playing', async () => {
    stubApi();
    const hook = await recording(mount());

    expect(audio.recorders[0].state).toBe('recording');
    expect(hook.result.current.beat).toBe('listening');
    expect(hook.result.current.recording).toBe(true);
  });

  it('stops the recording after the silence window and uploads exactly once', async () => {
    const calls = stubApi();
    const hook = await recording(mount());

    await act(async () => audio.level(VAD_THRESHOLD + 0.2));
    await act(async () => audio.level(0));

    await waitFor(() => expect(audio.recorders[0].stops).toBe(1));
    await waitFor(() => expect(hits(calls, UPLOAD)).toBe(1));

    const upload = calls.find((call) => call.url === UPLOAD)!;
    expect(upload.method).toBe('POST');
    const form = upload.body as FormData;
    // No question named: the utterance may be an answer, a clarification or a question back, and
    // which of those it was — and whether the interview advances — is the conductor's call.
    expect(form.get('questionId')).toBe(null);
    // Bare media type: the backend's allow-list has no `;codecs=` member.
    expect((form.get('audio') as File).type).toBe('audio/webm');
    await waitFor(() => expect(hook.result.current.beat).toBe(null));
  });

  // A real microphone never reports the same RMS twice: room tone jitters in the fourth
  // decimal every animation frame. The window has to survive that, or it only ever closes on
  // a mic that is bit-identically silent — which no real one is.
  it('stops after the silence window even though the noise floor keeps jittering', async () => {
    const calls = stubApi();
    await recording(mount());

    await act(async () => audio.level(VAD_THRESHOLD + 0.2));

    // Room tone, one value per animation frame, for five times the silence window. Never the
    // same value twice — a real noise floor is not bit-identical from frame to frame.
    const floor = [0.0011, 0.0009, 0.0013, 0.0008, 0.0012, 0.001, 0.0014, 0.0007];
    for (let i = 0; i < VAD.silenceMs * 5; i += 4) {
      await act(async () => {
        audio.level(floor[(i / 4) % floor.length]);
        await new Promise((resolve) => setTimeout(resolve, 4));
      });
      if (audio.recorders[0].stops > 0) break;
    }

    expect(audio.recorders[0].stops).toBe(1);
    await waitFor(() => expect(hits(calls, UPLOAD)).toBe(1));
  });

  it('does not stop on silence the candidate never broke — an unspoken turn keeps listening', async () => {
    const calls = stubApi();
    await recording(mount());

    await act(async () => audio.level(0));
    await new Promise((resolve) => setTimeout(resolve, VAD.silenceMs * 3));

    expect(audio.recorders[0].stops).toBe(0);
    expect(hits(calls, UPLOAD)).toBe(0);
  });

  it('uploads immediately on a manual stop', async () => {
    const calls = stubApi();
    const hook = await recording(mount());

    await act(async () => hook.result.current.stop());

    expect(audio.recorders[0].stops).toBe(1);
    await waitFor(() => expect(hits(calls, UPLOAD)).toBe(1));
  });

  it('refetches state after the upload and never advances the index itself', async () => {
    const invalidate = vi.spyOn(client, 'invalidateQueries');
    stubApi();
    const hook = await recording(mount());

    await act(async () => hook.result.current.stop());

    await waitFor(() =>
      expect(invalidate).toHaveBeenCalledWith({ queryKey: ['interview', 'i1', 'state'] }),
    );
    // Still the conversation the server handed us: nothing local moved it on.
    expect(audio.players).toHaveLength(1);
  });

  // The reply to a clarification does not advance the index (C02), so an index-keyed loop would
  // hear it and say nothing. The id is what makes it a new line.
  it('speaks a line once, and the next one only when the server writes it', async () => {
    const calls = stubApi();
    const hook = mount();
    await waitFor(() => expect(audio.players).toHaveLength(1));

    hook.rerender({ messages: [msg('m1', 'assistant')] });
    expect(audio.players).toHaveLength(1);

    hook.rerender({ messages: [msg('m1', 'assistant'), msg('u1', 'user'), msg('m2', 'assistant')] });
    await waitFor(() => expect(audio.players).toHaveLength(2));
    expect(hits(calls, SPEECH('m2'))).toBe(1);
    expect(hits(calls, SPEECH('m1'))).toBe(1);
  });

  it('opens no microphone and speaks nothing in text mode', async () => {
    const calls = stubApi();
    renderHook(
      () => useVoiceSession('i1', { enabled: false, messages: MESSAGES, speakable: true, vad: VAD }),
      { wrapper: wrapper(client) },
    );

    await Promise.resolve();
    expect(audio.players).toHaveLength(0);
    expect(hits(calls, SPEECH('m1'))).toBe(0);
    expect(mics.tracks).toHaveLength(0);
  });

  // A paused room, a report and an ended interview all hand down `speakable: false`. Nothing is
  // forgotten while it is down — the set of spoken ids outlives it.
  it('speaks nothing while the room is not conductable', async () => {
    const calls = stubApi();
    renderHook(
      () => useVoiceSession('i1', { enabled: true, messages: MESSAGES, speakable: false, vad: VAD }),
      { wrapper: wrapper(client) },
    );

    await Promise.resolve();
    expect(audio.players).toHaveLength(0);
    expect(hits(calls, SPEECH('m1'))).toBe(0);
  });

  it('keeps the spec default of a two-second silence window', () => {
    expect(VAD_SILENCE_MS).toBe(2_000);
  });
});

describe('useVoiceSession — failure branches (S06)', () => {
  let audio: AudioHarness;
  let mics: ReturnType<typeof installMediaDevicesMock>;
  let client: QueryClient;

  beforeEach(() => {
    mics = installMediaDevicesMock();
    audio = installAudioMock();
    client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function mount(messages: RoomMessage[] = MESSAGES) {
    return renderHook(
      () => useVoiceSession('i1', { enabled: true, messages, speakable: true, vad: VAD }),
      { wrapper: wrapper(client) },
    );
  }

  it('downgrades to text when the line cannot be played, instead of retrying it', async () => {
    const calls = stubApi();
    const hook = mount();
    await waitFor(() => expect(audio.players).toHaveLength(1));

    await act(async () => audio.players[0].fail());

    await waitFor(() => expect(hits(calls, '/api/interviews/i1/voice/downgrade')).toBe(1));
    // One attempt, not a loop: the mode the refetch brings back is text.
    expect(audio.players).toHaveLength(1);
    expect(audio.recorders).toHaveLength(0);
    expect(hook.result.current.beat).toBe(null);
  });

  it('reports the ceiling refusal as its own code and lets the refetch end the room', async () => {
    const invalidate = vi.spyOn(client, 'invalidateQueries');
    const calls = stubApi({ [SPEECH('m1')]: jsonError(403, 'VOICE_SESSION_EXPIRED') });
    const hook = mount();

    await waitFor(() => expect(hook.result.current.error).toBe('VOICE_SESSION_EXPIRED'));
    await waitFor(() =>
      expect(invalidate).toHaveBeenCalledWith({ queryKey: ['interview', 'i1', 'state'] }),
    );
    // An expired session is the server ending the interview, not a voice failure to downgrade.
    expect(hits(calls, '/api/interviews/i1/voice/downgrade')).toBe(0);
  });

  // Un-speaking the whole conversation on a retry would read the interview back from its
  // greeting; only the line that failed is owed a second attempt.
  it('re-speaks only the failed line on retry', async () => {
    const calls = stubApi({ [SPEECH('m2')]: jsonError(500, 'SPEECH_UNAVAILABLE') });
    const hook = mount([msg('m1', 'assistant'), msg('u1', 'user'), msg('m2', 'assistant')]);

    await waitFor(() => expect(hook.result.current.error).toBe('SPEECH_UNAVAILABLE'));

    await act(async () => hook.result.current.retry());

    await waitFor(() => expect(hits(calls, SPEECH('m2'))).toBe(2));
    expect(hits(calls, SPEECH('m1'))).toBe(0);
  });

  it('surfaces an unusable recording and re-records on retry', async () => {
    const calls = stubApi({ [UPLOAD]: jsonError(400, 'SPEECH_AUDIO_INVALID') });
    const hook = mount();
    await waitFor(() => expect(audio.players).toHaveLength(1));
    await act(async () => audio.players[0].end());
    await waitFor(() => expect(audio.recorders).toHaveLength(1));

    await act(async () => hook.result.current.stop());

    await waitFor(() => expect(hook.result.current.error).toBe('SPEECH_AUDIO_INVALID'));
    expect(hook.result.current.recording).toBe(false);

    await act(async () => hook.result.current.retry());

    // The retry re-records the same turn — it does not re-buy the interviewer's audio.
    await waitFor(() => expect(audio.recorders).toHaveLength(2));
    expect(hook.result.current.error).toBe(null);
    expect(hits(calls, SPEECH('m1'))).toBe(1);
  });

  it('mute stops the recorder capturing, and unmute resumes it', async () => {
    stubApi();
    const hook = mount();
    await waitFor(() => expect(audio.players).toHaveLength(1));
    await act(async () => audio.players[0].end());
    await waitFor(() => expect(audio.recorders).toHaveLength(1));

    await act(async () => hook.result.current.toggleMute());
    expect(audio.recorders[0].state).toBe('paused');

    await act(async () => hook.result.current.toggleMute());
    expect(audio.recorders[0].state).toBe('recording');
  });

  it('leaves nothing playing or capturing after unmount', async () => {
    stubApi();
    const hook = mount();
    await waitFor(() => expect(audio.players).toHaveLength(1));
    await act(async () => audio.players[0].end());
    await waitFor(() => expect(audio.recorders).toHaveLength(1));

    act(() => hook.unmount());

    expect(audio.recorders[0].state).toBe('inactive');
    expect(audio.players[0].paused).toBe(true);
    expect(mics.tracks[0].stop).toHaveBeenCalled();
    expect(audio.objectUrls.revoked).toBe(audio.objectUrls.created);
  });
});
