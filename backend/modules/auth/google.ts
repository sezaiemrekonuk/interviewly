import type { User } from '@prisma/client';
import { Google, generateCodeVerifier, generateState } from 'arctic';
import type { RequestHandler, Response } from 'express';
import { z } from 'zod';

import { ApiError } from '../../src/lib/api-error';
import { prisma } from '../../src/lib/db';
import { config } from '../../src/lib/env';
import { logger } from '../../src/lib/logger';
import { issueSessionForUser } from '../../src/lib/session';

import { consentFields } from './consent';
import { redis } from './rate-limit';

// The `state` value travels in this short-lived cookie and is compared against the
// `?state=` Google echoes back. The PKCE verifier never leaves the server — it lives in
// Redis keyed by the state, so a browser crash leaves no dangling secret in the jar.
const STATE_COOKIE = 'oauth_state';
const STATE_TTL_SECONDS = 600;
const VERIFIER_KEY = (state: string) => `oauth:verifier:${state}`;
/**
 * Where Google sends the browser back, and therefore a *browser-facing* URL rather than a
 * mount path: `/api` is the public prefix in F03's route table, and `Caddyfile`'s
 * `handle_path /api/*` is what strips it before the request reaches this router at `/auth`.
 * Without the prefix the callback falls through the edge's catch-all to Next.js and answers
 * 404 — the auth ledger's third packaging defect, whose other half (`handle` → `handle_path`)
 * landed and whose half of the fix this is.
 *
 * Exported because it is a deployment contract, not an implementation detail: this exact
 * string has to be registered as an Authorized redirect URI in the Google client, and the
 * `/api` is the easiest part of it to lose again.
 */
export const REDIRECT_URI = `${config.PUBLIC_ORIGIN}/api/auth/google/callback`;
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

/**
 * Whether this deployment holds both halves of the client credential. Optional in the env
 * schema so an `AI_ENABLED=false` dev box still boots (K8.5), which means "Google works
 * here" is a runtime question — `GET /auth/capabilities` answers it for the sign-in screen
 * so the button is never offered against a credential that does not exist (issue 60).
 */
export function googleConfigured(): boolean {
  return Boolean(config.GOOGLE_CLIENT_ID && config.GOOGLE_CLIENT_SECRET);
}

function googleClient(): Google {
  const { GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET } = config;
  // Unreachable behind the `googleConfigured()` guards both routes open with — kept so the
  // constructor's two `string` parameters are satisfied by narrowing, not by an assertion.
  if (!GOOGLE_CLIENT_ID || !GOOGLE_CLIENT_SECRET) throw new ApiError('NOT_READY');
  return new Google(GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, REDIRECT_URI);
}

/**
 * The only way either Google route refuses. Both are reached by a full browser navigation,
 * so an `ApiError` thrown out of them is painted as the document itself — the blank page
 * reading `{"error":{"code":"NOT_READY"}}` that issue 60 is about, with no way back but the
 * Back button. A03 maps `?error=<CODE>` to the translated `errors.<CODE>` instead, so every
 * refusal lands on a form the visitor can still use.
 */
function refuse(res: Response, code: string): void {
  // Every code that reaches here is a registry constant, but this value lands in a URL and
  // encoding it is what keeps that true of the ones added later.
  res.redirect(302, `${config.PUBLIC_ORIGIN}/sign-in?error=${encodeURIComponent(code)}`);
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

  // The consent stamp is recorded here too (issue 009): this branch creates an account, and
  // an account created without a consent record is exactly what KVKK Art. 5 forbids. The
  // box itself is ticked on `/register`, which is what gates the button that starts this
  // redirect chain — the OAuth round-trip carries no field of our own to re-assert it with.
  const created = await prisma.user.create({
    data: {
      email_lower,
      google_sub: identity.sub,
      password_hash: null,
      email_verified_at: verifiedNow ?? null,
      ...consentFields(),
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
  // The `GoogleButton` is hidden while this is false, so reaching here means a bookmark, a
  // stale tab, or a deploy that dropped the credential between the render and the click.
  if (!googleConfigured()) {
    logger.warn({ traceId: req.traceId }, 'AUTH_GOOGLE_NOT_CONFIGURED');
    refuse(res, 'NOT_READY');
    return;
  }

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
 * leaves nothing replayable behind, and every refusal leaves through `refuse` — this URL is
 * the browser's own address bar, so it has no other honest way to answer.
 */
export const googleCallback: RequestHandler = async (req, res) => {
  const parsed = callbackQuery.safeParse(req.query);
  const cookieState = (req.cookies?.[STATE_COOKIE] as string | undefined) ?? '';
  clearStateCookie(res);

  if (!parsed.success || !cookieState || cookieState !== parsed.data.state) {
    refuse(res, 'OAUTH_STATE_MISMATCH');
    return;
  }

  // GETDEL: the verifier is single-use, so a replayed callback finds nothing.
  const verifier = await redis.getdel(VERIFIER_KEY(parsed.data.state));
  if (!verifier) {
    refuse(res, 'OAUTH_STATE_MISMATCH');
    return;
  }

  // Checked after the state pair, not before it: a forged or replayed callback is wrong on
  // its own terms whatever the server is holding, and burning the single-use verifier first
  // keeps a config gap from turning this URL into a replayable one. Reaching here with no
  // credential means the deploy dropped it between the consent screen and the return trip.
  if (!googleConfigured()) {
    logger.warn({ traceId: req.traceId }, 'AUTH_GOOGLE_NOT_CONFIGURED');
    refuse(res, 'NOT_READY');
    return;
  }

  const client = googleClient();
  const identity = await fetchIdentity(client, parsed.data.code, verifier).catch(() => null);
  if (!identity) {
    // The code, the verifier and the token response never reach a log line.
    logger.warn({ traceId: req.traceId }, 'AUTH_GOOGLE_EXCHANGE_FAILED');
    refuse(res, 'OAUTH_STATE_MISMATCH');
    return;
  }

  try {
    const user = await resolveGoogleIdentity(identity, req.traceId);
    await issueSessionForUser(user, res, 'google');
  } catch (err) {
    // The browser is mid-redirect: send it back to the form with a code it can render.
    if (err instanceof ApiError) {
      refuse(res, err.code);
      return;
    }
    throw err;
  }

  // `/`, not a landing path chosen here (issue #80). `/` applies the K8.7 first-run rule
  // client-side (`lib/first-run.ts`, via `home-switch.tsx`) — the same rule the password
  // sign-in uses. Sending Google users straight to the signed-in home skipped onboarding
  // entirely, and their profile stayed empty forever; re-deriving the rule in this handler
  // would have given it a second home to drift from.
  res.redirect(302, `${config.PUBLIC_ORIGIN}/`);
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
