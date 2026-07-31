import type { User } from '@prisma/client';
import type { RequestHandler } from 'express';

import { ApiError } from '../../src/lib/api-error';
import { prisma } from '../../src/lib/db';
import { SESSION_COOKIE, issueCookie, sessionExpiry } from '../../src/lib/session';

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
// enforces BOTH revoked_at IS NULL AND expires_at > now(), then slides the window.
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

    await prisma.session.update({
      where: { id: token },
      data: { expires_at: sessionExpiry() },
    });
    issueCookie(res, token);

    req.user = user;
    next();
  } catch (err) {
    next(err);
  }
};
