import { hash } from '@node-rs/argon2';
import type { RequestHandler } from 'express';
import { z } from 'zod';

import { ApiError } from '../../src/lib/api-error';
import { prisma } from '../../src/lib/db';
import { logger } from '../../src/lib/logger';
import { issueSessionForUser } from '../../src/lib/session';

import { consentFields } from './consent';
import { publicUser } from './user-view';
import { sendVerificationMail } from './verify-email';

// `consent` is its own boolean rather than `z.literal(true)`: an unticked box is a distinct,
// fixable refusal (CONSENT_REQUIRED), not the generic VALIDATION_ERROR a malformed body gets.
const schema = z.object({
  email: z.string().email(),
  password: z.string(),
  consent: z.boolean().optional(),
});

export const register: RequestHandler = async (req, res) => {
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) throw new ApiError('VALIDATION_ERROR');
  // Checked before anything is hashed or stored — consent is the gate on collecting at all.
  if (parsed.data.consent !== true) throw new ApiError('CONSENT_REQUIRED');
  if (parsed.data.password.length < 10) throw new ApiError('PASSWORD_TOO_SHORT');

  const email_lower = parsed.data.email.trim().toLowerCase();

  const password_hash = await hash(parsed.data.password);
  const user = await prisma.user
    .create({ data: { email_lower, password_hash, ...consentFields() } })
    .catch((err) => {
      if ((err as { code?: string } | null)?.code === 'P2002') throw new ApiError('EMAIL_TAKEN');
      throw err;
    });
  await issueSessionForUser(user, res, 'password');

  // K8.6 — the mail is always sent, and never gates the response: `enqueueEmail` swallows
  // a queue outage, so a registration still answers 201 with its session cookie when the
  // mail system is down.
  await sendVerificationMail(user, req.traceId);

  logger.info({ userId: user.id, traceId: req.traceId }, 'AUTH_REGISTERED');
  res.status(201).json({ user: await publicUser(user) });
};

export default register;
