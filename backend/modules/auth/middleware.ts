import type { User } from '@prisma/client';
import type { RequestHandler } from 'express';

import { ApiError } from '../../src/lib/api-error';
import { prisma } from '../../src/lib/db';
import { setRequestContext } from '../../src/lib/request-context';
import {
  SESSION_COOKIE,
  SESSION_SLIDE_THRESHOLD_MS,
  issueCookie,
  sessionExpiry,
} from '../../src/lib/session';

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: User;
      traceId?: string;
    }
  }
}

// Guards every protected route. Reads the opaque session cookie, resolves the row,
// enforces BOTH revoked_at IS NULL AND expires_at > now(), then slides the window — on a
// schedule rather than on every request (issue #131).
export const requireAuth: RequestHandler = async (req, res, next) => {
  try {
    const token = req.cookies?.[SESSION_COOKIE] as string | undefined;
    if (!token) throw new ApiError('UNAUTHENTICATED');

    const session = await prisma.session.findUnique({ where: { id: token } });
    if (!session) throw new ApiError('UNAUTHENTICATED');
    if (session.revoked_at !== null || session.expires_at <= new Date()) {
      throw new ApiError('UNAUTHENTICATED');
    }

    const user = await prisma.user.findUnique({ where: { id: session.user_id } });
    if (!user) throw new ApiError('UNAUTHENTICATED');

    // Slide on a schedule, not on every request (issue #131). Both refusals above already
    // ran, so an expired or revoked session is rejected before anything is written either
    // way; what this skips is only the write that would move the expiry by milliseconds.
    // The cookie is refreshed with it, so the browser's copy and the row stay in step.
    const nextExpiry = sessionExpiry();
    if (nextExpiry.getTime() - session.expires_at.getTime() >= SESSION_SLIDE_THRESHOLD_MS) {
      await prisma.session.update({
        where: { id: token },
        data: { expires_at: nextExpiry },
      });
      issueCookie(res, token);
    }

    req.user = user;
    setRequestContext({ userId: user.id });
    next();
  } catch (err) {
    next(err);
  }
};
