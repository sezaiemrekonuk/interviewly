import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { MockWebSocket, installMediaDevicesMock, installWebSocketMock } from '../test/websocket-mock';
import { useVoiceSession } from './use-voice-session';

const MINT = {
  token: 'sess-token',
  wssOrigin: 'wss://voice.example',
  dynamicVars: { interviewId: 'i1', nonce: 'n1' },
  expiresAt: '2026-08-05T10:10:00.000Z',
};

function stubMint(result: { ok: boolean; code?: string } = { ok: true }) {
  const json = (status: number, body: unknown) =>
    new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

  const fetchMock = vi.fn(async (url: string) => {
    if (url === '/api/interviews/i1/voice/session') {
      return result.ok ? json(201, MINT) : json(503, { error: { code: result.code ?? 'VOICE_UNAVAILABLE' } });
    }
    return json(404, { error: { code: 'NOT_FOUND' } });
  });

  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

describe('useVoiceSession (W10)', () => {
  let mics: ReturnType<typeof installMediaDevicesMock>;

  beforeEach(() => {
    installWebSocketMock();
    mics = installMediaDevicesMock();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('mints, opens the transport and reports connected', async () => {
    const fetchMock = stubMint();
    const { result } = renderHook(() => useVoiceSession('i1'));

    expect(result.current.status).toBe('connecting');
    await waitFor(() => expect(MockWebSocket.last).toBeDefined());

    // The origin is used as given; the token never rides in the URL where it would land in
    // a proxy access log.
    expect(MockWebSocket.last!.url).toBe('wss://voice.example');
    expect(MockWebSocket.last!.url).not.toContain(MINT.token);

    await act(async () => {
      MockWebSocket.last!.emitOpen();
    });
    await waitFor(() => expect(result.current.status).toBe('connected'));

    // The mint is the only HTTP call the session makes — it never reads or writes room state.
    expect(fetchMock.mock.calls.every(([url]) => url === '/api/interviews/i1/voice/session')).toBe(true);
  });

  it('drives local beats from turn frames without touching room state', async () => {
    const fetchMock = stubMint();
    const { result } = renderHook(() => useVoiceSession('i1'));
    await waitFor(() => expect(MockWebSocket.last).toBeDefined());
    const ws = MockWebSocket.last!;

    await act(async () => ws.emitOpen());

    await act(async () => ws.emitMessage({ type: 'agent_response' }));
    await waitFor(() => expect(result.current.beat).toBe('speaking'));

    await act(async () => ws.emitMessage({ type: 'agent_response_end' }));
    await waitFor(() => expect(result.current.beat).toBe('listening'));

    await act(async () => ws.emitMessage({ type: 'user_transcript' }));
    await waitFor(() => expect(result.current.beat).toBe('acknowledging'));

    // K11 — a turn boundary is a beat, not an advance. No state fetch was provoked by any of it.
    expect(fetchMock.mock.calls.some(([url]) => String(url).includes('/state'))).toBe(false);
  });

  it('reports lost on an unrequested drop and re-mints on reconnect', async () => {
    const fetchMock = stubMint();
    const onResync = vi.fn();
    const { result } = renderHook(() => useVoiceSession('i1', { onResync }));
    await waitFor(() => expect(MockWebSocket.last).toBeDefined());

    await act(async () => MockWebSocket.last!.emitOpen());
    await waitFor(() => expect(result.current.status).toBe('connected'));

    await act(async () => MockWebSocket.last!.emitClose());
    await waitFor(() => expect(result.current.status).toBe('lost'));

    const mintsBefore = fetchMock.mock.calls.length;
    await act(async () => result.current.reconnect());
    await waitFor(() => expect(fetchMock.mock.calls.length).toBeGreaterThan(mintsBefore));
    await waitFor(() => expect(MockWebSocket.instances).toHaveLength(2));

    await act(async () => MockWebSocket.last!.emitOpen());
    await waitFor(() => expect(result.current.status).toBe('connected'));

    // V05 reconciles the server; the client re-syncs by refetching state, never from the socket.
    expect(onResync).toHaveBeenCalled();
  });

  it('goes lost and asks for a re-sync when the mint refuses (server downgraded to text)', async () => {
    stubMint({ ok: false, code: 'VOICE_UNAVAILABLE' });
    const onResync = vi.fn();
    const { result } = renderHook(() => useVoiceSession('i1', { onResync }));

    await waitFor(() => expect(result.current.status).toBe('lost'));
    expect(MockWebSocket.instances).toHaveLength(0);
    // V03 already flipped mode to text server-side — the refetch is what surfaces it.
    await waitFor(() => expect(onResync).toHaveBeenCalled());
  });

  it('mutes by disabling the track rather than dropping the session', async () => {
    stubMint();
    const { result } = renderHook(() => useVoiceSession('i1'));
    await waitFor(() => expect(mics.tracks).toHaveLength(1));
    await act(async () => MockWebSocket.last?.emitOpen());

    await act(async () => result.current.toggleMute());
    await waitFor(() => expect(result.current.muted).toBe(true));
    expect(mics.tracks[0].enabled).toBe(false);
    expect(mics.tracks[0].stop).not.toHaveBeenCalled();
    expect(MockWebSocket.last!.closed).toBe(false);

    await act(async () => result.current.toggleMute());
    await waitFor(() => expect(mics.tracks[0].enabled).toBe(true));
  });

  it('closes the socket and stops the mic track on unmount', async () => {
    stubMint();
    const { unmount } = renderHook(() => useVoiceSession('i1'));
    await waitFor(() => expect(MockWebSocket.last).toBeDefined());
    await waitFor(() => expect(mics.tracks).toHaveLength(1));
    await act(async () => MockWebSocket.last!.emitOpen());

    unmount();

    // No hot mic carried out of the room, and no socket left holding a minted session.
    expect(mics.tracks[0].stop).toHaveBeenCalled();
    expect(MockWebSocket.last!.closed).toBe(true);
  });
});
