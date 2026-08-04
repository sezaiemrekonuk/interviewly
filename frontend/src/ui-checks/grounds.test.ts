// W01 AC-4a/AC-4b — the gradient route-list and shadow-tier map are closed sets, asserted as
// data (entry-routes.ts) so a later screen's misuse is a review-catchable violation, not a
// per-screen judgement call.
import { describe, expect, it } from 'vitest';
import { ENTRY_ROUTES, SURFACE_SHADOW } from '../lib/entry-routes';

describe('gradient route-list (ui AC-4a)', () => {
  it('is the closed entry-surface set', () => {
    expect(new Set(ENTRY_ROUTES)).toEqual(
      new Set([
        '/',
        '/register',
        '/sign-in',
        '/verify-email',
        '/forgot-password',
        '/reset-password',
        '/onboarding',
        '/interviews/new',
        '/interviews/[id]/pre-join',
      ])
    );
  });

  it('excludes room, report, dashboard and admin', () => {
    for (const route of ['/interviews/[id]/room', '/interviews/[id]', '/dashboard', '/admin']) {
      expect(ENTRY_ROUTES).not.toContain(route);
    }
  });
});

describe('shadow tier (ui AC-4b)', () => {
  it('permits --shadow-soft only on entry surfaces', () => {
    expect(SURFACE_SHADOW.entry).toBe('soft');
  });

  it('limits room, report, dashboard and admin to --shadow-hairline', () => {
    for (const surface of ['room', 'report', 'dashboard', 'admin'] as const) {
      expect(SURFACE_SHADOW[surface]).toBe('hairline');
    }
  });
});
