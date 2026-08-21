/**
 * Issue 86. Two things are worth pinning about the write helper: it maps onto the columns a
 * later query will look for, and it writes through the client it was HANDED. The second is
 * the whole reason the parameter exists — a `recordAudit` that reached for the module-level
 * `prisma` would commit outside its caller's transaction, and a soft delete could then roll
 * back while its audit row survived.
 */
import { describe, expect, it, vi } from 'vitest';

import { recordAudit } from './audit';

const fakeTx = () => {
  const create = vi.fn().mockResolvedValue({});
  const upsert = vi.fn().mockResolvedValue({});
  return { client: { auditLog: { create }, auditActionStat: { upsert } } as never, create, upsert };
};

describe('recordAudit', () => {
  it('writes through the client it was given, onto the audit_logs columns', async () => {
    const { client, create, upsert } = fakeTx();

    await recordAudit(client, {
      actorUserId: 'user_1',
      action: 'interview.soft_deleted',
      subjectType: 'interview',
      subjectId: 'interview_1',
      traceId: 'trace_1',
    });

    expect(create).toHaveBeenCalledWith({
      data: {
        actor_user_id: 'user_1',
        action: 'interview.soft_deleted',
        subject_type: 'interview',
        subject_id: 'interview_1',
        trace_id: 'trace_1',
      },
    });
    // Same client, same call: the running count and the row it counts must never disagree.
    expect(upsert).toHaveBeenCalledWith({
      where: { action: 'interview.soft_deleted' },
      create: { action: 'interview.soft_deleted', count: 1 },
      update: { count: { increment: 1 } },
    });
  });

  it('nulls the optional columns rather than omitting them', async () => {
    const { client, create } = fakeTx();

    await recordAudit(client, {
      actorUserId: 'admin_1',
      action: 'admin.interviews_read',
      subjectType: 'interview_list',
    });

    const { data } = create.mock.calls[0][0];
    expect(data.subject_id).toBeNull();
    expect(data.trace_id).toBeNull();
    // Absent, not `null`: Prisma's Json input rejects a bare `null` for a nullable Json
    // column, and an unset field is what leaves it NULL.
    expect(data).not.toHaveProperty('metadata');
  });

  it('carries metadata when there is any', async () => {
    const { client, create } = fakeTx();

    await recordAudit(client, {
      actorUserId: 'user_1',
      action: 'auth.password_reset_completed',
      subjectType: 'user',
      subjectId: 'user_1',
      metadata: { sessionsRevoked: 3 },
    });

    expect(create.mock.calls[0][0].data.metadata).toEqual({ sessionsRevoked: 3 });
  });
});
