/**
 * Which rooms `POST /resume` is a door out of.
 *
 * The `paused` half is acceptance-tested end to end (`interview_flow.feature` @AC-16). The
 * other half cannot be: it exists for interviews the happy path never produces — a setup
 * request that died between the insert and its own transition, or a generation whose pause
 * could not be written — and provoking those against a live stack means breaking a write
 * halfway. So the state guard is asserted here, where the shapes can simply be handed in.
 *
 * Everything below the guard is mocked. What it does when it lets a request through is
 * `generation.ts`'s and `profile.ts`'s business, and both have their own tests.
 */
import type { Interview } from '@prisma/client';
import type { Request, Response } from 'express';
import type { RoundType } from '@interviewly/ai';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const questionCount = vi.fn(async () => 0);
vi.mock('../../src/lib/db', () => ({ prisma: { question: { count: () => questionCount() } } }));

/** Mutates the caller's copy, like the real one — the handler reads `state` back off it. */
const applyTransition = vi.fn(async (interview: Interview, to: string) => {
  interview.state = to as Interview['state'];
  return to;
});
vi.mock('./machine', () => ({
  applyTransition: (interview: Interview, to: string) => applyTransition(interview, to),
}));

const startHrRound = vi.fn(async () => 'hr_round');
vi.mock('./profile', () => ({ startHrRound: () => startHrRound() }));

const generateRound = vi.fn(async (_round: RoundType) => undefined);
vi.mock('./generation', () => ({
  generateRound: (_interview: Interview, round: RoundType) => generateRound(round),
}));

// The ceiling is `budget.test.ts`'s subject; here it is a pass-through so the call it wraps
// is visible.
vi.mock('./budget', () => ({
  withBudgetOrEnd: (_interview: Interview, fn: () => Promise<unknown>) => fn(),
}));

const { resumeInterview } = await import('./resume');

function resume(state: string, over: Partial<Interview> = {}) {
  const interview = {
    id: 'itv_1',
    user_id: 'usr_1',
    state,
    current_index: 0,
    hr_question_count: 4,
    ...over,
  } as unknown as Interview;

  const json = vi.fn();
  const res = { status: vi.fn(() => ({ json })) } as unknown as Response;
  const req = { interview, traceId: 'trace-1' } as unknown as Request;

  const handler = resumeInterview as unknown as (
    req: Request,
    res: Response,
    next: () => void,
  ) => Promise<void>;

  return { interview, json, run: () => handler(req, res, vi.fn()) };
}

beforeEach(() => {
  questionCount.mockClear();
  questionCount.mockResolvedValue(0);
  applyTransition.mockClear();
  startHrRound.mockClear();
  generateRound.mockClear();
});

describe('resumeInterview', () => {
  // Issue 89: history links to the room of every unfinished interview, `created` included, and
  // nothing else in the system can move that row.
  it('starts an interview left in `created`', async () => {
    const { run, json } = resume('created');

    await run();

    expect(applyTransition).toHaveBeenCalledWith(expect.anything(), 'profiling');
    expect(startHrRound).toHaveBeenCalled();
    expect(json).toHaveBeenCalledWith({ state: 'hr_round' });
  });

  it('starts a room parked in `profiling` without a second transition', async () => {
    const { run } = resume('profiling');

    await run();

    expect(applyTransition).not.toHaveBeenCalled();
    expect(startHrRound).toHaveBeenCalled();
  });

  // The technical half of the stranded repair. The handover is driven by the answer whose batch
  // generation failed, so a pause that did not land leaves the interview here — and there is no
  // `tech_round → paused` edge for a second attempt to fall into.
  it('regenerates a technical round that has no questions', async () => {
    const { run, json } = resume('tech_round', { current_index: 5 } as Partial<Interview>);

    await run();

    expect(generateRound).toHaveBeenCalledWith('tech');
    // Already in the round it needs: re-entering it is not an edge the machine models.
    expect(applyTransition).not.toHaveBeenCalled();
    expect(json).toHaveBeenCalledWith({ state: 'tech_round' });
  });

  it('regenerates an HR round that has no questions', async () => {
    const { run } = resume('hr_round');

    await run();

    expect(generateRound).toHaveBeenCalledWith('hr');
    expect(applyTransition).not.toHaveBeenCalled();
  });

  // A round with its batch is a room the candidate can answer from. Resuming it would be a
  // second door into a state change this endpoint does not own.
  it.each(['hr_round', 'tech_round'])('refuses %s once the batch exists', async (state) => {
    questionCount.mockResolvedValue(3);
    const { run } = resume(state);

    await expect(run()).rejects.toMatchObject({ code: 'INVALID_STATE_TRANSITION' });
    expect(generateRound).not.toHaveBeenCalled();
  });

  it.each(['evaluating', 'completed', 'abandoned'])('refuses %s', async (state) => {
    const { run } = resume(state);

    await expect(run()).rejects.toMatchObject({ code: 'INVALID_STATE_TRANSITION' });
    expect(startHrRound).not.toHaveBeenCalled();
  });

  // The path this issue does not touch, pinned so it stays untouched: a pause resumes into the
  // round `current_index` says the candidate is waiting on.
  it('resumes a pause into the technical round when the index is already past HR', async () => {
    const { run, json } = resume('paused', { current_index: 5 } as Partial<Interview>);

    await run();

    expect(applyTransition).toHaveBeenNthCalledWith(1, expect.anything(), 'hr_round');
    expect(generateRound).toHaveBeenCalledWith('tech');
    expect(applyTransition).toHaveBeenNthCalledWith(2, expect.anything(), 'tech_round');
    expect(json).toHaveBeenCalledWith({ state: 'tech_round' });
  });
});
