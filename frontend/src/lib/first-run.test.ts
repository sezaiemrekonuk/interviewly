import { describe, expect, it } from 'vitest';

import { DEFAULT_LANDING_PATH } from './auth-redirect';
import { firstRunPath } from './first-run';

describe('firstRunPath', () => {
  it('sends an account that never finished onboarding back to it', () => {
    expect(firstRunPath({ onboardingCompletedAt: null, interviewCount: 0 })).toBe('/onboarding/1');
  });

  // Ordering, not two independent rules: onboarding outranks the interview count, so an
  // account with interviews but no completed profile still goes to onboarding.
  it('prefers onboarding over the interview count', () => {
    expect(firstRunPath({ onboardingCompletedAt: null, interviewCount: 9 })).toBe('/onboarding/1');
  });

  it('offers the first interview once onboarding is done and none exist', () => {
    expect(
      firstRunPath({ onboardingCompletedAt: '2026-08-01T09:00:00Z', interviewCount: 0 }),
    ).toBe('/interviews/new');
  });

  it('lands a returning user on the default path', () => {
    expect(
      firstRunPath({ onboardingCompletedAt: '2026-08-01T09:00:00Z', interviewCount: 1 }),
    ).toBe(DEFAULT_LANDING_PATH);
  });
});
