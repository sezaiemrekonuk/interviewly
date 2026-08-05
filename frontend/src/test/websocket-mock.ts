import { vi } from 'vitest';

// jsdom ships no WebSocket. The voice session (W10) is the only consumer, but the mock lives
// beside `event-source-mock` because both room suites install a fake transport the same way.
type Listener = (event: Event) => void;

export class MockWebSocket {
  static instances: MockWebSocket[] = [];

  static readonly OPEN = 1;
  static readonly CLOSED = 3;

  readonly listeners = new Map<string, Set<Listener>>();
  readonly sent: string[] = [];
  readyState = 0;
  closed = false;
  closeCode: number | null = null;

  constructor(readonly url: string) {
    MockWebSocket.instances.push(this);
  }

  static get last(): MockWebSocket | undefined {
    return MockWebSocket.instances[MockWebSocket.instances.length - 1];
  }

  addEventListener(type: string, fn: Listener): void {
    const set = this.listeners.get(type) ?? new Set<Listener>();
    set.add(fn);
    this.listeners.set(type, set);
  }

  removeEventListener(type: string, fn: Listener): void {
    this.listeners.get(type)?.delete(fn);
  }

  send(data: string): void {
    this.sent.push(data);
  }

  close(code?: number): void {
    this.closed = true;
    this.closeCode = code ?? null;
    this.readyState = MockWebSocket.CLOSED;
  }

  private fire(event: Event): void {
    this.listeners.get(event.type)?.forEach((fn) => fn(event));
  }

  emitOpen(): void {
    this.readyState = MockWebSocket.OPEN;
    this.fire(new Event('open'));
  }

  /** An agent frame. `type` is the ElevenLabs message discriminator. */
  emitMessage(body: Record<string, unknown>): void {
    this.fire(new MessageEvent('message', { data: JSON.stringify(body) }));
  }

  /** A drop the client did not ask for — the reconnect path. */
  emitClose(): void {
    this.readyState = MockWebSocket.CLOSED;
    this.fire(new CloseEvent('close'));
  }

  emitError(): void {
    this.fire(new Event('error'));
  }
}

export function installWebSocketMock(): typeof MockWebSocket {
  MockWebSocket.instances = [];
  vi.stubGlobal('WebSocket', MockWebSocket);
  return MockWebSocket;
}

/**
 * A `getUserMedia` that hands back stoppable tracks, so "the mic is released on unmount" is
 * an assertion on `stop` rather than on the absence of an error.
 */
export function installMediaDevicesMock(): { tracks: { stop: ReturnType<typeof vi.fn>; enabled: boolean }[] } {
  const tracks: { stop: ReturnType<typeof vi.fn>; enabled: boolean }[] = [];

  const getUserMedia = vi.fn(async () => {
    const track = { stop: vi.fn(), enabled: true, getSettings: () => ({ deviceId: 'mic-1' }) };
    tracks.push(track);
    return { getTracks: () => [track], getAudioTracks: () => [track] } as unknown as MediaStream;
  });

  vi.stubGlobal('navigator', {
    ...globalThis.navigator,
    mediaDevices: {
      getUserMedia,
      enumerateDevices: vi.fn(async () => [{ kind: 'audioinput', deviceId: 'mic-1', label: 'Built-in' }]),
    },
  });

  return { tracks };
}
