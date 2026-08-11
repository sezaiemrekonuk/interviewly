/**
 * Issue 86. One write path for `audit_logs`, so every privileged or destructive action is
 * recorded the same way and the "who" cannot be forgotten at a call site.
 *
 * The client is a PARAMETER, not the module-level `prisma`, and that is the whole point for
 * the destructive actions: the caller passes the transaction it is already inside, so the
 * audit row and the mutation commit together. A `recordAudit` that opened its own connection
 * could leave a delete with no record, or a record of a delete that rolled back — the two
 * disagreements the table exists to make impossible. A plain `PrismaClient` is accepted too
 * (it satisfies `TransactionClient`), which is what the read paths pass: a read has nothing
 * to be atomic with.
 *
 * NO PII in a row written through here. Ids, an action, and `metadata` for counts and flags
 * — never a password, a token, a session secret or a raw email address (issue 063).
 */
import type { Prisma } from '@prisma/client';

/**
 * The closed set of audited actions. A string column in the database (a new action must not
 * be a migration), a union here so a typo is a compile error rather than an orphan row that
 * no query knows to look for.
 */
export type AuditAction =
  | 'interview.soft_deleted'
  | 'admin.interviews_read'
  | 'admin.interview_read'
  | 'admin.stats_read'
  | 'auth.password_reset_completed'
  // US-29 — "see when the system defended itself". These three were log lines and nothing
  // else, so the panel the story asks for had no table to read: `SECURITY_PROMPT_INJECTION_
  // SUSPECTED` vanished with the container, and budget/time exhaustion left only
  // `interviews.ended_reason`, which is one value per interview and not a timeline. They are
  // events about a subject rather than acts by an operator, so the actor is the account the
  // interview belongs to — the row still answers "whose data was this".
  | 'security.prompt_injection_suspected'
  | 'interview.budget_exhausted'
  | 'interview.time_exhausted';

export interface AuditEntry {
  actorUserId: string;
  action: AuditAction;
  subjectType: string;
  /** Null for a collection read — see the schema note on the column. */
  subjectId?: string | null;
  traceId?: string;
  metadata?: Prisma.InputJsonValue;
}

export async function recordAudit(
  client: Prisma.TransactionClient,
  entry: AuditEntry,
): Promise<void> {
  await client.auditLog.create({
    data: {
      actor_user_id: entry.actorUserId,
      action: entry.action,
      subject_type: entry.subjectType,
      subject_id: entry.subjectId ?? null,
      trace_id: entry.traceId ?? null,
      ...(entry.metadata === undefined ? {} : { metadata: entry.metadata }),
    },
  });
}
