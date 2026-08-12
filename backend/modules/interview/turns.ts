/**
 * `POST /interviews/:id/turns` — C02's progression step.
 *
 * Deliberately not a second shape of `POST /answers`. That route's contract is "this is the
 * answer to question X, advance": it names a question, it always advances, and a body that
 * names the wrong one is a 409. A turn promises none of that — the candidate may be answering,
 * clarifying, asking something back or swearing, and whether the interview moves is the
 * conductor's call, not the caller's. Two contracts, two routes; `/answers` stays exactly as
 * it was for the acceptance suite and for any client that wants the plain path.
 */
import type { Interview } from '@prisma/client';
import type { RequestHandler } from 'express';

import { ApiError } from '../../src/lib/api-error';
import { takePendingTurn } from '../speech/pending-turn';

import { conductTurn, type TurnInput, turnInputSchema } from './conductor';
import { currentQuestionRow } from './state';

export const submitTurn: RequestHandler = async (req, res) => {
  const interview = req.interview!;
  const traceId = req.traceId!;

  const parsed = turnInputSchema.safeParse(req.body);
  if (!parsed.success) throw new ApiError('VALIDATION_ERROR');

  const result = await conductTurn(interview, await resolveSilence(interview, parsed.data), {
    traceId,
  });
  res.status(200).json(result);
};

/**
 * T03 — every turn submission takes the held partial first, and what it does with it is the
 * whole of what the room does not have to know.
 *
 * The room cannot tell "silent for six seconds" from "stopped mid-thought, then silent":
 * both are the same signal on the same clock. The server can, because it holds the fragment —
 * so a silence request carrying one is an ordinary utterance turn and writes no silence row
 * (@AC-10), and one carrying nothing is a real silence.
 *
 * Taken on an ordinary turn too, and discarded: a fragment the candidate stopped speaking and
 * then typed past is not part of what they typed, and leaving it in Redis would join it onto
 * whatever they say next.
 */
async function resolveSilence(interview: Interview, input: TurnInput): Promise<TurnInput> {
  const held = await takePendingTurn(interview.id);
  if (input.kind !== 'silence' || !held) return input;

  const question = await currentQuestionRow(interview);
  return held.questionId === question?.id
    ? { kind: 'utterance', text: held.text, inputMode: input.inputMode }
    : input;
}

export default submitTurn;
