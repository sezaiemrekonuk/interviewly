import type { User } from '@prisma/client';
import { Google, generateCodeVerifier, generateState } from 'arctic';
import type { RequestHandler, Response } from 'express';
import { z } from 'zod';

import { ApiError } from '../../src/lib/api-error';
import { prisma } from '../../src/lib/db';
import { config } from '../../src/lib/env';
import { logger } from '../../src/lib/logger';
import { issueSessionForUser } from '../../src/lib/session';

import { redis } from './rate-limit';

// The `state` value travels in this short-lived cookie and is compared against the
// `?state=` Google echoes back. The PKCE verifier never leaves the server — it lives in
// Redis keyed by the state, so a browser crash leaves no dangling secret in the jar.
const STATE_COOKIE = 'oauth_state';
const STATE_TTL_SECONDS = 600;
const VERIFIER_KEY = (state: string) => `oauth:verifier:${state}`;
const REDIRECT_URI = `${config.PUBLIC_ORIGIN}/auth/google/callback`;
const USERINFO_URL = 'https://openidconnect.googleapis.com/v1/userinfo';

if (!config.GOOGLE_CLIENT_ID && config.NODE_ENV !== 'test') {
  logger.warn({}, 'AUTH_GOOGLE_NOT_CONFIGURED');
}

function stateCookieOptions() {
  return {
    httpOnly: true,
    secure: config.NODE_ENV === 'production',
    sameSite: 'lax' as const,
    path: '/',
  };
}

function setStateCookie(res: Response, state: string): void {
  res.cookie(STATE_COOKIE, state, { ...stateCookieOptions(), maxAge: STATE_TTL_SECONDS * 1000 });
}

function clearStateCookie(res: Response): void {
  res.cookie(STATE_COOKIE, '', { ...stateCookieOptions(), maxAge: 0 });
}

function googleClient(): Google {
  // Optional in the env schema so an `AI_ENABLED=false` dev box still boots (K8.5);
  // reaching the flow without them is a configuration fault, not a user error.
  if (!config.GOOGLE_CLIENT_ID || !config.GOOGLE_CLIENT_SECRET) throw new ApiError('NOT_READY');
  return new Google(config.GOOGLE_CLIENT_ID, config.GOOGLE_CLIENT_SECRET, REDIRECT_URI);
}

/**
 * What Google told us about the person signing in. `email_verified` is deliberately
 * `unknown`: the OIDC payload is attacker-adjacent JSON and only the literal boolean
 * `true` may be treated as verified.
 */
export interface GoogleIdentity {
  sub: string;
  email: string;
  email_verified: unknown;
}

/**
 * The trust boundary, shared by the real callback and the NODE_ENV=test seam so both
 * exercise identical rules. Throws `ApiError` on the two K8 rejection paths; otherwise
 * returns the user a session may be issued for.
 */
export async function resolveGoogleIdentity(
  identity: GoogleIdentity,
  traceId: string | undefined,
): Promise<User> {
  const email_lower = identity.email.trim().toLowerCase();

  const bySub = await prisma.user.findUnique({ where: { google_sub: identity.sub } });
  const account = bySub ?? (await prisma.user.findUnique({ where: { email_lower } }));

  // K8, first of two checks: an admin never gets a session out of an OAuth flow, and we
  // decide that before any session row could be written.
  if (account?.role === 'admin') {
    logger.warn({ userId: account.id, traceId }, 'AUTH_ADMIN_GOOGLE_BLOCKED');
    throw new ApiError('ADMIN_MUST_USE_PASSWORD');
  }

  // K8.6 — Google has already proven this address, so a separate mail round-trip would ask
  // the person to prove something we were just told. Only ever sets a null column: an
  // account verified earlier keeps its original timestamp.
  const verifiedNow = identity.email_verified === true ? new Date() : undefined;

  // Already linked: this Google account owns that row, nothing left to decide.
  if (bySub) {
    if (!verifiedNow || bySub.email_verified_at) return bySub;
    return markVerified(bySub.id, verifiedNow, traceId);
  }

  if (account) {
    // K8.5 — strict boolean. A truthy `"true"` string is not a verified email.
    if (!verifiedNow) throw new ApiError('ACCOUNT_LINK_REQUIRES_PASSWORD');
    const linked = await prisma.user.update({
      where: { id: account.id },
      data: {
        google_sub: identity.sub,
        ...(account.email_verified_at ? {} : { email_verified_at: verifiedNow }),
      },
    });
    logger.info({ userId: linked.id, traceId }, 'AUTH_GOOGLE_LINKED');
    if (!account.email_verified_at) {
      logger.info({ userId: linked.id, traceId }, 'AUTH_EMAIL_VERIFIED');
    }
    return linked;
  }

  const created = await prisma.user.create({
    data: {
      email_lower,
      google_sub: identity.sub,
      password_hash: null,
      email_verified_at: verifiedNow ?? null,
    },
  });
  logger.info({ userId: created.id, traceId }, 'AUTH_REGISTERED');
  if (verifiedNow) logger.info({ userId: created.id, traceId }, 'AUTH_EMAIL_VERIFIED');
  return created;
}

