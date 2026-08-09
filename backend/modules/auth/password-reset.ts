import { hash } from '@node-rs/argon2';
import type { RequestHandler } from 'express';
import { z } from 'zod';

import { ApiError } from '../../src/lib/api-error';
import { recordAudit } from '../../src/lib/audit';
import { prisma } from '../../src/lib/db';
import { logger } from '../../src/lib/logger';
import { revokeCookie } from '../../src/lib/session';

import { enqueueEmail } from './mail-queue';
import { consumeEmailToken, mintEmailToken } from './tokens';

/**
 * K8.6 — reset is what someone presses when they believe they are compromised. Two rules
 * carry the whole feature: the request must not reveal who has an account, and the confirm
 * must end every session that user has.
 */

const requestSchema = z.object({ email: z.string().email() });
const confirmSchema = z.object({ token: z.string().min(1), password: z.string() });

const MIN_PASSWORD_LENGTH = 10;

// Everything the three cases differ in happens here, after the response has already been
// written. `resetMailSettled` below is the only reason this is tracked rather than fired
// and forgotten.
const inFlight = new Set<Promise<void>>();

function track(work: Promise<void>): void {
  inFlight.add(work);
  void work.finally(() => inFlight.delete(work));
}

/** Join point for the acceptance ring, which asserts on an enqueue the caller never waits for. */
export function resetMailSettled(): Promise<unknown> {
  return Promise.all([...inFlight]);
}

async function deliverResetMail(email_lower: string, traceId: string | undefined): Promise<void> {
  const user = await prisma.user.findUnique({ where: { email_lower } });
  if (!user) return;

  const token = await mintEmailToken(user.id, 'reset');
  await enqueueEmail({ to: user.email_lower, kind: 'reset', token, locale: user.locale }, traceId);
  logger.info({ userId: user.id, traceId }, 'AUTH_RESET_TOKEN_ISSUED');
}

/**
 * `POST /auth/password-reset/request` — always `202`, always empty.
 *
 * The response is written before the account is even looked up: registered, Google-only and
 * unknown then differ in no observable way, not in status, not in body, and not in how long
 * the answer took. A `findUnique` ahead of the response would put the difference back into
 * the latency, which is the half of enumeration that an identical body does not close.
 */
export const requestPasswordReset: RequestHandler = (req, res) => {
  const parsed = requestSchema.safeParse(req.body);
  if (!parsed.success) throw new ApiError('VALIDATION_ERROR');

  res.status(202).end();
  track(deliverResetMail(parsed.data.email.trim().toLowerCase(), req.traceId));
};

/**
 * `POST /auth/password-reset/confirm` — public, like the verification link.
 *
 * A Google-only account (`password_hash = null`) reaches its first password here, which is
 * also why the confirm sets `email_verified_at`: control of the mailbox was just proven.
 */
export const confirmPasswordReset: RequestHandler = async (req, res) => {
  const parsed = confirmSchema.safeParse(req.body);
  if (!parsed.success) throw new ApiError('VALIDATION_ERROR');

  // Before the consume, never after: a too-short password is a typo, and burning the token
  // on it would cost the person another mail to fix one.
  if (parsed.data.password.length < MIN_PASSWORD_LENGTH) throw new ApiError('PASSWORD_TOO_SHORT');

  const result = await consumeEmailToken(parsed.data.token, 'reset');
  if (!result.ok) {
    throw new ApiError(result.reason === 'expired' ? 'EMAIL_TOKEN_EXPIRED' : 'EMAIL_TOKEN_INVALID');
  }

  const password_hash = await hash(parsed.data.password);
  const now = new Date();

  // One transaction, because a new password that leaves the old sessions alive is not a
  // reset — an attacker holding a live cookie would keep it. The null guard on
  // `email_verified_at` keeps the original proof date when there already is one.
  //
  // Interactive rather than the array form since issue 86: the audit row belongs to the same
  // commit as the password write, and `recordAudit` takes the transaction client to make
  // that structural. It records that a reset completed and how many sessions it killed —
  // never the password, the hash or the token.
  const revoked = await prisma.$transaction(async (tx) => {
    await tx.user.update({ where: { id: result.userId }, data: { password_hash } });
    const revokedSessions = await tx.session.updateMany({
      where: { user_id: result.userId, revoked_at: null },
      data: { revoked_at: now },
    });
    await tx.user.updateMany({
      where: { id: result.userId, email_verified_at: null },
      data: { email_verified_at: now },
    });
    await recordAudit(tx, {
      actorUserId: result.userId,
      action: 'auth.password_reset_completed',
      subjectType: 'user',
      subjectId: result.userId,
      traceId: req.traceId,
      metadata: { sessionsRevoked: revokedSessions.count },
    });
    return revokedSessions;
  });

  // The caller's own cookie is one of the revoked rows; clearing it stops the browser that
  // did the reset from sending a dead token on every subsequent request.
  revokeCookie(res);

  logger.info(
    { userId: result.userId, sessionsRevoked: revoked.count, traceId: req.traceId },
    'AUTH_RESET_COMPLETED',
  );
  res.status(200).json({});
};
