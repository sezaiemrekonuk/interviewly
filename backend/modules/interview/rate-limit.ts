import type { Request } from 'express';

import { config } from '../../src/lib/env';

import { keyedLimiter } from '../auth/rate-limit';

// Keyed by `user_id`, not IP: rotating IPs must not buy a candidate more interviews.
const byUser = (req: Request): string => req.user!.id;

// Admins run demos/support checks all day and are not the candidates the caps protect.
const isAdmin = (req: Request): boolean => req.user!.role === 'admin';

// Rolling 24 h, not a calendar day — the window is measured back from `clock.now()`.
export const DAILY_INTERVIEW_PREFIX = 'dailyinterview';
export const DAILY_INTERVIEW_WINDOW_MS = 24 * 60 * 60 * 1000;

/**
 * A quota on interviews, so it charges interviews — `record: false`, with `setupInterview`
 * calling `recordHit` once the row exists (issue #116). Counting the attempt meant a user who
 * hit the upload bug and retried four times was locked out for a day having created nothing.
 */
export const dailyInterviewCap = keyedLimiter({
  prefix: DAILY_INTERVIEW_PREFIX,
  // The declared knob, not a literal that shadowed it (issue #117). Same value by default.
  limit: config.MAX_INTERVIEWS_PER_USER_PER_DAY,
  windowMs: DAILY_INTERVIEW_WINDOW_MS,
  keyOf: byUser,
  code: 'DAILY_INTERVIEW_LIMIT',
  event: 'DAILY_LIMIT_HIT',
  record: false,
  bypass: isAdmin,
});

// Left recording every attempt, deliberately: this one is abuse protection, where the
// attempt is exactly the thing worth counting.
export const interviewStartLimiter = keyedLimiter({
  prefix: 'interviewstart',
  limit: 10,
  windowMs: 60 * 60 * 1000,
  keyOf: byUser,
  bypass: isAdmin,
});

/**
 * Issue #120: 20/hour per user on `POST /uploads`, the most expensive endpoint in the system —
 * 10 MB buffered by multer, magic-byte and page checks, a PDF parse up to 30 pages, a sha256
 * and an S3 write, all of it authenticated but loopable by anyone who can register.
 *
 * Recording the attempt rather than the outcome, unlike `dailyInterviewCap`: the cost here is
 * paid by parsing the file, so a refused PDF has already spent it and is exactly what needs
 * counting. `app.ts` mounts this AHEAD of `uploadMiddleware` so a refusal never buffers a body.
 *
 * No `isAdmin` bypass. The other two caps protect a product quota an operator legitimately
 * exceeds; this one protects CPU and storage, which an admin session consumes identically.
 */
export const uploadLimiter = keyedLimiter({
  prefix: 'upload',
  limit: 20,
  windowMs: 60 * 60 * 1000,
  keyOf: byUser,
});

export const jobListingLimiter = keyedLimiter({
  prefix: 'joblisting',
  limit: 60,
  windowMs: 60 * 60 * 1000,
  keyOf: byUser,
});