async function markVerified(
  userId: string,
  at: Date,
  traceId: string | undefined,
): Promise<User> {
  const user = await prisma.user.update({
    where: { id: userId },
    data: { email_verified_at: at },
  });
  logger.info({ userId, traceId }, 'AUTH_EMAIL_VERIFIED');
  return user;
}

export const startGoogle: RequestHandler = async (req, res) => {
  const client = googleClient();
  const state = generateState();
  const verifier = generateCodeVerifier();

  await redis.set(VERIFIER_KEY(state), verifier, 'EX', STATE_TTL_SECONDS);
  setStateCookie(res, state);

  const url = client.createAuthorizationURL(state, verifier, ['openid', 'email', 'profile']);
  logger.info({ traceId: req.traceId }, 'AUTH_GOOGLE_STARTED');
  res.redirect(302, url.toString());
};

const callbackQuery = z.object({ code: z.string().min(1), state: z.string().min(1) });
const userinfoSchema = z.object({
  sub: z.string().min(1),
  email: z.string().email(),
  email_verified: z.unknown(),
});

/**
 * Consumes the state/verifier pair exactly once and hands the identity to
 * `resolveGoogleIdentity`. Every exit path clears the state cookie, so a failed callback
 * leaves nothing replayable behind.
 */
export const googleCallback: RequestHandler = async (req, res) => {
  const parsed = callbackQuery.safeParse(req.query);
  const cookieState = (req.cookies?.[STATE_COOKIE] as string | undefined) ?? '';
  clearStateCookie(res);

  if (!parsed.success || !cookieState || cookieState !== parsed.data.state) {
    throw new ApiError('OAUTH_STATE_MISMATCH');
  }

  // GETDEL: the verifier is single-use, so a replayed callback finds nothing.
  const verifier = await redis.getdel(VERIFIER_KEY(parsed.data.state));
  if (!verifier) throw new ApiError('OAUTH_STATE_MISMATCH');

  const client = googleClient();
  const identity = await fetchIdentity(client, parsed.data.code, verifier).catch(() => {
    // The code, the verifier and the token response never reach a log line.
    logger.warn({ traceId: req.traceId }, 'AUTH_GOOGLE_EXCHANGE_FAILED');
    throw new ApiError('OAUTH_STATE_MISMATCH');
  });

  try {
    const user = await resolveGoogleIdentity(identity, req.traceId);
    await issueSessionForUser(user, res, 'google');
  } catch (err) {
    // The browser is mid-redirect: send it back to the form with a code it can render.
    // A03 maps `?error=<CODE>` to the `errors.<CODE>` message.
    if (err instanceof ApiError) {
      res.redirect(302, `${config.PUBLIC_ORIGIN}/sign-in?error=${err.code}`);
      return;
    }
    throw err;
  }

  res.redirect(302, `${config.PUBLIC_ORIGIN}/dashboard`);
};

async function fetchIdentity(
  client: Google,
  code: string,
  verifier: string,
): Promise<GoogleIdentity> {
  const tokens = await client.validateAuthorizationCode(code, verifier);
  const response = await fetch(USERINFO_URL, {
    headers: { authorization: `Bearer ${tokens.accessToken()}` },
  });
  if (!response.ok) throw new Error('USERINFO_FAILED');
  // Rebuilt field by field: `email_verified` is optional in the payload but required here,
  // so an absent claim lands as `undefined` and fails the `=== true` test like any other
  // non-boolean.
  const info = userinfoSchema.parse(await response.json());
  return { sub: info.sub, email: info.email, email_verified: info.email_verified };
}
