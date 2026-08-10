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

// Reads the opaque session cookie, resolves the row, enforces BOTH revoked_at IS NULL AND
// expires_at > now(), slides the window on a schedule (issue #131), and returns the user —
// or null when there is no valid session. The single place the session is verified, shared by
// the hard guard below and the soft one used by identity probes.
async function resolveSessionUser(
  req: Parameters<RequestHandler>[0],
  res: Parameters<RequestHandler>[1],
): Promise<User | null> {
  const token = req.cookies?.[SESSION_COOKIE] as string | undefined;
  if (!token) return null;

  const session = await prisma.session.findUnique({ where: { id: token } });
  if (!session) return null;
  if (session.revoked_at !== null || session.expires_at <= new Date()) return null;

  const user = await prisma.user.findUnique({ where: { id: session.user_id } });
  if (!user) return null;

  // Slide on a schedule, not on every request (issue #131). The refusals above already ran,
  // so an expired or revoked session is rejected before anything is written either way; what
  // this skips is only the write that would move the expiry by milliseconds. The cookie is
  // refreshed with it, so the browser's copy and the row stay in step.
  const nextExpiry = sessionExpiry();
  if (nextExpiry.getTime() - session.expires_at.getTime() >= SESSION_SLIDE_THRESHOLD_MS) {
    await prisma.session.update({ where: { id: token }, data: { expires_at: nextExpiry } });
    issueCookie(res, token);
  }

  req.user = user;
  setRequestContext({ userId: user.id });
  return user;
}

// Guards every protected route: 401 UNAUTHENTICATED when there is no valid session.
export const requireAuth: RequestHandler = async (req, res, next) => {
  try {
    const user = await resolveSessionUser(req, res);
    if (!user) throw new ApiError('UNAUTHENTICATED');
    next();
  } catch (err) {
    next(err);
  }
};

// Soft auth for identity probes (GET /me): attaches req.user when a valid session exists and
// otherwise leaves it unset, always calling next(). The anonymous landing polls /me on every
// load; a 401 there is a browser-logged console error for a non-error — "who am I" answered
// "nobody" is a 200, not a failure — and this is the only way to keep that console clean, since
// the browser logs the status itself and no client code can suppress it. Grants no access: the
// protected routers still run requireAuth.
export const optionalAuth: RequestHandler = async (req, res, next) => {
  try {
    await resolveSessionUser(req, res);
    next();
  } catch (err) {
    next(err);
  }
};
