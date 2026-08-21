/**
 * `GET /admin/sessions` — the console's "Sessions" section.
 *
 * These are the AUTH sessions in `sessions`, not the voice sessions the section was first
 * sketched around: ADR-S01 removed the ElevenLabs agent and with it the `voice_sessions`
 * table, so there is nothing of that kind left to list. What an operator actually needs here
 * is the same thing either way — who currently holds a way in, and when it lapses.
 *
 * The session ID is projected. It is the primary key of a row, not the cookie value: the
 * cookie is signed and this column is what it resolves to, so printing it grants nothing.
 */
import type { Prisma } from '@prisma/client';
import type { Request, RequestHandler } from 'express';

import { recordAudit } from '../../src/lib/audit';
import { clock } from '../../src/lib/clock';
import { prisma } from '../../src/lib/db';
import { logger } from '../../src/lib/logger';
import { adminRead, applyReadHeaders } from '../../src/lib/read-replica';

import { findManyArgs, listEnvelope, listParams } from './list';
import { SESSION_SPEC } from './specs';

const asString = (value: unknown): string | undefined =>
  typeof value === 'string' && value !== '' ? value : undefined;

/**
 * `?active=true` is "usable right now": not revoked and not expired. Anything else is left
 * unfiltered rather than inverted — an operator asking for the live ones is the whole point,
 * and "show me the dead ones" is a question nobody has.
 */
export function sessionFilters(query: Request['query'], now: Date): Prisma.SessionWhereInput {
  const userId = asString(query.userId);

  return {
    ...(userId ? { user_id: userId } : {}),
    ...(query.active === 'true' ? { revoked_at: null, expires_at: { gt: now } } : {}),
  };
}

export const listSessions: RequestHandler = async (req, res, next) => {
  try {
    const now = clock.now();
    const params = listParams(req.query, SESSION_SPEC, now);
    const where = { ...sessionFilters(req.query, now), ...params.search.where };

    const { data, source, lagSeconds } = await adminRead(async (client) => {
      const cursorExists = params.cursorId
        ? Boolean(
            await client.session.findUnique({ where: { id: params.cursorId }, select: { id: true } }),
          )
        : false;

      return client.session.findMany({
        where,
        ...findManyArgs(params, cursorExists),
        include: { user: { select: { email_lower: true, role: true } } },
      });
    });

    const rows = data;

    const envelope = listEnvelope(
      rows,
      params,
      (session) => ({
        id: session.id,
        userId: session.user_id,
        userEmail: session.user.email_lower,
        role: session.user.role,
        // Computed here rather than left to the client: "active" is a comparison against the
        // server's clock, and a browser with a wrong one would draw a different answer.
        active: session.revoked_at === null && session.expires_at > now,
        revokedAt: session.revoked_at?.toISOString() ?? null,
        expiresAt: session.expires_at.toISOString(),
        createdAt: session.created_at.toISOString(),
      }),
      (session) => session.id,
    );

    await recordAudit(prisma, {
      actorUserId: req.user!.id,
      action: 'admin.sessions_read',
      subjectType: 'session_list',
      traceId: req.traceId,
      metadata: { count: envelope.items.length, query: params.search.applied },
    });

    logger.info({ traceId: req.traceId, count: envelope.items.length }, 'ADMIN_SESSIONS_LISTED');

    applyReadHeaders(res, { data, source, lagSeconds });

    res.status(200).json(envelope);
  } catch (err) {
    next(err);
  }
};
