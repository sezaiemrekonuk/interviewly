import type { RequestHandler } from 'express';
import { z } from 'zod';

import { ApiError } from '../../src/lib/api-error';
import { prisma } from '../../src/lib/db';
import { config } from '../../src/lib/env';
import { logger } from '../../src/lib/logger';

import { enqueueEmail } from './mail-queue';
import { RESEND_COOLDOWN_SECONDS, claimResendCooldown, withinResendQuota } from './rate-limit';
import { consumeEmailToken, mintEmailToken } from './tokens';
import { publicUser } from './user-view';

/**
 * K8.6 — verification exists, is always offered, and blocks nothing by default. The two
 * handlers here own the whole surface; enforcement is `requireVerifiedEmail` below, which
 * one endpoint mounts.
 */

/** Mints a `verify` token and queues the mail. Shared by register (A01) and the resend. */
export async function sendVerificationMail(
  user: { id: string; email_lower: string; locale: string },
  traceId: string | undefined,
): Promise<void> {
  const token = await mintEmailToken(user.id, 'verify');
  await enqueueEmail(
    { to: user.email_lower, kind: 'verify', token, locale: user.locale },
    traceId,
  );
  // The token is the one field that must never appear here. The event says a token was
  // issued; which token it was lives only in the mail.
  logger.info({ userId: user.id, traceId }, 'AUTH_VERIFY_TOKEN_ISSUED');
}

/**
 * `POST /auth/verify-email/request` — authenticated.
 *
 * 429 has two distinct meanings and two codes: `EMAIL_RESEND_COOLDOWN` is "you asked
 * again too soon, here is when to retry", `RATE_LIMITED` is "you have had your hour's
 * worth". Collapsing them would leave the screen unable to say which countdown to show.
 */
export const requestVerification: RequestHandler = async (req, res) => {
  const user = req.user!;

  // Idempotent for an account that is already verified: still 202, no token, no mail. A
  // 409 here would only teach a client to special-case a state it cannot do anything about.
  if (user.email_verified_at !== null) {
    res.status(202).json({ cooldownSeconds: RESEND_COOLDOWN_SECONDS });
    return;
  }

  const cooldown = await claimResendCooldown(user.id);
  if (!cooldown.ok) {
    res.status(429).json({
      error: { code: 'EMAIL_RESEND_COOLDOWN' },
      cooldownSeconds: cooldown.remainingSeconds,
    });
    return;
  }

  // Checked after the cooldown so a request the cooldown already refused does not also
  // burn an hourly slot — otherwise a client retrying in a loop locks itself out for an
  // hour without a single mail having been sent.
  if (!(await withinResendQuota(user.id))) {
    logger.warn({ userId: user.id, traceId: req.traceId }, 'RATE_LIMIT_HIT');
    res.status(429).json({ error: { code: 'RATE_LIMITED' } });
    return;
  }

  await sendVerificationMail(user, req.traceId);
  res.status(202).json({ cooldownSeconds: RESEND_COOLDOWN_SECONDS });
};

const confirmSchema = z.object({ token: z.string().min(1) });

/**
 * `POST /auth/verify-email/confirm` — deliberately public. The link is opened wherever the
 * mail was read, which is routinely not the browser that registered, and requiring a
 * session there would strand exactly the people the mail is for.
 */
export const confirmVerification: RequestHandler = async (req, res) => {
  const parsed = confirmSchema.safeParse(req.body);
  if (!parsed.success) throw new ApiError('VALIDATION_ERROR');

  const result = await consumeEmailToken(parsed.data.token, 'verify');
  if (!result.ok) {
    logger.warn({ reason: result.reason, traceId: req.traceId }, 'AUTH_VERIFY_TOKEN_REJECTED');
    throw new ApiError(result.reason === 'expired' ? 'EMAIL_TOKEN_EXPIRED' : 'EMAIL_TOKEN_INVALID');
  }

  // `updateMany` with the null guard: re-verifying keeps the original timestamp, so the
  // date on the account is when the address was first proven, not when someone last
  // clicked a spare link.
  await prisma.user.updateMany({
    where: { id: result.userId, email_verified_at: null },
    data: { email_verified_at: new Date() },
  });
  const user = await prisma.user.findUniqueOrThrow({ where: { id: result.userId } });

  logger.info({ userId: user.id, traceId: req.traceId }, 'AUTH_EMAIL_VERIFIED');
  res.status(200).json({ user: await publicUser(user) });
};

/**
 * The single gate (K8.6). Mounted on `POST /interviews` and nowhere else — the whole point
 * of a config flag is that turning it on changes one refusal, not the shape of the app.
 *
 * Exported from here rather than written inline in the interview router so the flag is
 * read in one place; I03 mounts it.
 */
export const requireVerifiedEmail: RequestHandler = (req, _res, next) => {
  if (!config.EMAIL_VERIFICATION_REQUIRED) return next();
  if (req.user?.email_verified_at) return next();

  logger.info({ userId: req.user?.id, traceId: req.traceId }, 'AUTH_VERIFICATION_REQUIRED_BLOCK');
  next(new ApiError('EMAIL_NOT_VERIFIED'));
};
