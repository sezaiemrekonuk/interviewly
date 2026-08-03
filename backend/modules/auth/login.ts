import { verify } from '@node-rs/argon2';
import type { RequestHandler } from 'express';
import { z } from 'zod';

import { ApiError } from '../../src/lib/api-error';
import { prisma } from '../../src/lib/db';
import { logger } from '../../src/lib/logger';
import { issueSessionForUser } from '../../src/lib/session';

import { publicUser } from './user-view';

const schema = z.object({ email: z.string().email(), password: z.string() });

export const login: RequestHandler = async (req, res) => {
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) throw new ApiError('VALIDATION_ERROR');

  const email_lower = parsed.data.email.trim().toLowerCase();
  const user = await prisma.user.findUnique({ where: { email_lower } });

  // Indistinguishable between unknown email and wrong password (user-enumeration
  // defence, K8). A null hash (Google-only account) makes verify() fail — correct.
  const ok =
    user?.password_hash != null &&
    (await verify(user.password_hash, parsed.data.password).catch(() => false));
  if (!user || !ok) {
    logger.info({ email_lower, traceId: req.traceId }, 'AUTH_LOGIN_FAILED');
    throw new ApiError('INVALID_CREDENTIALS');
  }

  await issueSessionForUser(user, res, 'password');

  logger.info({ userId: user.id, traceId: req.traceId }, 'AUTH_LOGIN_OK');
  res.status(200).json({ user: await publicUser(user) });
};

export default login;
