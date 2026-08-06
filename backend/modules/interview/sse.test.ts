/**
 * The channel carries two events over one Redis subscription, so the SSE frame's name is read
 * back off the payload. Getting that wrong is invisible in the backend — the message is still
 * published, still delivered, and only the *client* silently ignores it.
 *
 * `redis` and the BullMQ queues are constructed at import time from `config`, which this unit
 * has no env for and no use for; the module is imported for two pure functions.
 */
import { describe, expect, it, vi } from 'vitest';

vi.mock('../auth/rate-limit', () => ({ redis: { publish: vi.fn(), duplicate: vi.fn() } }));
vi.mock('../../src/lib/queue', () => ({ REPORT_QUEUE: 'report', reportQueue: { add: vi.fn() } }));

const { eventNameFor, QUESTIONS_READY, STATE_CHANGED } = await import('./sse');

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
