/**
 * The channel carries two events over one Redis subscription, so the SSE frame's name is read
 * back off the payload. Getting that wrong is invisible in the backend — the message is still
 * published, still delivered, and only the *client* silently ignores it.
 *
 * `redis` and the BullMQ queues are constructed at import time from `config`, which this unit
 * has no env for and no use for; the module is imported for two pure functions.
 */
import { EventEmitter } from 'node:events';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const m = vi.hoisted(() => ({
  duplicate: vi.fn(),
  publish: vi.fn(),
  queueAdd: vi.fn(),
  loggerError: vi.fn(),
  loggerInfo: vi.fn(),
}));

vi.mock('../auth/rate-limit', () => ({ redis: { publish: m.publish, duplicate: m.duplicate } }));
vi.mock('../../src/lib/queue', () => ({ REPORT_QUEUE: 'report', reportQueue: { add: m.queueAdd } }));
vi.mock('../../src/lib/logger', () => ({
  logger: { error: m.loggerError, info: m.loggerInfo },
}));

const { closeEventStreams, eventNameFor, QUESTIONS_READY, STATE_CHANGED, streamInterviewEvents } =
  await import('./sse');

beforeEach(() => {
  m.duplicate.mockReset();
  m.publish.mockReset();
  m.queueAdd.mockReset();
  m.loggerError.mockReset();
  m.loggerInfo.mockReset();
});

afterEach(() => {
  closeEventStreams();
});

class FakeResponse extends EventEmitter {
  destroyed = false;
  writableEnded = false;
  writeHead = vi.fn();
  flushHeaders = vi.fn();
  write = vi.fn();
  end = vi.fn(() => {
    this.writableEnded = true;
    this.emit('close');
  });
}

function mockSubscriber(
  subscribe: () => Promise<void> = async () => undefined,
): {
  handlers: Map<string, (...args: unknown[]) => void>;
  subscriber: {
    on: ReturnType<typeof vi.fn>;
    subscribe: ReturnType<typeof vi.fn>;
    quit: ReturnType<typeof vi.fn>;
  };
} {
  const handlers = new Map<string, (...args: unknown[]) => void>();
  const subscriber = {
    on: vi.fn((event: string, handler: (...args: unknown[]) => void) => {
      handlers.set(event, handler);
      return subscriber;
    }),
    subscribe: vi.fn(subscribe),
    quit: vi.fn(async () => undefined),
  };
  m.duplicate.mockReturnValue(subscriber);
  return { handlers, subscriber };
}

describe('eventNameFor', () => {
  it('names a questions-ready payload by its type', () => {
    const payload = JSON.stringify({
      type: QUESTIONS_READY,
      interviewId: 'itv_1',
      roundType: 'hr',
    });

    expect(eventNameFor(payload)).toBe(QUESTIONS_READY);
  });

  it('names a transition payload a state change', () => {
    const payload = JSON.stringify({ from: 'profiling', to: 'hr_round', interviewId: 'itv_1' });

    expect(eventNameFor(payload)).toBe(STATE_CHANGED);
  });

  // Mid-deploy: an old replica is still publishing untyped transitions while a new one reads
  // them. Those are state changes, not an unnamed event no client listens for.
  it('treats an untyped payload as a state change', () => {
    expect(eventNameFor('{"to":"tech_round"}')).toBe(STATE_CHANGED);
    expect(eventNameFor('{}')).toBe(STATE_CHANGED);
  });

  // A nudge carries no meaning of its own — the client refetches either way — so a payload
  // that cannot be parsed is still worth delivering under the name every client handles.
  it('falls back to a state change rather than throwing on a malformed payload', () => {
    expect(eventNameFor('not json')).toBe(STATE_CHANGED);
    expect(eventNameFor('')).toBe(STATE_CHANGED);
    expect(eventNameFor('null')).toBe(STATE_CHANGED);
  });
});

describe('streamInterviewEvents', () => {
  it('cleans up if the stream closes before subscribe finishes', async () => {
    let resolveSubscribe!: () => void;
    const subscribed = new Promise<void>((resolve) => {
      resolveSubscribe = resolve;
    });
    const { subscriber } = mockSubscriber(() => subscribed);
    const res = new FakeResponse();

    const pending = streamInterviewEvents({ interview: { id: 'itv_1' } } as never, res as never);

    res.destroyed = true;
    res.emit('close');
    expect(subscriber.quit).toHaveBeenCalledTimes(1);
    expect(res.end).not.toHaveBeenCalled();

    resolveSubscribe();
    await pending;
    expect(subscriber.quit).toHaveBeenCalledTimes(1);
  });

  it('ignores messages after the response is destroyed', async () => {
    const { handlers, subscriber } = mockSubscriber();
    const res = new FakeResponse();

    await streamInterviewEvents({ interview: { id: 'itv_1' } } as never, res as never);

    res.destroyed = true;
    handlers.get('message')?.('interview:events:itv_1', '{"to":"tech_round"}');
    expect(res.write).not.toHaveBeenCalled();

    res.emit('close');
    expect(subscriber.quit).toHaveBeenCalledTimes(1);
  });
});
