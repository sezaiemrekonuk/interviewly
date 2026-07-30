import type { RequestHandler } from 'express';

import { prisma } from '../../src/lib/db';
import { logger } from '../../src/lib/logger';
import { SESSION_COOKIE, revokeCookie } from '../../src/lib/session';

// requireAuth runs before this handler, so a session cookie is present and valid.
export const logout: RequestHandler = async (req, res) => {
  const token = req.cookies?.[SESSION_COOKIE] as string;
  await prisma.session.update({
    where: { id: token },
    data: { revoked_at: new Date() },
  });
  revokeCookie(res);
  logger.info({ userId: req.user!.id, traceId: req.traceId }, 'AUTH_LOGOUT');
  res.status(204).end();
};

export default logout;
