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

const {
  closeEventStreams,
  eventNameFor,
  HEARTBEAT_FRAME,
  HEARTBEAT_MS,
  QUESTIONS_READY,
  STATE_CHANGED,
  streamInterviewEvents,
} = await import('./sse');

beforeEach(() => {
  m.duplicate.mockReset();
  m.publish.mockReset();
  m.queueAdd.mockReset();
  m.loggerError.mockReset();
  m.loggerInfo.mockReset();
});

afterEach(() => {
  closeEventStreams();
  vi.useRealTimers();
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

  // Issue 133. A room sits quiet between questions, and silence is what every proxy and NAT
  // on the path reaps. The frames are comments, so they must not reach the client as events.
  describe('heartbeat', () => {
    it('writes a comment frame on an idle stream, inside any 30s window', async () => {
      vi.useFakeTimers();
      mockSubscriber();
      const res = new FakeResponse();

      await streamInterviewEvents({ interview: { id: 'itv_1' } } as never, res as never);
      expect(res.write).not.toHaveBeenCalled();

      vi.advanceTimersByTime(30_000);

      expect(HEARTBEAT_MS).toBeLessThanOrEqual(30_000);
      expect(res.write).toHaveBeenCalledTimes(1);
      expect(res.write).toHaveBeenCalledWith(HEARTBEAT_FRAME);
      // A comment, not an event: `use-interview-events.ts` would otherwise refetch on a tick.
      expect(HEARTBEAT_FRAME.startsWith(':')).toBe(true);
      expect(HEARTBEAT_FRAME).not.toContain('event:');
    });

    it('stops on disconnect — no write lands after the response ends', async () => {
      vi.useFakeTimers();
      mockSubscriber();
      const res = new FakeResponse();

      await streamInterviewEvents({ interview: { id: 'itv_1' } } as never, res as never);
      vi.advanceTimersByTime(HEARTBEAT_MS);
      expect(res.write).toHaveBeenCalledTimes(1);

      res.emit('close');
      // Well past several more intervals: a surviving timer would write after `end()`, which
      // is ERR_STREAM_WRITE_AFTER_END on a real response.
      vi.advanceTimersByTime(HEARTBEAT_MS * 5);

      expect(res.write).toHaveBeenCalledTimes(1);
      expect(vi.getTimerCount()).toBe(0);
    });

    it('leaves event delivery alone', async () => {
      vi.useFakeTimers();
      const { handlers } = mockSubscriber();
      const res = new FakeResponse();

      await streamInterviewEvents({ interview: { id: 'itv_1' } } as never, res as never);
      handlers.get('message')?.('interview:events:itv_1', '{"to":"tech_round"}');
      vi.advanceTimersByTime(HEARTBEAT_MS);

      expect(res.write).toHaveBeenNthCalledWith(
        1,
        `event: ${STATE_CHANGED}\ndata: {"to":"tech_round"}\n\n`,
      );
      expect(res.write).toHaveBeenNthCalledWith(2, HEARTBEAT_FRAME);
    });
  });
});
