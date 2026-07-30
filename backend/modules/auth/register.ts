import { hash } from '@node-rs/argon2';
import type { RequestHandler } from 'express';
import { z } from 'zod';

import { ApiError } from '../../src/lib/api-error';
import { prisma } from '../../src/lib/db';
import { logger } from '../../src/lib/logger';
import { generateToken, issueCookie, sessionExpiry } from '../../src/lib/session';

import { publicUser } from './user-view';

const schema = z.object({ email: z.string().email(), password: z.string() });

export const register: RequestHandler = async (req, res) => {
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) throw new ApiError('VALIDATION_ERROR');
  if (parsed.data.password.length < 10) throw new ApiError('PASSWORD_TOO_SHORT');

  const email_lower = parsed.data.email.trim().toLowerCase();
  if (await prisma.user.findUnique({ where: { email_lower } })) {
    throw new ApiError('EMAIL_TAKEN');
  }

  const password_hash = await hash(parsed.data.password);
  const user = await prisma.user.create({ data: { email_lower, password_hash } });

  const token = generateToken();
  await prisma.session.create({
    data: { id: token, user_id: user.id, expires_at: sessionExpiry() },
  });
  issueCookie(res, token);

  logger.info({ userId: user.id, traceId: req.traceId }, 'AUTH_REGISTERED');
  res.status(201).json({ user: publicUser(user) });
};

export default register;
