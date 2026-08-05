import { act, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { messages, renderWithProviders } from '../../../../test/render';

// One hoisted router object — `useRequireAuth` keys an effect on its identity (W04 trap).
const nav = vi.hoisted(() => ({
  push: vi.fn(),
  replace: vi.fn(),
  prefetch: vi.fn(),
  refresh: vi.fn(),
}));

vi.mock('next/navigation', () => ({
  useRouter: () => nav,
  usePathname: () => '/interviews/i1/pre-join',
  useParams: () => ({ id: 'i1' }),
}));

import PreJoinPage from './page';

const USER = { id: 'u1', email: 'someone@example.com', onboardingCompletedAt: 'now', interviewCount: 1 };

function stubFetch(mode: 'text' | 'voice') {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      const json = (status: number, body: unknown) =>
        new Response(JSON.stringify(body), {
          status,
          headers: { 'content-type': 'application/json' },
        });
      if (url === '/api/me') return json(200, { user: USER });
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
    }),
  );
}

function track() {
  return { stop: vi.fn(), getSettings: () => ({ deviceId: 'mic-a' }) };
}

function stubMic(outcome: 'grant' | 'deny', t = track()) {
  const getUserMedia =
    outcome === 'grant'
      ? vi.fn(async () => ({ getTracks: () => [t], getAudioTracks: () => [t] }) as unknown as MediaStream)
      : vi.fn(async () => Promise.reject(Object.assign(new Error('no'), { name: 'NotAllowedError' })));
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

  it('a denied microphone blocks Enter and shows the recovery steps', async () => {
    stubFetch('voice');
    stubMic('deny');
    await renderPreJoin();

    expect(await screen.findByTestId('mic-recovery')).toBeInTheDocument();
    expect(screen.getByText(messages.preJoin.denied.step2)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: messages.preJoin.enter })).toBeDisabled();
    expect(screen.getByText(messages.preJoin.enterHint)).toBeInTheDocument();
    expect(nav.push).not.toHaveBeenCalled();
  });

  it('a text interview redirects to the room without prompting for a microphone', async () => {
    stubFetch('text');
    const getUserMedia = stubMic('grant');
    await renderPreJoin();

    await waitFor(() => expect(nav.replace).toHaveBeenCalledWith('/interviews/i1/room'));
    expect(getUserMedia).not.toHaveBeenCalled();
    expect(screen.queryByTestId('mic-check')).not.toBeInTheDocument();
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
