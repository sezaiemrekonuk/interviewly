import { act, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

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
  usePathname: () => '/interviews/i1/pre-join',
  useParams: () => ({ id: 'i1' }),
}));

import PreJoinPage from './page';

const USER = { id: 'u1', email: 'someone@example.com', onboardingCompletedAt: 'now', interviewCount: 1 };

function stubFetch(mode: 'text' | 'voice') {
  const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    const json = (status: number, body: unknown) =>
      new Response(JSON.stringify(body), {
        status,
        headers: { 'content-type': 'application/json' },
      });
    if (url === '/api/me') return json(200, { user: USER });
    if (url === '/api/interviews/i1/voice/downgrade' && init?.method === 'POST') {
      return json(200, { mode: 'text' });
    }
    if (url === '/api/interviews/i1/state') {
      return json(200, {
        interviewId: 'i1',
        state: 'in_progress',
        mode,
        currentIndex: 0,
        targetQuestionCount: 8,
        endedReason: null,
        language: 'en',
        persona: null,
        personas: [],
        currentQuestion: null,
        transcript: [],
        transcriptCursor: 0,
      });
    }
    return json(404, { error: { code: 'NOT_FOUND' } });
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

const downgraded = (fetchMock: ReturnType<typeof stubFetch>) =>
  fetchMock.mock.calls.filter(
    ([url, init]) => url === '/api/interviews/i1/voice/downgrade' && init?.method === 'POST',
  );

function track() {
  return { stop: vi.fn(), getSettings: () => ({ deviceId: 'mic-a' }) };
}

function stubMic(outcome: 'grant' | 'deny' | 'missing', t = track()) {
  const refusal = outcome === 'missing' ? 'NotFoundError' : 'NotAllowedError';
  const getUserMedia =
    outcome === 'grant'
      ? vi.fn(async () => ({ getTracks: () => [t], getAudioTracks: () => [t] }) as unknown as MediaStream)
      : vi.fn(async () => Promise.reject(Object.assign(new Error('no'), { name: refusal })));
  Object.defineProperty(navigator, 'mediaDevices', {
    value: { getUserMedia, enumerateDevices: vi.fn(async () => []) },
    configurable: true,
  });
  return getUserMedia;
}

async function renderPreJoin() {
  await act(async () => {
    renderWithProviders(<PreJoinPage />);
  });
}

describe('pre-join (W09)', () => {
  beforeEach(() => {
    nav.push.mockReset();
    nav.replace.mockReset();
  });

  afterEach(() => {
    Object.defineProperty(navigator, 'mediaDevices', { value: undefined, configurable: true });
    vi.unstubAllGlobals();
  });

  it('a granted microphone enables Enter and navigates to the room', async () => {
    stubFetch('voice');
    stubMic('grant');
    await renderPreJoin();

    const enter = await screen.findByRole('button', { name: messages.preJoin.enter });
    await waitFor(() => expect(enter).toBeEnabled());
    await userEvent.click(enter);

    expect(nav.push).toHaveBeenCalledWith('/interviews/i1/room');
  });

  it('a denied microphone still shows the recovery steps', async () => {
    stubFetch('voice');
    stubMic('deny');
    await renderPreJoin();

    expect(await screen.findByTestId('mic-recovery')).toBeInTheDocument();
    expect(screen.getByText(messages.preJoin.denied.step2)).toBeInTheDocument();
    expect(nav.push).not.toHaveBeenCalled();
  });

  // S07: the dead end. `denied` disabled the CTA and `unavailable` removed it, so a candidate
  // with no working microphone could not reach their interview at all.
  it('a denied microphone downgrades to text and offers the room', async () => {
    const fetchMock = stubFetch('voice');
    stubMic('deny');
    await renderPreJoin();

    await waitFor(() => expect(downgraded(fetchMock)).toHaveLength(1));
    expect(await screen.findByText(messages.errors.VOICE_UNAVAILABLE)).toBeInTheDocument();

    const enter = screen.getByRole('button', { name: messages.preJoin.enter });
    await waitFor(() => expect(enter).toBeEnabled());
    await userEvent.click(enter);

    expect(nav.push).toHaveBeenCalledWith('/interviews/i1/room');
    // No provider call may precede Join — the TTS route is the only client-side spend.
    expect(fetchMock.mock.calls.some(([url]) => String(url).includes('/speech'))).toBe(false);
  });

  it('a missing microphone downgrades to text and offers the room', async () => {
    const fetchMock = stubFetch('voice');
    stubMic('missing');
    await renderPreJoin();

    expect(await screen.findByTestId('mic-unavailable')).toBeInTheDocument();
    await waitFor(() => expect(downgraded(fetchMock)).toHaveLength(1));
    expect(await screen.findByText(messages.errors.VOICE_UNAVAILABLE)).toBeInTheDocument();

    const enter = screen.getByRole('button', { name: messages.preJoin.enter });
    await waitFor(() => expect(enter).toBeEnabled());
  });

  it('downgrades once even as the mic state settles', async () => {
    const fetchMock = stubFetch('voice');
    stubMic('deny');
    await renderPreJoin();

    await waitFor(() => expect(downgraded(fetchMock)).toHaveLength(1));
    await act(async () => {
      await Promise.resolve();
    });
    expect(downgraded(fetchMock)).toHaveLength(1);
  });

  it('a text interview redirects to the room without prompting for a microphone', async () => {
    stubFetch('text');
    const getUserMedia = stubMic('grant');
    await renderPreJoin();

    await waitFor(() => expect(nav.replace).toHaveBeenCalledWith('/interviews/i1/room'));
    expect(getUserMedia).not.toHaveBeenCalled();
    expect(screen.queryByTestId('mic-check')).not.toBeInTheDocument();
  });

  // The camera is optional and never a gate: it is asked for when the candidate asks for it,
  // and a screen that never gets a click must not have touched it.
  it('previews the camera only once the candidate turns it on', async () => {
    stubFetch('voice');
    const getUserMedia = stubMic('grant');
    await renderPreJoin();

    await screen.findByTestId('device-check');
    expect(screen.getByTestId('camera-view')).toHaveAttribute('data-camera', 'off');
    expect(JSON.stringify(getUserMedia.mock.calls)).not.toContain('video');

    await userEvent.click(screen.getByRole('button', { name: messages.preJoin.camera.turnOn }));

    await waitFor(() =>
      expect(screen.getByTestId('camera-view')).toHaveAttribute('data-camera', 'live'),
    );
    expect(getUserMedia).toHaveBeenCalledWith({ video: true, audio: false });
  });

  // The lobby's other round control. Muting disables the track rather than dropping it, so the
  // gate stays green — a muted candidate is ready to join, they are just not talking yet.
  it('mutes from the preview without closing the way in', async () => {
    stubFetch('voice');
    const t = track();
    stubMic('grant', t);
    await renderPreJoin();

    const toggle = await screen.findByTestId('mic-toggle');
    await waitFor(() => expect(toggle).toHaveAttribute('aria-pressed', 'true'));
    await userEvent.click(toggle);

    expect(toggle).toHaveAttribute('aria-pressed', 'false');
    expect(screen.getByText(messages.preJoin.muted)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: messages.preJoin.enter })).toBeEnabled();
  });

  it('leaving the screen stops the media track', async () => {
    stubFetch('voice');
    const t = track();
    stubMic('grant', t);
    const { unmount } = renderWithProviders(<PreJoinPage />);
    await screen.findByTestId('mic-check');
    await waitFor(() => expect(t.stop).not.toHaveBeenCalled());

    unmount();

    expect(t.stop).toHaveBeenCalled();
  });
});
