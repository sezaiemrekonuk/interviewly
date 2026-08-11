/**
 * `GET /admin/audit` — the console's "Audit" section.
 *
 * `audit_logs` has existed since issue 86 and nothing read it, so the durable record of who
 * deleted what was queryable by SQL and by nothing else. This is the read side.
 *
 * Reading the audit trail is itself an audited act. That does mean the table grows a row for
 * every look at it and a reader will see their own last visit at the top; it is the right way
 * round — an audit surface that could be read without leaving a trace is the one an attacker
 * uses to find out what was noticed.
 */
import type { Prisma } from '@prisma/client';
import type { Request, RequestHandler } from 'express';

import { recordAudit } from '../../src/lib/audit';
import { prisma } from '../../src/lib/db';
import { logger } from '../../src/lib/logger';
import { decodeCursor, encodeCursor, pageLimit } from '../interview/cursor';

const asString = (value: unknown): string | undefined =>
  typeof value === 'string' && value !== '' ? value : undefined;

export function auditFilters(query: Request['query']): Prisma.AuditLogWhereInput {
  const action = asString(query.action);
  const actorUserId = asString(query.actorUserId);
  const subjectId = asString(query.subjectId);

  return {
    ...(action ? { action } : {}),
    ...(actorUserId ? { actor_user_id: actorUserId } : {}),
    ...(subjectId ? { subject_id: subjectId } : {}),
  };
}

export const listAuditLog: RequestHandler = async (req, res, next) => {
  try {
    const limit = pageLimit(req.query.limit);
    const where = auditFilters(req.query);
    const decoded = decodeCursor(req.query.cursor);
    const cursor = decoded
      ? (await prisma.auditLog.findUnique({ where: { id: decoded }, select: { id: true } }))?.id
      : undefined;

    const rows = await prisma.auditLog.findMany({
      where,
      orderBy: [{ created_at: 'desc' }, { id: 'desc' }],
      take: limit + 1,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      include: { actor: { select: { email_lower: true, role: true } } },
    });

    const page = rows.slice(0, limit);

    // Which actions actually occur, counted, so the filter offers the real vocabulary rather
    // than a hardcoded copy of the union in `src/lib/audit.ts` that would drift from it.
    const actions = await prisma.auditLog.groupBy({
      by: ['action'],
      _count: { _all: true },
      orderBy: { _count: { id: 'desc' } },
    });

    await recordAudit(prisma, {
      actorUserId: req.user!.id,
      action: 'admin.audit_read',
      subjectType: 'audit_log',
      traceId: req.traceId,
      metadata: { count: page.length, filters: where as Prisma.InputJsonValue },
    });

    logger.info({ traceId: req.traceId, count: page.length }, 'ADMIN_AUDIT_LISTED');

    res.status(200).json({
      items: page.map((row) => ({
        id: row.id,
        action: row.action,
        actorUserId: row.actor_user_id,
        actorEmail: row.actor.email_lower,
        actorRole: row.actor.role,
        subjectType: row.subject_type,
        subjectId: row.subject_id,
        traceId: row.trace_id,
        metadata: row.metadata,
        createdAt: row.created_at.toISOString(),
      })),
      actions: actions.map((row) => ({ action: row.action, count: row._count._all })),
      nextCursor: rows.length > limit ? encodeCursor(page[page.length - 1].id) : null,
    });
  } catch (err) {
    next(err);
  }
};
