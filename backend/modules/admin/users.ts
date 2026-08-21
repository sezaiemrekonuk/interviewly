/**
 * `GET /admin/users` — the console's "Users" section, and the join the interview list never
 * had. Until this existed a row on `/admin` carried a raw account cuid and nothing that
 * resolved it, so "which candidate ran this" was unanswerable from the panel.
 *
 * Reads the account, never its secrets: no `password_hash`, no `google_sub`, no session token.
 * `email_lower` is the one identifier that comes back, because an operator cannot act on a
 * cuid — and an erased account (KVKK, `deleted_at`) carries an anonymised value there already.
 */
import type { Prisma, Role } from '@prisma/client';
import type { Request, RequestHandler } from 'express';

import { recordAudit } from '../../src/lib/audit';
import { prisma } from '../../src/lib/db';
import { logger } from '../../src/lib/logger';
import { adminRead, applyReadHeaders } from '../../src/lib/read-replica';

import { findManyArgs, listEnvelope, listParams } from './list';
import { USER_SPEC } from './specs';

const asString = (value: unknown): string | undefined =>
  typeof value === 'string' && value !== '' ? value : undefined;

export function userFilters(query: Request['query']): Prisma.UserWhereInput {
  const role = asString(query.role);
  const q = asString(query.q);

  return {
    ...(role === 'admin' || role === 'user' ? { role: role as Role } : {}),
    // `email_lower` is already folded, so the search is a plain `contains` on the stored
    // value — lowering the needle is what makes a capitalised query match.
    ...(q ? { email_lower: { contains: q.toLowerCase() } } : {}),
  };
}

export const listUsers: RequestHandler = async (req, res, next) => {
  try {
    const params = listParams(req.query, USER_SPEC);
    const where = { ...userFilters(req.query), ...params.search.where };

    const { data, source, lagSeconds } = await adminRead(async (client) => {
      const cursorExists = params.cursorId
        ? Boolean(
            await client.user.findUnique({ where: { id: params.cursorId }, select: { id: true } }),
          )
        : false;

      return client.user.findMany({
        where,
        ...findManyArgs(params, cursorExists),
        select: {
          id: true,
          email_lower: true,
          role: true,
          locale: true,
          email_verified_at: true,
          onboarding_completed_at: true,
          consent_version: true,
          consented_at: true,
          deleted_at: true,
          created_at: true,
          // Deleted interviews included, like everywhere else on this router (K11): an admin
          // counting a user's interviews wants the ones that happened, not the ones still shown
          // to the user.
          _count: { select: { interviews: true } },
        },
      });
    });

    const rows = data;

    const envelope = listEnvelope(
      rows,
      params,
      (user) => ({
        id: user.id,
        email: user.email_lower,
        role: user.role,
        locale: user.locale,
        emailVerified: user.email_verified_at !== null,
        onboarded: user.onboarding_completed_at !== null,
        consentVersion: user.consent_version,
        consentedAt: user.consented_at?.toISOString() ?? null,
        erased: user.deleted_at !== null,
        interviewCount: user._count.interviews,
        createdAt: user.created_at.toISOString(),
      }),
      (user) => user.id,
    );

    await recordAudit(prisma, {
      actorUserId: req.user!.id,
      action: 'admin.users_read',
      subjectType: 'user_list',
      traceId: req.traceId,
      metadata: {
        count: envelope.items.length,
        filters: where as Prisma.InputJsonValue,
        query: params.search.applied,
      },
    });

    logger.info({ traceId: req.traceId, count: envelope.items.length }, 'ADMIN_USERS_LISTED');

    applyReadHeaders(res, { data, source, lagSeconds });

    res.status(200).json(envelope);
  } catch (err) {
    next(err);
  }
};
