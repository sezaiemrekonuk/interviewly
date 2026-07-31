/**
 * The §3.3 merge is the one piece of I04 with branches an acceptance scenario only samples:
 * profiling.feature proves one shape of account profile reaches the prompt correctly, and
 * this covers the key casings and empty cases around it.
 *
 * `mergeProfile` is where the date of birth is dropped. `PromptBuilder` drops it again and
 * raises `PROFILE_DOB_STRIPPED`, but that alarm firing because of this path would be a bug —
 * so the strip is asserted here, at the boundary that owns it.
 */
import { describe, expect, it } from 'vitest';

import { mergeProfile } from './profile';

describe('mergeProfile', () => {
  it('drops the date of birth in either casing', () => {
    for (const key of ['dateOfBirth', 'date_of_birth']) {
      const merged = mergeProfile({ fullName: 'Deniz', [key]: '1990-04-17' }, undefined);
      expect(JSON.stringify(merged)).not.toContain('1990');
      expect(JSON.stringify(merged)).not.toContain(key);
      expect(merged).toEqual({ account: { fullName: 'Deniz' } });
    }
  });

  it('lifts the cv text out of the account layer in either casing', () => {
    for (const key of ['cvText', 'cv_text']) {
      expect(mergeProfile({ fullName: 'Cem', [key]: 'Five years of Spring.' }, undefined)).toEqual({
        account: { fullName: 'Cem' },
        cvText: 'Five years of Spring.',
      });
    }
  });

  it('is null when every layer is absent, so the builder emits the no-profile marker', () => {
    expect(mergeProfile(null, undefined)).toBeNull();
    expect(mergeProfile({}, {})).toBeNull();
    // A profile carrying nothing but a date of birth has nothing left once it is stripped.
    expect(mergeProfile({ date_of_birth: '1990-04-17' }, undefined)).toBeNull();
  });

  it('keeps the two layers separate rather than flattening them together', () => {
    expect(mergeProfile({ fullName: 'Ada' }, { yearsExperience: 2 })).toEqual({
      account: { fullName: 'Ada' },
      perInterview: { yearsExperience: 2 },
    });
  });

  it('survives a profile column that is not an object', () => {
    expect(mergeProfile('corrupted', { yearsExperience: 2 })).toEqual({
      perInterview: { yearsExperience: 2 },
    });
  });
});
