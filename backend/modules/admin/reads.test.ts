/**
 * The five console read endpoints, exercised as handlers rather than as parsers.
 *
 * `filters.test.ts` pins what each query string becomes; `interview-detail.test.ts` pins what
 * each row becomes on the wire. Neither can catch the wiring between them — a `where` built and
 * then not passed, a page that forgets `take: limit + 1` and so never offers a next cursor, a
 * privileged read that answers without recording that it happened. That is what this covers.
 *
 * Prisma is mocked, so these are not integration tests and make no claim about SQL. What they
 * assert is the shape of the call each handler makes and the envelope it answers with.
 */
import { Prisma } from '@prisma/client';
import { describe, expect, it, vi, beforeEach } from 'vitest';

import { encodeCursor } from '../interview/cursor';

const AT = new Date('2026-08-11T09:00:00.000Z');

/** `decodeCursor` shape-checks for a cuid before it will page on one; a short id is dropped. */
const CUID = 'cmsdaraqs00dyrqxsrwctae2r';

/** Every model the five handlers touch, each recording the args it was called with. */
const calls: { model: string; method: string; args: Record<string, unknown> }[] = [];
const rows: Record<string, unknown[]> = {};

function model(name: string) {
  const record = (method: string) => async (args: Record<string, unknown> = {}) => {
    calls.push({ model: name, method, args });
    if (method === 'findUnique') return { id: (args.where as { id: string }).id };
    if (method === 'groupBy') return rows[`${name}.groupBy`] ?? [];
    return rows[name] ?? [];
  };
  return {
    findMany: record('findMany'),
    findUnique: record('findUnique'),
    groupBy: record('groupBy'),
    create: record('create'),
  };
}

vi.mock('../../src/lib/db', () => ({
  prisma: {
    llmCall: model('llmCall'),
    user: model('user'),
    session: model('session'),
    auditLog: model('auditLog'),
    interview: model('interview'),
  },
}));

