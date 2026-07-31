import { createHash, randomBytes } from 'node:crypto';

import type { EmailTokenKind } from '@prisma/client';

import { prisma } from '../../src/lib/db';
import { config } from '../../src/lib/env';

/**
 * The only module that touches `email_tokens` (K8.6). Both flows — A04's verification and
 * A05's password reset — mint and consume through here, so the storage rule and the
 * single-use rule are stated once.
 *
 * The plaintext token exists in exactly two places: the return value of `mintEmailToken`,
 * which the caller hands to the mail job, and the link in the mail itself. The table only
 * ever sees `sha256(token)`, so a database dump is not a set of working links.
 */

/** 32 bytes → 43 base64url chars. URL-safe because it travels as a path segment. */
const TOKEN_BYTES = 32;

export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

function defaultTtlMs(kind: EmailTokenKind): number {
  return kind === 'verify'
    ? config.EMAIL_VERIFY_TTL_HOURS * 60 * 60 * 1000
    : config.PASSWORD_RESET_TTL_MINUTES * 60 * 1000;
}

export interface MintOptions {
  /**
   * Overrides the configured TTL. Exists so an acceptance scenario can mint the token it
   * needs — an already-expired one, say — without reaching into `email_tokens` behind this
   * module's back and re-implementing the hashing rule in test code.
   */
  ttlMs?: number;
}

/** Inserts the hash and returns the plaintext token. Never log the return value. */
export async function mintEmailToken(
  userId: string,
  kind: EmailTokenKind,
  options: MintOptions = {},
): Promise<string> {
  const token = randomBytes(TOKEN_BYTES).toString('base64url');
  await prisma.emailToken.create({
    data: {
      user_id: userId,
      kind,
      token_hash: hashToken(token),
      expires_at: new Date(Date.now() + (options.ttlMs ?? defaultTtlMs(kind))),
    },
  });
  return token;
}

/**
 * Why two failure reasons and not three: absent, already-consumed and wrong-kind are all
 * indistinguishable to the person holding the link — there is nothing they can do but ask
 * for a new one — while `expired` tells them a fresh link will work. The caller maps
 * `invalid` → `EMAIL_TOKEN_INVALID` and `expired` → `EMAIL_TOKEN_EXPIRED`.
 */
export type ConsumeResult =
  | { ok: true; userId: string }
  | { ok: false; reason: 'invalid' | 'expired' };

export async function consumeEmailToken(
  token: string,
  kind: EmailTokenKind,
): Promise<ConsumeResult> {
  const row = await prisma.emailToken.findUnique({ where: { token_hash: hashToken(token) } });
  if (!row || row.kind !== kind || row.consumed_at !== null) return { ok: false, reason: 'invalid' };
  if (row.expires_at <= new Date()) return { ok: false, reason: 'expired' };

  // The consume itself, not the read above, is what makes the token single-use: the
  // `consumed_at IS NULL` predicate lives in the UPDATE, so two concurrent confirmations
  // of one token both reach here and exactly one of them updates a row. Deciding from the
  // row we just read would let both through under a double-clicked link.
  const { count } = await prisma.emailToken.updateMany({
    where: { id: row.id, consumed_at: null },
    data: { consumed_at: new Date() },
  });
  if (count === 0) return { ok: false, reason: 'invalid' };

  return { ok: true, userId: row.user_id };
}
