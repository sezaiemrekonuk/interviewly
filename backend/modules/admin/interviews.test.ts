import { describe, expect, it } from 'vitest';

import { interviewFilters } from './interviews';

/**
 * The parser only, not the handler: `listAllInterviews` needs Prisma, and what is worth
 * pinning here is that a facet either narrows correctly or is dropped. A filter that silently
 * became `undefined` and one that silently matched everything look the same from the console.
 */
describe('admin interview filters', () => {
  it('is empty when nothing is asked for', () => {
    expect(interviewFilters({})).toEqual({});
  });

  it('narrows on all three facets at once', () => {
    expect(
      interviewFilters({ state: 'completed', userId: 'usr_1', occupationCluster: 'software' }),
    ).toEqual({
      state: 'completed',
      user_id: 'usr_1',
      occupation_cluster: { key: 'software' },
    });
  });

  it('drops a state that is not one of the nine', () => {
    expect(interviewFilters({ state: 'nonsense' })).toEqual({});
  });

  it('drops empty and repeated values rather than matching on them', () => {
    // Express parses `?userId=a&userId=b` into an array; a `where` built from one would throw.
    expect(interviewFilters({ userId: '', occupationCluster: ['a', 'b'] })).toEqual({});
  });

  it('never adds a deleted_at filter, whatever is asked for', () => {
    // The soft-delete bypass is the point of this endpoint (K11) — a facet must not restore it.
    expect(interviewFilters({ state: 'completed' })).not.toHaveProperty('deleted_at');
  });
});
