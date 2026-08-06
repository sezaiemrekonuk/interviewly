/**
 * `mergeCard` is the whole write half of `PATCH /me/profile`. onboarding-profile.feature covers
 * the merge invariant end to end for the cards it saves; this covers the branch `/profile`
 * (issue 75) added — clearing a field — which an append-only onboarding flow never reaches.
 */
import { describe, expect, it } from 'vitest';

import { mergeCard } from './profile';

describe('mergeCard', () => {
  it('merges one card over the others rather than replacing them (A06)', () => {
    const stored = { fullName: 'Ada', education: [{ school: 'Cambridge' }] };
    expect(mergeCard(stored, { interestsText: 'Analytical engines' })).toEqual({
      fullName: 'Ada',
      education: [{ school: 'Cambridge' }],
      interestsText: 'Analytical engines',
    });
  });

  it('removes a cleared field instead of storing a blank', () => {
    expect(mergeCard({ fullName: 'Ada', jobTitle: 'Analyst' }, { jobTitle: '' })).toEqual({
      fullName: 'Ada',
    });
    expect(mergeCard({ hobbies: ['chess'] }, { hobbies: [] })).toEqual({});
  });

  it('clears only the keys the card actually carried', () => {
    // The absent `jobTitle` is untouched — it is not in the patch, so it is not a clear.
    expect(mergeCard({ fullName: 'Ada', jobTitle: 'Analyst' }, { fullName: '' })).toEqual({
      jobTitle: 'Analyst',
    });
  });

  it('leaves the stored profile object alone', () => {
    const stored = { fullName: 'Ada' };
    mergeCard(stored, { fullName: '' });
    expect(stored).toEqual({ fullName: 'Ada' });
  });
});
