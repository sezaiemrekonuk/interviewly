import { describe, expect, it, vi } from 'vitest';

import { routeForError } from './error-routing';

function router() {
  return { replace: vi.fn(), push: vi.fn() };
}

describe('routeForError', () => {
  it('sends UNAUTHENTICATED to sign-in preserving the return path', () => {
    const r = router();

    expect(routeForError('UNAUTHENTICATED', r, { pathname: '/interviews/abc/room' })).toBe(
      'navigated',
    );
    expect(r.replace).toHaveBeenCalledWith('/sign-in?returnPath=%2Finterviews%2Fabc%2Froom');
  });

  it('sends FORBIDDEN to the dashboard, but renders in place on an admin route', () => {
    const r = router();
    expect(routeForError('FORBIDDEN', r, { pathname: '/dashboard' })).toBe('navigated');
    expect(r.replace).toHaveBeenCalledWith('/dashboard');

    const admin = router();
    expect(routeForError('FORBIDDEN', admin, { pathname: '/admin' })).toBe('not-authorized');
    expect(admin.replace).not.toHaveBeenCalled();
  });

  it('sends INTERVIEW_NOT_FOUND to the not-found screen', () => {
    const r = router();
    expect(routeForError('INTERVIEW_NOT_FOUND', r, { pathname: '/interviews/abc' })).toBe(
      'navigated',
    );
    expect(r.replace).toHaveBeenCalledWith('/not-found');
  });

  it('preserves the attempted action on EMAIL_NOT_VERIFIED', () => {
    const r = router();
    expect(routeForError('EMAIL_NOT_VERIFIED', r, { pathname: '/interviews/new' })).toBe(
      'navigated',
    );
    expect(r.replace).toHaveBeenCalledWith('/verify-email?returnPath=%2Finterviews%2Fnew');
  });

  it('refetches state silently for the stale-client codes', () => {
    for (const code of ['QUESTION_NOT_CURRENT', 'INVALID_STATE_TRANSITION', 'BUDGET_EXCEEDED']) {
      const r = router();
      expect(routeForError(code, r, { pathname: '/interviews/abc/room' })).toBe('refetch');
      expect(r.replace).not.toHaveBeenCalled();
      expect(r.push).not.toHaveBeenCalled();
    }
  });

  it('navigates nowhere for inline-only and unknown codes', () => {
    for (const code of ['RATE_LIMITED', 'DAILY_INTERVIEW_LIMIT', 'EMAIL_RESEND_COOLDOWN', 'NOPE']) {
      const r = router();
      expect(routeForError(code, r, { pathname: '/dashboard' })).toBe('inline');
      expect(r.replace).not.toHaveBeenCalled();
      expect(r.push).not.toHaveBeenCalled();
    }
  });
});
