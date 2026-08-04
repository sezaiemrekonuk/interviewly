import { vi } from 'vitest';

// jsdom has no EventSource. W06/W07/W10 mount the same hook, so the mock lives here
// rather than being re-written per room test.
type Listener = (event: MessageEvent | Event) => void;

export class MockEventSource {
  static instances: MockEventSource[] = [];

  readonly listeners = new Map<string, Set<Listener>>();
  closed = false;
  onmessage: Listener | null = null;
  onopen: Listener | null = null;

  constructor(readonly url: string) {
    MockEventSource.instances.push(this);
  }

  addEventListener(type: string, fn: Listener): void {
    const set = this.listeners.get(type) ?? new Set<Listener>();
    set.add(fn);
    this.listeners.set(type, set);
  }

  removeEventListener(type: string, fn: Listener): void {
    this.listeners.get(type)?.delete(fn);
  }

  close(): void {
    this.closed = true;
  }

  /** Server-sent named event (the backend emits `INTERVIEW_STATE_CHANGED`). */
  emit(type = 'message', data = '{}'): void {
    const event = new MessageEvent(type, { data });
    if (type === 'message') this.onmessage?.(event);
    this.listeners.get(type)?.forEach((fn) => fn(event));
  }

  /** A reconnect: EventSource re-fires `open` on its own after a drop. */
  emitOpen(): void {
    const event = new Event('open');
    this.onopen?.(event);
    this.listeners.get('open')?.forEach((fn) => fn(event));
  }
}

export function installEventSourceMock(): typeof MockEventSource {
  MockEventSource.instances = [];
  vi.stubGlobal('EventSource', MockEventSource);
  return MockEventSource;
}
