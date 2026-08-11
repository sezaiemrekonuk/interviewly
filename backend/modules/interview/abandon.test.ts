/**
 * Which of the two endings `POST /abandon` picks, and on what.
 *
 * Issue 104. The branch is the whole handler: a candidate who answered something has an
 * interview worth evaluating and goes through `evaluating`, which is the report path a
 * completed interview already takes; one who answered nothing ends at `abandoned`, because
 * enqueueing a report over an empty transcript spends a provider call to say so.
 *
 * `applyTransition` is mocked to a pass-through — which edges are legal is `machine.test.ts`'s
 * subject, and asserting it twice would let the two drift apart. What is asserted here is the
 * target and the `ended_reason` this handler chooses, plus the fact that it delegates legality
 * rather than re-deciding it.
 */
import type { Interview } from '@prisma/client';
import type { Request, Response } from 'express';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const answerCount = vi.fn(async () => 0);
vi.mock('../../src/lib/db', () => ({
  prisma: { answer: { count: (args: unknown) => answerCount(args as never) } },
}));

const applyTransition = vi.fn(async (interview: Interview, to: string) => {
  interview.state = to as Interview['state'];
  return to;
});
vi.mock('./machine', () => ({
  applyTransition: (interview: Interview, to: string, ctx: unknown) =>
    applyTransition(interview, to, ctx as never),
}));

const info = vi.fn();
vi.mock('../../src/lib/logger', () => ({ logger: { info: (...a: unknown[]) => info(...a) } }));

const { abandonInterview } = await import('./abandon');

function leave(state: string) {
  const interview = { id: 'itv_1', user_id: 'usr_1', state } as unknown as Interview;

  const json = vi.fn();
  const res = { status: vi.fn(() => ({ json })) } as unknown as Response;
  const req = { interview, user: { id: 'usr_1' }, traceId: 'trace-1' } as unknown as Request;
  const next = vi.fn();

  const handler = abandonInterview as unknown as (
    req: Request,
    res: Response,
    next: () => void,
  ) => Promise<void>;

  return { interview, json, next, run: () => handler(req, res, next) };
}

beforeEach(() => {
  answerCount.mockClear();
  answerCount.mockResolvedValue(0);
  applyTransition.mockClear();
  info.mockClear();
});

describe('abandonInterview', () => {
  it('sends a partially answered round to its report', async () => {
    answerCount.mockResolvedValue(3);
    const { json, run } = leave('tech_round');

    await run();

    expect(applyTransition).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'itv_1' }),
      'evaluating',
      expect.objectContaining({ endedReason: 'abandoned' }),
    );
    expect(json).toHaveBeenCalledWith({ state: 'evaluating' });
  });

  it('ends a round with nothing answered at abandoned, with no report enqueued', async () => {
    const { json, run } = leave('hr_round');

    await run();

    expect(applyTransition).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'itv_1' }),
      'abandoned',
      expect.objectContaining({ endedReason: 'abandoned' }),
    );
    expect(json).toHaveBeenCalledWith({ state: 'abandoned' });
  });

  // The reason is the same either way: it is why the interview stopped, not what came of it.
  // The history row and the report header both read it to explain themselves.
  it.each([
    ['hr_round', 3],
    ['hr_round', 0],
    ['tech_round', 1],
  ])('records ended_reason=abandoned leaving %s with %i answers', async (state, answers) => {
    answerCount.mockResolvedValue(answers);

    await leave(state).run();

    expect(applyTransition.mock.calls[0][2]).toMatchObject({
      endedReason: 'abandoned',
      traceId: 'trace-1',
    });
  });

  /**
   * `paused` and `profiling` cannot take the report path even holding answers: `paused` has no
   * `evaluating` edge, and giving it one would put `POST /resume`'s budget ceiling on a new
   * route to `evaluating` that this issue did not ask for. They end at `abandoned`, and the
   * count is not even read — a query whose result cannot change the outcome is a query.
   */
  it.each(['paused', 'profiling'])('ends %s at abandoned without counting answers', async (state) => {
    answerCount.mockResolvedValue(5);
    const { json, run } = leave(state);

    await run();

    expect(answerCount).not.toHaveBeenCalled();
    expect(json).toHaveBeenCalledWith({ state: 'abandoned' });
  });

  // Legality is `applyTransition`'s, deliberately: a second guard here would be a copy of the
  // table that has to be kept in step with it. A refused edge reaches the error middleware.
  it('lets a refused transition through to the error handler', async () => {
    const refused = new Error('INVALID_STATE_TRANSITION');
    applyTransition.mockRejectedValueOnce(refused);
    const { json, next, run } = leave('completed');

    await run();

    expect(next).toHaveBeenCalledWith(refused);
    expect(json).not.toHaveBeenCalled();
  });

  it('logs the departure with the count it branched on', async () => {
    answerCount.mockResolvedValue(2);

    await leave('hr_round').run();

    const [fields, title] = info.mock.calls[0];
    expect(title).toBe('INTERVIEW_ABANDONED_BY_CANDIDATE');
    expect(fields).toMatchObject({ interviewId: 'itv_1', answered: 2, to: 'evaluating' });
  });
});
