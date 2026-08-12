import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { RoomMessage } from './query';
import {
  FLUSH_HELD_MS,
  FORCE_SUBMIT_MS,
  useVoiceSession,
  VAD_SILENCE_MS,
  VAD_THRESHOLD,
} from './use-voice-session';
import { takeFlushed } from './voice/unload-flush';
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
const TURNS = '/api/interviews/i1/turns';

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

  // The identity trap. `useInterviewEvents` invalidates the state query on every SSE
  // INTERVIEW_STATE_CHANGED — which `applyTransition` publishes mid-request, so a handover or an
  // ending reliably fires one — and an EventSource reconnect fires another. react-query hands back
  // a NEW array for the same rows on every one of those refetches. If that identity is what the
  // speak effect depends on, the refetch tears the in-flight turn down: every id is already
  // marked spoken, the re-run finds nothing pending and returns, and the recorder is never opened.
  // `phase` is then stuck on 'speaking' forever — `retry` only renders on 'failed', so the room
  // has no way out and the candidate's mic never opens again.
  it('opens the mic after a refetch hands back a new array of the same messages', async () => {
    const calls = stubApi();
    const hook = mount();

    await waitFor(() => expect(audio.players).toHaveLength(1));

    // Exactly what an SSE-driven invalidate produces: same rows, new array.
    hook.rerender({ messages: [msg('m1', 'assistant')] });
    await act(async () => audio.level(0.002, 3));

    await act(async () => audio.players[0].end());

    await waitFor(() => expect(audio.recorders).toHaveLength(1));
    expect(hook.result.current.recording).toBe(true);
    // ...and the line the refetch re-delivered is not read out a second time.
    expect(hits(calls, SPEECH('m1'))).toBe(1);
    expect(audio.players).toHaveLength(1);
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

  // L02 — the turn response names the line it wrote, so the room fetches its audio off that
  // response rather than waiting for the /state refetch to reveal it. The speak effect still
  // plays and reconciles; it reuses the in-flight fetch instead of issuing a second one.
  it('fetches a conducted line off the turn response, before the refetch, and reuses it', async () => {
    const calls = stubApi({
      [UPLOAD]: () =>
        new Response(
          JSON.stringify({ state: 'hr_round', currentIndex: 1, pendingTurn: null, spokenIds: ['m2'] }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        ),
    });
    const hook = await recording(mount());

    await act(async () => hook.result.current.stop());

    // Its audio is already being fetched, though no message update has surfaced m2 yet.
    await waitFor(() => expect(hits(calls, SPEECH('m2'))).toBe(1));
    expect(audio.players).toHaveLength(1);

    // The refetch now hands the room the new line: it plays, reusing the fetch — not a second GET.
    hook.rerender({ messages: [msg('m1', 'assistant'), msg('u1', 'user'), msg('m2', 'assistant')] });
    await waitFor(() => expect(audio.players).toHaveLength(2));
    expect(hits(calls, SPEECH('m2'))).toBe(1);
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

  // ADR-T08 — a tripwire, not an obstacle. Both windows are numbers the owner has now moved
  // twice by sitting in the room, and neither should ever move again without someone deciding
  // to: a candidate's thinking time and the cost of a wrongly held answer are what they price.
  it('waits six seconds on a silent turn and four on a held one', () => {
    expect(FORCE_SUBMIT_MS).toBe(6_000);
    expect(FLUSH_HELD_MS).toBe(4_000);
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

/**
 * T04 — the recorder still stops on silence, the TURN no longer ends there.
 *
 * Fake timers throughout, and every wait is an explicit advance: the silent-turn clock is not a window
 * a test can sit through, and a real-clock `waitFor` racing a request the loop has to issue is
 * what made issue #219 red-light PRs that touched nothing near the room.
 */
describe('useVoiceSession — a pause is not the end of the turn (T04)', () => {
  let audio: AudioHarness;
  let client: QueryClient;

  beforeEach(() => {
    // Timers and the clock only. `requestAnimationFrame` is the harness's — faking it too would
    // take the meter's loop away from `audio.level()`, and the VAD reads nothing but that level.
    vi.useFakeTimers({
      toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date'],
    });
    installMediaDevicesMock();
    audio = installAudioMock();
    client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  const json = (body: unknown) =>
    new Response(JSON.stringify(body), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });

  /** What `POST /turns/audio` answers: the joined text while it is held, null once conducted. */
  const held = (text: string | null) => () =>
    json({ state: 'hr_round', currentIndex: 1, pendingTurn: text });

  const tick = async (ms = 0) => {
    await act(async () => {
      await vi.advanceTimersByTimeAsync(ms);
    });
  };

  /** Greeting spoken, recorder open — the state every turn below starts from. */
  async function listening(routes: Record<string, () => Response> = {}) {
    const calls = stubApi(routes);
    const hook = renderHook(
      () => useVoiceSession('i1', { enabled: true, messages: MESSAGES, speakable: true, vad: VAD }),
      { wrapper: wrapper(client) },
    );
    await tick();
    await tick();
    expect(audio.players).toHaveLength(1);
    await act(async () => audio.players[0].end());
    await tick();
    expect(audio.recorders).toHaveLength(1);
    return { hook, calls };
  }

  /** A sentence, then a mid-thought pause long enough for the VAD to stop the recorder. */
  async function pause() {
    await act(async () => audio.level(VAD_THRESHOLD + 0.2));
    await act(async () => audio.level(0));
    await tick(VAD.silenceMs + 200);
  }

  it('keeps listening and re-opens the recorder while the server holds the fragment', async () => {
    const { hook, calls } = await listening({ [UPLOAD]: held('I was going to say') });

    await pause();

    expect(audio.recorders[0].stops).toBe(1);
    expect(hits(calls, UPLOAD)).toBe(1);
    // The turn did not end: a second recorder is open and the room still says listening.
    expect(audio.recorders).toHaveLength(2);
    expect(audio.recorders[1].state).toBe('recording');
    expect(hook.result.current.recording).toBe(true);
    expect(hook.result.current.beat).toBe('listening');
    expect(hook.result.current.holding).toBe(true);
  });

  // The failure this ledger exists to fix, moved one second later: with the restart after the
  // round trip, everything said while the probe is in flight is recorded by nobody.
  it('re-opens the recorder BEFORE the upload leaves', async () => {
    let openAtUpload = 0;
    await listening({
      [UPLOAD]: () => {
        openAtUpload = audio.recorders.length;
        return held('I was going to say')();
      },
    });

    await pause();

    expect(openAtUpload).toBe(2);
  });

  it('ends the turn, and closes the mic it just re-opened, once the server conducted it', async () => {
    const { hook, calls } = await listening({ [UPLOAD]: held(null) });

    await pause();

    // The interviewer is about to speak; an open mic would record the TTS.
    expect(audio.recorders).toHaveLength(2);
    expect(audio.recorders[1].state).toBe('inactive');
    expect(hook.result.current.recording).toBe(false);
    expect(hook.result.current.beat).toBe(null);
    expect(hook.result.current.holding).toBe(false);
    // ...and the discarded recorder's bytes were never sent.
    expect(hits(calls, UPLOAD)).toBe(1);
  });

  it('submits a silence turn once the window passes, uploads no audio, and does it once', async () => {
    const { calls } = await listening();

    await tick(FORCE_SUBMIT_MS + 200);

    expect(hits(calls, TURNS)).toBe(1);
    const turn = calls.find((call) => call.url === TURNS)!;
    expect(JSON.parse(turn.body as string)).toEqual({ kind: 'silence', inputMode: 'voice' });
    // A turn the candidate never spoke into is not worth an STT charge.
    expect(hits(calls, UPLOAD)).toBe(0);
    expect(audio.recorders[0].stops).toBe(1);

    await tick(FORCE_SUBMIT_MS * 2);
    expect(hits(calls, TURNS)).toBe(1);
  });

  // The clock measures silence since the last thing heard, so a candidate mid-sentence at the
  // silent-turn mark is not cut off — the VAD probe is what ends their pause.
  it('does not fire the silence clock while a probe upload is in flight', async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const { calls } = await listening({
      [UPLOAD]: () => {
        // The route the harness sees is synchronous, so the hold goes on the response body.
        return new Response(
          new ReadableStream({
            async start(controller) {
              await gate;
              controller.enqueue(
                new TextEncoder().encode(
                  JSON.stringify({ state: 'hr_round', currentIndex: 1, pendingTurn: 'half' }),
                ),
              );
              controller.close();
            },
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        );
      },
    });

    await pause();
    await tick(FORCE_SUBMIT_MS + 200);

    expect(hits(calls, TURNS)).toBe(0);

    release();
    await tick();
  });

  // ADR-T07 — the bug that cost four live runs. `VAD_THRESHOLD` is a loud voice on a close mic;
  // a laptop mic at arm's length is an order of magnitude quieter, so `heardRef` never armed, no
  // probe was ever sent, and the room sat listening to a candidate who was talking to it. The
  // room now measures what silence sounds like on THIS microphone and calls speech anything well
  // above it.
  it('probes speech that never reaches the absolute threshold', async () => {
    const { calls } = await listening({ [UPLOAD]: held(null) });

    // A quiet room, so the floor is learned.
    await act(async () => audio.level(0.001, 4));
    // A quiet speaker: a fifth of `VAD_THRESHOLD`, and inaudible to the old rule.
    await act(async () => audio.level(0.012, 4));
    await act(async () => audio.level(0.001));
    await tick(VAD.silenceMs + 200);

    expect(hits(calls, UPLOAD)).toBe(1);
  });

  // The other half of adapting: a room with a loud noise floor must not talk to itself. Ambient
  // never counts as speech, however high it sits.
  it('never arms on the noise floor itself, however loud the room is', async () => {
    const { calls } = await listening({ [UPLOAD]: held(null) });

    await act(async () => audio.level(0.02, 20));
    await tick(VAD.silenceMs * 5);

    expect(hits(calls, UPLOAD)).toBe(0);
  });

  // ADR-T06 — the two clocks. A candidate the server is already holding a fragment for has
  // spoken, has paused, and has had the gate's verdict; four seconds later the room says so. A
  // candidate who has said nothing at all is thinking, and the longer window is theirs.
  it('flushes a held fragment after four seconds, not six', async () => {
    const { calls } = await listening({ [UPLOAD]: held('I was going to say') });

    await pause();
    expect(hits(calls, TURNS)).toBe(0);

    await tick(FLUSH_HELD_MS + 200);

    expect(hits(calls, TURNS)).toBe(1);
    expect(JSON.parse(calls.find((call) => call.url === TURNS)!.body as string)).toEqual({
      kind: 'silence',
      inputMode: 'voice',
    });

    await tick(FORCE_SUBMIT_MS * 2);
    expect(hits(calls, TURNS)).toBe(1);
  });

  it('still gives a turn nothing was said into the full thinking window', async () => {
    const { calls } = await listening();

    await tick(FLUSH_HELD_MS + 200);
    expect(hits(calls, TURNS)).toBe(0);

    await tick(FORCE_SUBMIT_MS);
    expect(hits(calls, TURNS)).toBe(1);
  });

  // Stop is the escape hatch (ADR-S06): it ends the turn whatever the gate would have said.
  it('forces the turn on a manual stop', async () => {
    const { hook, calls } = await listening({ [UPLOAD]: held(null) });

    await act(async () => hook.result.current.stop());
    await tick();

    const forced = calls.find((call) => call.url === UPLOAD)!.body as FormData;
    expect(forced.get('force')).toBe('1');
    expect(audio.recorders).toHaveLength(1);
  });

  it('never forces a probe — the gate is the whole point of one', async () => {
    const { calls } = await listening({ [UPLOAD]: held('still going') });

    await pause();

    const probe = calls.find((call) => call.url === UPLOAD)!.body as FormData;
    expect(probe.get('force')).toBe(null);
  });
});

/**
 * T07 — the speech that never reached a probe. T06 fixed the case where a pause had happened:
 * the fragment is on the server and the reloaded room recovers it. What is still lost is an
 * utterance the candidate is in the MIDDLE of — nothing has been uploaded, and the browser's
 * audio dies with the document.
 *
 * Real timers here: nothing below waits on either clock, and the flush is synchronous.
 */
describe('useVoiceSession — speech the page takes with it (T07)', () => {
  let audio: AudioHarness;
  let client: QueryClient;
  let beacon: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    installMediaDevicesMock();
    audio = installAudioMock();
    client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    sessionStorage.clear();
    // jsdom has no `sendBeacon` at all, so this is a definition rather than a spy.
    beacon = vi.fn(() => true);
    Object.defineProperty(navigator, 'sendBeacon', { value: beacon, configurable: true });
  });

  afterEach(() => {
    Reflect.deleteProperty(navigator, 'sendBeacon');
    vi.unstubAllGlobals();
  });

  function mount() {
    return renderHook(
      () => useVoiceSession('i1', { enabled: true, messages: MESSAGES, speakable: true, vad: VAD }),
      { wrapper: wrapper(client) },
    );
  }

  /** Greeting spoken, recorder open — the state every flush below is interrupted from. */
  async function listening() {
    const calls = stubApi();
    const hook = mount();
    await waitFor(() => expect(audio.players).toHaveLength(1));
    await act(async () => audio.players[0].end());
    await waitFor(() => expect(audio.recorders).toHaveLength(1));
    return { hook, calls };
  }

  const hide = async () => {
    await act(async () => {
      window.dispatchEvent(new Event('pagehide'));
    });
  };

  const beaconed = () => beacon.mock.calls[0][1] as FormData;

  it('records in chunks, so there is something to flush before the stop', async () => {
    await listening();

    expect(audio.recorders[0].timeslice).toBe(1_000);
  });

  it('posts what has been recorded so far when the page goes away, unforced', async () => {
    await listening();
    audio.recorders[0].chunk(2_000, 'H');
    audio.recorders[0].chunk(2_000, 'Z');

    await hide();

    expect(beacon).toHaveBeenCalledTimes(1);
    expect(beacon.mock.calls[0][0]).toBe(UPLOAD);
    const form = beaconed();
    // A flush is an ordinary probe: the gate decides whether it finished a turn (ADR-T02).
    expect(form.get('force')).toBe(null);
    const file = form.get('audio') as File;
    // Bare media type, the same allow-list the normal upload is written against.
    expect(file.type).toBe('audio/webm');
    expect(await file.text()).toBe('H'.repeat(2_000) + 'Z'.repeat(2_000));
  });

  // The flush and the reloaded room are two documents; this is the only thing that crosses
  // between them. Without it the new page reads `/state` before the gate has written and freezes
  // on a null — the fragment lands a second later and is never shown.
  it('leaves a marker for the reloaded room, and only once it has actually sent', async () => {
    await listening();
    audio.recorders[0].chunk(2_000, 'H');
    audio.recorders[0].chunk(2_000, 'Z');
    expect(takeFlushed('i1')).toBe(false);

    await hide();

    expect(takeFlushed('i1')).toBe(true);
  });

  it('leaves no marker when the browser refuses the beacon', async () => {
    beacon.mockReturnValue(false);
    await listening();
    audio.recorders[0].chunk(2_000, 'H');
    audio.recorders[0].chunk(2_000, 'Z');

    await hide();

    expect(takeFlushed('i1')).toBe(false);
  });

  it('sends nothing when no recording is open', async () => {
    stubApi();
    mount();
    await waitFor(() => expect(audio.players).toHaveLength(1));

    await hide();

    expect(beacon).not.toHaveBeenCalled();
  });

  // The container header with no audio after it: a refresh in the second before the candidate
  // said anything is not worth an STT charge, and there is nothing in it to recover.
  it('sends nothing when only the header has been recorded', async () => {
    await listening();
    audio.recorders[0].chunk(2_000, 'H');

    await hide();

    expect(beacon).not.toHaveBeenCalled();
  });

  it('flushes once, however many times the page says it is leaving', async () => {
    await listening();
    audio.recorders[0].chunk(2_000, 'H');
    audio.recorders[0].chunk(2_000, 'Z');

    await hide();
    await hide();

    expect(beacon).toHaveBeenCalledTimes(1);
  });

  // A beacon is capped near 64 KiB and the browser refuses the whole payload rather than
  // truncating it. What survives is the TAIL — the words the candidate was in the middle of —
  // carried by the first chunk, which is the only one with the WebM header in it. A tail without
  // that header is not a file any decoder will take.
  it('keeps the header and the last of a recording too long to fit in one beacon', async () => {
    await listening();
    const recorder = audio.recorders[0];
    recorder.chunk(8_000, 'H');
    for (let i = 0; i < 6; i += 1) recorder.chunk(8_000, 'M');
    for (let i = 0; i < 6; i += 1) recorder.chunk(8_000, 'Z');

    await hide();

    const file = beaconed().get('audio') as File;
    const text = await file.text();
    expect(file.size).toBeLessThanOrEqual(64 * 1_024);
    expect(text.startsWith('H'.repeat(8_000))).toBe(true);
    expect(text.endsWith('Z'.repeat(8_000))).toBe(true);
    // The middle is what a cap costs, and it is the oldest speech — not the newest.
    expect(text).not.toContain('M');
  });

  // The page may survive the event (a backgrounded tab, restored). The beaconed audio must not
  // then be uploaded a second time and joined onto the same turn twice — but the header has to
  // stay, or what the recorder assembles at `stop()` has no container at all.
  it('never uploads the flushed audio a second time, and still uploads a decodable file', async () => {
    const { hook, calls } = await listening();
    audio.recorders[0].chunk(2_000, 'H');
    audio.recorders[0].chunk(2_000, 'Z');

    await hide();
    await act(async () => hook.result.current.stop());

    await waitFor(() => expect(hits(calls, UPLOAD)).toBe(1));
    const uploaded = await ((calls.find((call) => call.url === UPLOAD)!.body as FormData).get(
      'audio',
    ) as File).text();
    expect(uploaded.startsWith('H'.repeat(2_000))).toBe(true);
    expect(uploaded).not.toContain('Z');
  });

  // Best-effort, never load-bearing: a refused beacon costs nothing, says nothing, and leaves
  // every byte where a normal upload will still find it.
  it('loses nothing and shows nothing when the browser refuses the beacon', async () => {
    beacon.mockReturnValue(false);
    const { hook, calls } = await listening();
    audio.recorders[0].chunk(2_000, 'H');
    audio.recorders[0].chunk(2_000, 'Z');

    await hide();
    await act(async () => hook.result.current.stop());

    expect(hook.result.current.error).toBe(null);
    await waitFor(() => expect(hits(calls, UPLOAD)).toBe(1));
    const uploaded = await ((calls.find((call) => call.url === UPLOAD)!.body as FormData).get(
      'audio',
    ) as File).text();
    expect(uploaded).toContain('Z');
  });
});
