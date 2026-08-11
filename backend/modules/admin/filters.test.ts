import { describe, expect, it } from 'vitest';

import { auditFilters } from './audit-log';
import { llmCallFilters } from './llm-calls';
import { sessionFilters } from './sessions';
import { userFilters } from './users';

/**
 * The query parsers for the four list sections. Same contract as `pageLimit`: a facet either
 * narrows exactly, or is dropped. Nothing here may throw on a hostile query string — Express
 * turns `?userId=a&userId=b` into an array and `?a[b]=c` into an object, and a `where` built
 * from either would be a 500 on a URL anyone can type.
 */
const NOW = new Date('2026-08-11T09:00:00.000Z');

describe('admin list filters', () => {
  it('narrows model calls by provider, model and interview', () => {
    expect(llmCallFilters({ provider: 'openai', model: 'gpt-4.1-mini', interviewId: 'itv_1' })).toEqual(
      { provider: 'openai', model: 'gpt-4.1-mini', interview_id: 'itv_1' },
    );
    expect(llmCallFilters({})).toEqual({});
  });

  it('lowercases a user search, because email_lower is what is stored', () => {
    expect(userFilters({ q: 'Ada@Example.COM' })).toEqual({
      email_lower: { contains: 'ada@example.com' },
    });
  });

  it('takes only the two real roles', () => {
    expect(userFilters({ role: 'admin' })).toEqual({ role: 'admin' });
    expect(userFilters({ role: 'superuser' })).toEqual({});
  });

  it('reads active sessions as neither revoked nor expired', () => {
    expect(sessionFilters({ active: 'true' }, NOW)).toEqual({
      revoked_at: null,
      expires_at: { gt: NOW },
    });
    // Anything but the literal `true` leaves the list unfiltered rather than inverting it.
    expect(sessionFilters({ active: 'false' }, NOW)).toEqual({});
  });

  it('narrows the audit trail by action, actor and subject', () => {
    expect(
      auditFilters({ action: 'interview.soft_deleted', actorUserId: 'usr_1', subjectId: 'itv_1' }),
    ).toEqual({
      action: 'interview.soft_deleted',
      actor_user_id: 'usr_1',
      subject_id: 'itv_1',
    });
  });

  it('drops repeated and structured query params instead of building a where from them', () => {
    expect(llmCallFilters({ provider: ['a', 'b'] })).toEqual({});
    expect(userFilters({ q: { nested: 'x' } as never })).toEqual({});
    expect(auditFilters({ action: ['a'], subjectId: '' })).toEqual({});
    expect(sessionFilters({ userId: ['a', 'b'] }, NOW)).toEqual({});
  });
});
