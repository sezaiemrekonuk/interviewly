import type { RequestHandler } from 'express';

import { ApiError } from '../../src/lib/api-error';
import { activeInterview } from '../../src/lib/db';

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      interview?: Awaited<ReturnType<typeof activeInterview>>;
    }
  }
}

// ADR-I11: a non-owned or soft-deleted `:id` is INTERVIEW_NOT_FOUND (404), never 403 —
// existence of another user's interview is not information this API leaks.
export const resolveInterview: RequestHandler = async (req, res, next) => {
  try {
    const interview = await activeInterview(String(req.params.id));
    if (!interview || interview.user_id !== req.user!.id) {
      throw new ApiError('INTERVIEW_NOT_FOUND');
    }
    req.interview = interview;
    next();
  } catch (err) {
    next(err);
  }
};