vi.mock('../../src/lib/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

vi.mock('../../src/lib/clock', () => ({ clock: { now: () => AT } }));

const { listLlmCalls } = await import('./llm-calls');
const { listUsers } = await import('./users');
const { listSessions } = await import('./sessions');
const { listAuditLog } = await import('./audit-log');

/** Enough of Express for a handler that only reads `query`, `params`, `user` and `traceId`. */
function invoke(
  handler: (req: never, res: never, next: never) => Promise<void>,
  query: Record<string, unknown> = {},
) {
  const sent: { status?: number; body?: Record<string, unknown> } = {};
  const req = { query, params: {}, user: { id: 'admin_1' }, traceId: 'trace_1' };
  const res = {
    status(code: number) {
      sent.status = code;
      return this;
    },
    json(body: Record<string, unknown>) {
      sent.body = body;
    },
  };
  const next = vi.fn();
  return handler(req as never, res as never, next as never).then(() => ({ sent, next }));
}

const callRow = (id: string) => ({
  id,
  interview_id: 'itv_1',
  provider: 'openai',
  model: 'gpt-4.1-mini',
  prompt_uuid: 'uuid-1',
  prompt_version: 1,
  attempt_no: 1,
  fell_back_from: null,
  units: new Prisma.Decimal('1200'),
  unit_kind: 'token',
  input_tokens: 800,
  output_tokens: 400,
  cost_usd: new Prisma.Decimal('0.0004'),
  latency_ms: 900,
  trace_id: 'trace_1',
  created_at: AT,
});

const userRow = (id: string) => ({
  id,
  email_lower: `${id}@example.com`,
  role: 'user',
  locale: 'en',
  email_verified_at: AT,
  onboarding_completed_at: null,
  consent_version: null,
  consented_at: null,
  deleted_at: null,
  created_at: AT,
  _count: { interviews: 3 },
});

const sessionRow = (id: string, expires: Date) => ({
  id,
  user_id: 'usr_1',
  expires_at: expires,
  revoked_at: null,
  created_at: AT,
  user: { email_lower: 'ada@example.com', role: 'user' },
});

const auditRow = (id: string) => ({
  id,
  actor_user_id: 'usr_1',
  action: 'interview.soft_deleted',
  subject_type: 'interview',
  subject_id: 'itv_1',
  trace_id: 'trace_1',
  metadata: null,
  created_at: AT,
  actor: { email_lower: 'ada@example.com', role: 'user' },
});

const findManyFor = (name: string) => calls.find((c) => c.model === name && c.method === 'findMany');
const audited = () => calls.find((c) => c.model === 'auditLog' && c.method === 'create');

beforeEach(() => {
  calls.length = 0;
  for (const key of Object.keys(rows)) delete rows[key];
});

describe('admin console reads', () => {
  it('passes the parsed filter into the query rather than dropping it', async () => {
    rows.llmCall = [callRow('c1')];
    await invoke(listLlmCalls, { provider: 'openai', interviewId: 'itv_1' });

    expect(findManyFor('llmCall')?.args.where).toEqual({
      provider: 'openai',
      interview_id: 'itv_1',
    });
  });

  it('reads one row past the page so it knows whether a next page exists', async () => {
    // 21 rows for a default limit of 20: the extra one is the whole mechanism behind
    // `nextCursor`, and a handler that took exactly `limit` would always answer null.
    rows.llmCall = Array.from({ length: 21 }, (_, i) => callRow(`c${i}`));
    const { sent } = await invoke(listLlmCalls);

    expect(findManyFor('llmCall')?.args.take).toBe(21);
    expect((sent.body?.items as unknown[]).length).toBe(20);
    expect(sent.body?.nextCursor).toBe(encodeCursor('c19'));
  });

  it('answers a last page with no cursor', async () => {
    rows.llmCall = [callRow('c1')];
    const { sent } = await invoke(listLlmCalls);
    expect(sent.body?.nextCursor).toBeNull();
  });

  it('resolves a cursor against the table before paging on it', async () => {
    rows.llmCall = [callRow('c1')];
    await invoke(listLlmCalls, { cursor: encodeCursor(CUID) });

    expect(calls.some((c) => c.model === 'llmCall' && c.method === 'findUnique')).toBe(true);
    expect(findManyFor('llmCall')?.args.cursor).toEqual({ id: CUID });
    expect(findManyFor('llmCall')?.args.skip).toBe(1);
  });

  it('ignores a malformed cursor rather than failing the page', async () => {
    rows.llmCall = [callRow('c1')];
    const { sent, next } = await invoke(listLlmCalls, { cursor: 'not-base64-of-a-cuid' });

    expect(next).not.toHaveBeenCalled();
    expect(findManyFor('llmCall')?.args.cursor).toBeUndefined();
    expect(sent.status).toBe(200);
  });

  it('orders every list on a total key, so a page cannot repeat or skip a row', async () => {
    // `created_at` alone is not total — calls inside one turn share a millisecond — and a
    // cursor over a non-total order is how a row appears on two pages or on neither.
    for (const [handler, name] of [
      [listLlmCalls, 'llmCall'],
      [listUsers, 'user'],
      [listSessions, 'session'],
      [listAuditLog, 'auditLog'],
    ] as const) {
      calls.length = 0;
      rows[name] = [];
      await invoke(handler as never);
      expect(findManyFor(name)?.args.orderBy).toEqual([{ created_at: 'desc' }, { id: 'desc' }]);
    }
  });

  it('records every privileged read, one row for the page and not one per item', async () => {
    rows.user = [userRow('u1'), userRow('u2')];
    await invoke(listUsers);

    const writes = calls.filter((c) => c.model === 'auditLog' && c.method === 'create');
    expect(writes).toHaveLength(1);
    expect((writes[0].args.data as { action: string }).action).toBe('admin.users_read');
    // A page is the subject; there is no single account it acted on.
    expect((writes[0].args.data as { subject_id: string | null }).subject_id).toBeNull();
  });

  it('never projects an account secret', async () => {
    rows.user = [userRow('u1')];
    const { sent } = await invoke(listUsers);

    const select = findManyFor('user')?.args.select as Record<string, unknown>;
    expect(select.password_hash).toBeUndefined();
    expect(select.google_sub).toBeUndefined();
    expect(JSON.stringify(sent.body)).not.toContain('password');
  });

  it('reads a session as active against the server clock, never the caller\'s', async () => {
    rows.session = [
      sessionRow('s1', new Date(AT.getTime() + 1000)),
      sessionRow('s2', new Date(AT.getTime() - 1000)),
    ];
    const { sent } = await invoke(listSessions);

    const items = sent.body?.items as { active: boolean }[];
    expect(items[0].active).toBe(true);
    expect(items[1].active).toBe(false);
  });

  it('offers the audit filter the vocabulary the table actually holds', async () => {
    rows.auditLog = [auditRow('a1')];
    rows['auditLog.groupBy'] = [{ action: 'interview.soft_deleted', _count: { _all: 4 } }];
    const { sent } = await invoke(listAuditLog);

    // Counted from the data, not copied from the `AuditAction` union — a hardcoded list drifts
    // the moment an action is added, and drifts silently.
    expect(sent.body?.actions).toEqual([{ action: 'interview.soft_deleted', count: 4 }]);
  });

  it('audits the read of the audit trail itself', async () => {
    rows.auditLog = [auditRow('a1')];
    await invoke(listAuditLog);
    expect((audited()?.args.data as { action: string }).action).toBe('admin.audit_read');
  });
});
