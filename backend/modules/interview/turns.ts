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
import type { RequestHandler } from 'express';

import { ApiError } from '../../src/lib/api-error';

import { conductTurn, turnInputSchema } from './conductor';

export const submitTurn: RequestHandler = async (req, res) => {
  const interview = req.interview!;
  const traceId = req.traceId!;

  const parsed = turnInputSchema.safeParse(req.body);
  if (!parsed.success) throw new ApiError('VALIDATION_ERROR');

  const result = await conductTurn(interview, parsed.data, { traceId });
  res.status(200).json(result);
};

export default submitTurn;
