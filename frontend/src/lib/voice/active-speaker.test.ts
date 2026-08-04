import { describe, expect, it } from 'vitest';

import { resolveActiveSpeaker } from './active-speaker';

describe('resolveActiveSpeaker', () => {
  it('returns hr for hr_round', () => {
    expect(resolveActiveSpeaker('hr_round')).toBe('hr');
  });

  it('returns tech for tech_round', () => {
    expect(resolveActiveSpeaker('tech_round')).toBe('tech');
  });

  it('never returns both tiles active for the same round', () => {
    const hrActive = resolveActiveSpeaker('hr_round');
    const techActive = resolveActiveSpeaker('tech_round');
    expect(hrActive).not.toBe(techActive);
  });

  it('is deterministic: same round always yields same speaker', () => {
    expect(resolveActiveSpeaker('hr_round')).toBe(resolveActiveSpeaker('hr_round'));
    expect(resolveActiveSpeaker('tech_round')).toBe(resolveActiveSpeaker('tech_round'));
  });
});
