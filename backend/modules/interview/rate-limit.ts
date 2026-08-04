import type { Request } from 'express';

import { keyedLimiter } from '../auth/rate-limit';

// Keyed by `user_id`, not IP: rotating IPs must not buy a candidate more interviews.
const byUser = (req: Request): string => req.user!.id;

// Rolling 24 h, not a calendar day — the window is measured back from `clock.now()`.
// ponytail: the counter records the attempt, so a start that fails downstream
// (VALIDATION_ERROR) still burns a slot. Move the record after the create if that bites.
export const dailyInterviewCap = keyedLimiter({
  prefix: 'dailyinterview',
  limit: 5,
  windowMs: 24 * 60 * 60 * 1000,
  keyOf: byUser,
  code: 'DAILY_INTERVIEW_LIMIT',
  event: 'DAILY_LIMIT_HIT',
});

export const interviewStartLimiter = keyedLimiter({
  prefix: 'interviewstart',
  limit: 10,
  windowMs: 60 * 60 * 1000,
  keyOf: byUser,
});
