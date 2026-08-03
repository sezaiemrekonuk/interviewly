/**
 * K8.7 — where a signed-in visitor lands when nothing else was requested.
 *
 * Onboarding incomplete beats everything else; only once it is done does the interview
 * count matter. `DEFAULT_LANDING_PATH` stays the terminal case so callers that already
 * import it (or fall through here) still land somewhere real.
 */
import { DEFAULT_LANDING_PATH } from './auth-redirect';

export interface FirstRunUser {
  onboardingCompletedAt: string | null;
  interviewCount: number;
}

export function firstRunPath(user: FirstRunUser): string {
  if (!user.onboardingCompletedAt) return '/onboarding/1';
  if (user.interviewCount === 0) return '/interviews/new';
  return DEFAULT_LANDING_PATH;
}
