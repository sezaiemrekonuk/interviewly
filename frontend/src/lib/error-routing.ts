import { DEFAULT_LANDING_PATH, signInPathFor } from './auth-redirect';

/**
 * What the caller still has to do after routing decided. `refetch` is the silent
 * `['interview',id,'state']` invalidation (§4.5) — no toast, no navigation.
 */
export type ErrorAction = 'navigated' | 'refetch' | 'inline' | 'not-authorized';

/**
 * The client is behind the server; refetching state is the whole fix, with no toast.
 * `BUDGET_EXCEEDED` resolves the same way — the refetch lands in `evaluating` and the room
 * shows report-wait. Exported because the answer mutation reconciles on the same set (K2);
 * a second copy there would drift.
 */
export const SILENT_REFETCH_CODES = new Set([
  'QUESTION_NOT_CURRENT',
  'INVALID_STATE_TRANSITION',
  'BUDGET_EXCEEDED',
]);

export interface ErrorRouter {
  replace: (path: string) => void;
  push?: (path: string) => void;
}

export interface ErrorContext {
  /** Where the visitor was — preserved as the return path where the table says so. */
  pathname: string;
}

/** §4.5 code → UI behaviour. Display text is `useErrorMessage`'s job, never this file's. */
export function routeForError(
  code: string,
  router: ErrorRouter,
  ctx: ErrorContext,
): ErrorAction {
  switch (code) {
    case 'UNAUTHENTICATED':
      router.replace(signInPathFor(ctx.pathname));
      return 'navigated';

    case 'FORBIDDEN':
      // An admin route renders not-authorized in place: bouncing to the landing page would tell
      // a non-admin that the route exists and that they were bounced off it.
      if (ctx.pathname.startsWith('/admin')) return 'not-authorized';
      router.replace(DEFAULT_LANDING_PATH);
      return 'navigated';

    case 'INTERVIEW_NOT_FOUND':
      router.replace('/not-found');
      return 'navigated';

    case 'EMAIL_NOT_VERIFIED':
      router.replace(`/verify-email?returnPath=${encodeURIComponent(ctx.pathname)}`);
      return 'navigated';

    default:
      return SILENT_REFETCH_CODES.has(code) ? 'refetch' : 'inline';
  }
}
