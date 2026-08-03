/**
 * The four webhook gates (§3.5, §7.1 item 4, ADR-V02) — the project's widest trust boundary.
 *
 * ElevenLabs calls us server-to-server with no cookie, so these gates ARE the authentication.
 * They run in order, short-circuit on the first failure, and mutate nothing when they fail:
 * a forged `submit_answer` must leave `current_index` and the `answers` table exactly as it
 * found them, which is why nothing here touches I06 and the router runs all four before it does.
 *
 * V04 reuses `verifySignature` and `checkFreshness` for the `post_call` webhook, which passes
 * gates 1–2 only (it carries no live session) — hence the individual exports, not just `runGates`.
 */
import { createHmac, timingSafeEqual } from 'node:crypto';

import type { Request } from 'express';

import type { Interview, VoiceSession as VoiceSessionRow } from '@prisma/client';

import { ApiError } from '../../src/lib/api-error';
import { clock } from '../../src/lib/clock';
import { activeInterview, prisma } from '../../src/lib/db';
import { config } from '../../src/lib/env';

// Declared on IncomingMessage, not Express.Request: the `verify` callback body-parser hands the
// raw bytes to is typed `http.IncomingMessage`, and Express's Request extends it — so one
// declaration types both the writer (app.ts) and the reader (`runGates` below).
declare module 'http' {
  interface IncomingMessage {
    /** Set by the `/webhooks` raw-body parser in app.ts — the exact bytes the HMAC covers. */
    rawBody?: Buffer;
  }
}

export const SIGNATURE_HEADER = 'x-elevenlabs-signature';
export const TIMESTAMP_HEADER = 'x-elevenlabs-timestamp';

// §5.5 seam, same shape as `voiceSeam`. The acceptance ring sets `secret` because
// ELEVENLABS_WEBHOOK_SECRET is optional in env.ts and empty in CI's `.env.example` copy —
// without it every scenario would pass gate 1 vacuously or fail it for the wrong reason.
export const webhookSeam = {
  secret: config.ELEVENLABS_WEBHOOK_SECRET ?? '',
  freshnessSeconds: config.VOICE_WEBHOOK_FRESHNESS_SECONDS,
};

export interface GateContext {
  interview: Interview;
  session: VoiceSessionRow;
}

/**
 * Gate 1 — HMAC-SHA256 over the RAW bytes ElevenLabs signed. A re-serialised body does not
 * reproduce them (key order, whitespace, unicode escaping), so `rawBody` must come from the
 * raw-body middleware in app.ts, never from `JSON.stringify(req.body)`.
 *
 * An unset secret fails closed: a missing credential must not turn the gate off.
 */
export function verifySignature(rawBody: Buffer, header: unknown): boolean {
  if (!webhookSeam.secret) return false;
  if (typeof header !== 'string') return false;

  const provided = Buffer.from(header.replace(/^sha256=/, ''), 'hex');
  const expected = createHmac('sha256', webhookSeam.secret).update(rawBody).digest();
  // timingSafeEqual throws on a length mismatch, and the length of a hex digest is public —
  // comparing it first leaks nothing the header does not already state.
  if (provided.length !== expected.length) return false;
  return timingSafeEqual(provided, expected);
}

/** Gate 2 — unix-seconds timestamp inside the window, in either direction (clock skew cuts both ways). */
export function checkFreshness(header: unknown): boolean {
  if (typeof header !== 'string') return false;
  const sent = Number(header);
  if (!Number.isFinite(sent)) return false;
  const skewSeconds = Math.abs(clock.now().getTime() / 1000 - sent);
  return skewSeconds <= webhookSeam.freshnessSeconds;
}

/**
 * Gate 3 — `(interviewId, nonce)` names a real, unconsumed session.
 *
 * ADR-V02-2: expiry is deliberately NOT part of this lookup. An expired session is a session
 * that existed, and `voice_webhook.feature` @AC-4 distinguishes the two — a nonce nobody minted
 * is `VOICE_SESSION_INVALID`, a nonce whose ceiling passed is `VOICE_SESSION_EXPIRED` and ends
 * the interview `time_exhausted`. Folding expiry in here would collapse both into the first.
 */
export async function authorizeSession(
  interviewId: string,
  nonce: string,
): Promise<VoiceSessionRow | null> {
  if (!interviewId || !nonce) return null;
  return prisma.voiceSession.findFirst({
    where: { interview_id: interviewId, nonce, consumed_at: null },
    orderBy: { expires_at: 'desc' },
  });
}

/** Gate 4's clock half — the ceiling is the session's own `expires_at` (the mint took min(round, interview)). */
export function isPastCeiling(session: VoiceSessionRow): boolean {
  return clock.now().getTime() > session.expires_at.getTime();
}

/**
 * Gates 1–3, in order. Gate 4 is the router's, because "legal transition" is per-action.
 *
 * Throws `ApiError` on rejection; the app's error handler maps the code to its registry status.
 */
export async function runGates(req: Request): Promise<GateContext> {
  if (!verifySignature(req.rawBody ?? Buffer.alloc(0), req.headers[SIGNATURE_HEADER])) {
    throw new ApiError('WEBHOOK_SIGNATURE_INVALID');
  }
  if (!checkFreshness(req.headers[TIMESTAMP_HEADER])) {
    throw new ApiError('WEBHOOK_REPLAY_REJECTED');
  }

  const interviewId = typeof req.body?.interviewId === 'string' ? req.body.interviewId : '';
  const nonce = typeof req.body?.nonce === 'string' ? req.body.nonce : '';
  const session = await authorizeSession(interviewId, nonce);
  if (!session) throw new ApiError('VOICE_SESSION_INVALID');

  // A session outliving its interview (soft delete, K13) authorises nothing.
  const interview = await activeInterview(session.interview_id);
  if (!interview) throw new ApiError('VOICE_SESSION_INVALID');

  return { interview, session };
}

export async function consumeSession(session: VoiceSessionRow): Promise<void> {
  await prisma.voiceSession.updateMany({
    where: { id: session.id, consumed_at: null },
    data: { consumed_at: clock.now() },
  });
}
