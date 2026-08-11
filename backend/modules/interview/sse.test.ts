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
  loggerWarn: vi.fn(),
}));

vi.mock('../auth/rate-limit', () => ({ redis: { publish: m.publish, duplicate: m.duplicate } }));
vi.mock('../../src/lib/queue', () => ({ REPORT_QUEUE: 'report', reportQueue: { add: m.queueAdd } }));
vi.mock('../../src/lib/logger', () => ({
  logger: { error: m.loggerError, info: m.loggerInfo, warn: m.loggerWarn },
}));

const {
  closeEventStreams,
  eventNameFor,
  HEARTBEAT_FRAME,
  HEARTBEAT_MS,
  MAX_STREAMS_PER_USER,
  QUESTIONS_READY,
  STATE_CHANGED,
  streamInterviewEvents,
} = await import('./sse');

/**
 * The handler runs behind `requireAuth` and `resolveInterview`, so both are always populated
 * by the time it is reached. The user is what the per-user stream cap (issue #120) keys on.
 */
const reqFor = (userId = 'u1', interviewId = 'itv_1') =>
  ({ interview: { id: interviewId }, user: { id: userId }, traceId: 'trc_1' }) as never;

beforeEach(() => {
  m.duplicate.mockReset();
  m.publish.mockReset();
  m.queueAdd.mockReset();
  m.loggerError.mockReset();
  m.loggerInfo.mockReset();
  m.loggerWarn.mockReset();
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
  // The refusal path (issue #120) answers as an ordinary JSON response, not an event-stream.
  status = vi.fn(() => this);
  json = vi.fn(() => this);
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

    const pending = streamInterviewEvents(reqFor(), res as never);

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

    await streamInterviewEvents(reqFor(), res as never);

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

      await streamInterviewEvents(reqFor(), res as never);
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

      await streamInterviewEvents(reqFor(), res as never);
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

      await streamInterviewEvents(reqFor(), res as never);
      handlers.get('message')?.('interview:events:itv_1', '{"to":"tech_round"}');
      vi.advanceTimersByTime(HEARTBEAT_MS);

      expect(res.write).toHaveBeenNthCalledWith(
        1,
        `event: ${STATE_CHANGED}\ndata: {"to":"tech_round"}\n\n`,
      );
      expect(res.write).toHaveBeenNthCalledWith(2, HEARTBEAT_FRAME);
    });
  });

  /**
   * Issue #120. Every open stream holds a Redis connection of its own — the handler's own
   * `ponytail:` note says so — and nothing capped how many one account could open, so N tabs
   * was N connections with no ceiling anywhere.
   *
   * The assertions are about the connection, not the status code: a 429 that still called
   * `redis.duplicate()` would have spent exactly what the cap exists to protect.
   */
  describe('per-user stream cap', () => {
    const openStreams = async (count: number, userId = 'u1') => {
      const responses: FakeResponse[] = [];
      for (let i = 0; i < count; i++) {
        const res = new FakeResponse();
        responses.push(res);
        await streamInterviewEvents(reqFor(userId), res as never);
      }
      return responses;
    };

    it('refuses the stream past the cap without opening a Redis connection', async () => {
      mockSubscriber();
      await openStreams(MAX_STREAMS_PER_USER);
      expect(m.duplicate).toHaveBeenCalledTimes(MAX_STREAMS_PER_USER);

      const refused = new FakeResponse();
      await streamInterviewEvents(reqFor(), refused as never);

      expect(m.duplicate).toHaveBeenCalledTimes(MAX_STREAMS_PER_USER);
      expect(refused.status).toHaveBeenCalledWith(429);
      expect(refused.json).toHaveBeenCalledWith({ error: { code: 'RATE_LIMITED' } });
      // Not an event-stream that opens and immediately ends — the client must be able to
      // read this as a refusal rather than as a room that died.
      expect(refused.writeHead).not.toHaveBeenCalled();
      expect(m.loggerWarn).toHaveBeenCalledTimes(1);
    });

    it('is per user, not global — one account cannot exhaust another', async () => {
      mockSubscriber();
      await openStreams(MAX_STREAMS_PER_USER, 'u1');

      const other = new FakeResponse();
      await streamInterviewEvents(reqFor('u2'), other as never);

      expect(other.writeHead).toHaveBeenCalledTimes(1);
      expect(m.duplicate).toHaveBeenCalledTimes(MAX_STREAMS_PER_USER + 1);
    });

    // The failure this would otherwise become: a candidate who closes a room and reopens it
    // five times is locked out of their own interview until the process restarts.
    it('returns the slot when a stream closes', async () => {
      mockSubscriber();
      const responses = await openStreams(MAX_STREAMS_PER_USER);
      responses[0].emit('close');

      const reopened = new FakeResponse();
      await streamInterviewEvents(reqFor(), reopened as never);

      expect(reopened.writeHead).toHaveBeenCalledTimes(1);
      expect(reopened.status).not.toHaveBeenCalled();
    });
  });
});
