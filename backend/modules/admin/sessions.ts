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
import { decodeCursor, encodeCursor, pageLimit } from '../interview/cursor';

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
    const limit = pageLimit(req.query.limit);
    const where = sessionFilters(req.query, now);
    const decoded = decodeCursor(req.query.cursor);
    const cursor = decoded
      ? (await prisma.session.findUnique({ where: { id: decoded }, select: { id: true } }))?.id
      : undefined;

    const rows = await prisma.session.findMany({
      where,
      orderBy: [{ created_at: 'desc' }, { id: 'desc' }],
      take: limit + 1,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      include: { user: { select: { email_lower: true, role: true } } },
    });

    const page = rows.slice(0, limit);

    await recordAudit(prisma, {
      actorUserId: req.user!.id,
      action: 'admin.sessions_read',
      subjectType: 'session_list',
      traceId: req.traceId,
      metadata: { count: page.length },
    });

    logger.info({ traceId: req.traceId, count: page.length }, 'ADMIN_SESSIONS_LISTED');

    res.status(200).json({
      items: page.map((session) => ({
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
      })),
      nextCursor: rows.length > limit ? encodeCursor(page[page.length - 1].id) : null,
    });
  } catch (err) {
    next(err);
  }
};
